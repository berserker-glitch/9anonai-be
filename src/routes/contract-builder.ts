/**
 * @fileoverview Contract Builder API routes.
 * Provides REST + SSE endpoints for managing contract drafting sessions,
 * streaming AI responses, and exporting contracts to PDF.
 * 
 * @module routes/contract-builder
 */

import { Router, Request, Response } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { getContractStream } from "../services/contract-builder-ai";
import { generateFlexiblePDF } from "../services/contract-generator";
import { prisma } from "../services/prisma";
import { logger, logDbOperation } from "../services/logger";
import { z } from "zod";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Schema for creating a new contract session */
const createSessionSchema = z.object({
    contractType: z.enum(["rental", "employment", "nda", "service", "sale", "custom"]),
    language: z.enum(["ar", "fr", "en"]).default("fr"),
    title: z.string().optional(),
});

/** Schema for streaming a message to an existing session */
const streamMessageSchema = z.object({
    message: z.string().min(1, "Message cannot be empty"),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions — Create a new contract session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new contract drafting session.
 * Requires authentication. Returns the new session's ID and metadata.
 */
router.post("/sessions", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const parsed = createSessionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: "Invalid request body",
                details: parsed.error.flatten(),
            });
        }

        const { contractType, language, title } = parsed.data;

        // Generate a default title based on contract type if not provided
        const defaultTitles: Record<string, string> = {
            rental: "Contrat de Bail",
            employment: "Contrat de Travail",
            nda: "Accord de Confidentialité",
            service: "Contrat de Prestation de Services",
            sale: "Contrat de Vente",
            custom: "Document Juridique",
        };

        const session = await prisma.contractSession.create({
            data: {
                title: title || defaultTitles[contractType] || "Untitled Contract",
                contractType,
                language,
                htmlContent: "", // Empty until AI generates it
                userId,
            },
        });

        logDbOperation("CREATE", "ContractSession", true, `id=${session.id}, type=${contractType}`);
        logger.info(`[CONTRACT-ROUTES] New session created: ${session.id}`);

        return res.status(201).json({
            id: session.id,
            title: session.title,
            contractType: session.contractType,
            language: session.language,
            status: session.status,
            createdAt: session.createdAt,
        });
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] Failed to create session:", error);
        return res.status(500).json({ error: "Failed to create contract session" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions — List user's contract sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all contract sessions for the authenticated user,
 * ordered by most recently updated first.
 */
router.get("/sessions", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const sessions = await prisma.contractSession.findMany({
            where: { userId },
            select: {
                id: true,
                title: true,
                contractType: true,
                language: true,
                version: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
        });

        return res.json(sessions);
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] Failed to list sessions:", error);
        return res.status(500).json({ error: "Failed to list sessions" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id — Get session details + messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a specific session with its full message history.
 * Verifies the session belongs to the authenticated user.
 */
router.get("/sessions/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const session = await prisma.contractSession.findFirst({
            where: { id, userId },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        return res.json(session);
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] Failed to get session:", error);
        return res.status(500).json({ error: "Failed to get session" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/stream — SSE streaming endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a user message to the contract AI and streams back the response
 * via Server-Sent Events (SSE). This is the main interaction endpoint.
 * 
 * Events emitted:
 *   - step: Status updates (searching, drafting, reviewing)
 *   - token: Streamed chat text
 *   - sources: RAG sources used
 *   - html_update: Updated contract HTML
 *   - review_result: Legal review findings
 *   - done: Stream complete
 */
router.post("/sessions/:id/stream", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const parsed = streamMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: "Invalid request body",
                details: parsed.error.flatten(),
            });
        }

        // Verify the session exists and belongs to this user
        const session = await prisma.contractSession.findFirst({
            where: { id, userId },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                    select: { role: true, content: true },
                },
            },
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        const { message } = parsed.data;

        // Save the user message to the database
        await prisma.contractMessage.create({
            data: {
                role: "user",
                content: message,
                sessionId: id,
            },
        });

        logger.info(`[CONTRACT-ROUTES] Streaming response for session ${id}`, {
            messageLength: message.length,
            historyLength: session.messages.length,
        });

        // Set up SSE headers
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        });

        // Build session history for context
        const sessionHistory = session.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        // Stream AI response
        let assistantContent = "";
        let finalHtml = session.htmlContent;
        let newVersion = session.version;
        let reviewNotes: string | null = null;

        const stream = getContractStream(
            message,
            sessionHistory,
            session.htmlContent,
            session.contractType,
            session.language,
            session.version
        );

        for await (const event of stream) {
            // Write SSE event to the response
            res.write(`data: ${JSON.stringify(event)}\n\n`);

            // Track state updates for database persistence
            switch (event.type) {
                case "token":
                    assistantContent += event.content;
                    break;
                case "html_update":
                    finalHtml = event.html;
                    newVersion = event.version;
                    break;
                case "review_result":
                    reviewNotes = JSON.stringify({
                        issues: event.issues,
                        summary: event.summary,
                    });
                    break;
            }
        }

        // Persist the assistant's response and updated contract state
        if (assistantContent) {
            await prisma.contractMessage.create({
                data: {
                    role: "assistant",
                    content: assistantContent,
                    sessionId: id,
                },
            });
        }

        // Update the session with new HTML, version, and review notes
        if (finalHtml !== session.htmlContent || newVersion !== session.version) {
            await prisma.contractSession.update({
                where: { id },
                data: {
                    htmlContent: finalHtml,
                    version: newVersion,
                    reviewNotes,
                },
            });
            logDbOperation("UPDATE", "ContractSession", true, `id=${id}, version=${newVersion}`);
        }

        res.end();
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] Stream error:", error);
        // If headers already sent, end the stream with an error event
        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ type: "error", content: "Stream interrupted" })}\n\n`);
            res.end();
        } else {
            return res.status(500).json({ error: "Failed to stream response" });
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id/html — Get current contract HTML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns just the current HTML content of a contract session.
 * Useful for the preview panel to fetch the latest state.
 */
router.get("/sessions/:id/html", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const session = await prisma.contractSession.findFirst({
            where: { id, userId },
            select: {
                htmlContent: true,
                version: true,
                reviewNotes: true,
            },
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        return res.json({
            html: session.htmlContent,
            version: session.version,
            reviewNotes: session.reviewNotes ? JSON.parse(session.reviewNotes) : null,
        });
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] Failed to get HTML:", error);
        return res.status(500).json({ error: "Failed to get contract HTML" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/export — Export contract as PDF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a PDF from the current contract HTML using Puppeteer.
 * Returns the PDF file as a download.
 */
router.post("/sessions/:id/export", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const session = await prisma.contractSession.findFirst({
            where: { id, userId },
            select: {
                htmlContent: true,
                title: true,
                contractType: true,
                language: true,
            },
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        if (!session.htmlContent) {
            return res.status(400).json({ error: "No contract content to export" });
        }

        logger.info(`[CONTRACT-ROUTES] Exporting PDF for session ${id}`);

        // Use the enhanced contract generator to produce PDF from raw HTML
        const document = await generateFlexiblePDF(
            userId,
            session.title,
            session.htmlContent,
            session.contractType,
            session.language
        );

        // Update session status to finalized
        await prisma.contractSession.update({
            where: { id },
            data: { status: "finalized" },
        });

        return res.json({
            success: true,
            document: {
                id: document.id,
                title: document.title,
                filename: document.filename,
                path: document.path,
            },
        });
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] PDF export error:", error);
        return res.status(500).json({ error: "Failed to generate PDF" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /sessions/:id — Delete a contract session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a contract session and all its associated messages.
 * Cascade delete is handled by Prisma.
 */
router.delete("/sessions/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        // Verify the session belongs to this user before deleting
        const session = await prisma.contractSession.findFirst({
            where: { id, userId },
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        await prisma.contractSession.delete({
            where: { id },
        });

        logDbOperation("DELETE", "ContractSession", true, `id=${id}`);
        return res.json({ success: true });
    } catch (error) {
        logger.error("[CONTRACT-ROUTES] Failed to delete session:", error);
        return res.status(500).json({ error: "Failed to delete session" });
    }
});

export default router;
