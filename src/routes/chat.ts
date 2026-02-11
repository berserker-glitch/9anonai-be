/**
 * @fileoverview Chat routes for AI-powered legal advice streaming.
 * Provides SSE streaming and non-streaming endpoints for chat interactions.
 * @module routes/chat
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { getLegalAdviceStream } from "../services/lawyer";
import { logger, logChatEvent } from "../services/logger";
import { optionalAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for chat request body validation.
 */
const ChatSchema = z.object({
    /** User's message/question */
    message: z.string().min(1, "Message cannot be empty"),
    /** Previous conversation history for context */
    history: z.array(z.any()).optional(),
    /** Optional image attachments */
    images: z.array(z.object({
        data: z.string(), // base64 encoded
        mimeType: z.string(),
    })).optional(),
    /** Chat ID for message persistence */
    chatId: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "../services/prisma";

/**
 * POST /api/chat
 * Streams AI legal advice response using Server-Sent Events (SSE).
 * Supports optional authentication for personalized responses.
 * 
 * @route POST /api/chat
 * @security Bearer (optional)
 * @param {string} req.body.message - User's question or message
 * @param {Array} [req.body.history] - Previous messages for context
 * @param {Array} [req.body.images] - Image attachments (base64)
 * @param {string} [req.body.chatId] - Chat ID to save the response to
 * @returns {stream} SSE stream with AI response tokens and metadata
 */
router.post("/", optionalAuth, async (req: Request, res: Response) => {
    // Set up SSE headers for streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
        const { message, history, images, chatId } = ChatSchema.parse(req.body);
        const userId = (req as AuthenticatedRequest).userId;

        // Log chat event
        logChatEvent("stream_start", userId || null, {
            messageLength: message.length,
            historyLength: history?.length || 0,
            imageCount: images?.length || 0
        });

        // Start streaming response
        const stream = getLegalAdviceStream(
            message,
            history || [],
            images || [],
            userId
        );

        let fullContent = "";
        let sources: any[] = [];
        let contract: any = null;

        // Stream events to client
        for await (const event of stream) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);

            // Accumulate response data for persistence
            if (event.type === "token") {
                fullContent += event.content;
            } else if (event.type === "citation") {
                sources = event.sources || [];
            } else if (event.type === "contract_generated") {
                contract = event.document ? {
                    title: event.document.title,
                    path: event.document.id,
                    type: event.document.type
                } : null;
            }
        }

        // Save completed message to database if chatId is provided
        if (chatId && fullContent) {
            try {
                // If user is authenticated, verify chat ownership before saving
                if (userId) {
                    const chat = await prisma.chat.findUnique({
                        where: { id: chatId, userId },
                        select: { id: true }
                    });

                    if (chat) {
                        await prisma.message.create({
                            data: {
                                role: "assistant",
                                content: fullContent,
                                sources: sources.length > 0 ? JSON.stringify(sources) : null,
                                attachmentUrl: contract ? contract.path : null,
                                attachmentName: contract ? contract.title : null,
                                chatId,
                                isActive: true,
                                version: 1
                            }
                        });

                        // Update chat timestamp
                        await prisma.chat.update({
                            where: { id: chatId },
                            data: { updatedAt: new Date() }
                        });

                        logger.debug(`[CHAT] Saved assistant response to chat ${chatId}`);
                    } else {
                        logger.warn(`[CHAT] Skipped saving: Chat ${chatId} not found or not owned by user ${userId}`);
                    }
                } else {
                    logger.warn(`[CHAT] Skipped saving: User not authenticated for chat ${chatId}`);
                }
            } catch (dbError) {
                logger.error("[CHAT] Failed to save assistant message", { error: dbError });
                // We don't fail the request here since the stream was successful
            }
        } else {
            if (!chatId) logger.warn("[CHAT] Skipped saving: No chatId provided");
            if (!fullContent) logger.warn("[CHAT] Skipped saving: No content generated");
        }

        logChatEvent("stream_complete", userId || null);
        res.end();

    } catch (error) {
        logger.error("[CHAT] Streaming error", { error });

        // Handle error based on whether headers were sent
        if (!res.headersSent) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ success: false, error: error.errors });
            } else {
                res.status(500).json({ success: false, error: "Internal Server Error" });
            }
        } else {
            // If stream already started, send error event
            res.write(`data: ${JSON.stringify({
                type: "error",
                content: "An error occurred during generation"
            })}\n\n`);
            res.end();
        }
    }
});

/**
 * POST /api/chat/non-stream
 * Returns complete AI response as JSON (for clients that don't support SSE).
 * Designed for React Native and other non-streaming clients.
 * 
 * @route POST /api/chat/non-stream
 * @security Bearer (optional)
 * @param {string} req.body.message - User's question or message
 * @param {Array} [req.body.history] - Previous messages for context
 * @param {Array} [req.body.images] - Image attachments (base64)
 * @returns {object} 200 - Complete response with content and sources
 */
router.post("/non-stream", optionalAuth, async (req: Request, res: Response) => {
    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        const userId = (req as AuthenticatedRequest).userId;

        logChatEvent("non_stream_start", userId || null, {
            messageLength: message.length
        });

        // Consume stream and collect all events
        const stream = getLegalAdviceStream(
            message,
            history || [],
            images || [],
            userId
        );

        let fullContent = "";
        let sources: any[] = [];
        let contract: any = null;

        for await (const event of stream) {
            switch (event.type) {
                case "token":
                    fullContent += event.content;
                    break;
                case "citation":
                    sources = event.sources || [];
                    break;
                case "contract_generated":
                    contract = event.document ? {
                        title: event.document.title,
                        path: event.document.id,
                        type: event.document.type
                    } : null;
                    break;
            }
        }

        logChatEvent("non_stream_complete", userId || null, {
            responseLength: fullContent.length,
            sourceCount: sources.length
        });

        res.json({
            success: true,
            content: fullContent,
            sources,
            contract
        });

    } catch (error) {
        logger.error("[CHAT] Non-stream error", { error });

        if (error instanceof z.ZodError) {
            res.status(400).json({ success: false, error: error.errors });
        } else {
            res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    }
});

export default router;
