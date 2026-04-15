import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { prisma } from "../services/prisma";
import { generateContract, ContractData, getContractTypes } from "../services/contract-generator";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../services/logger";

const router = Router();

/** Base directory for generated PDFs, used for path traversal validation */
const GENERATED_PDFS_DIR = path.resolve(__dirname, "../../uploads/pdfs-generated");



// GET /api/pdf/types - Get available contract types
router.get("/types", (req: Request, res: Response) => {
    res.json(getContractTypes());
});

// POST /api/pdf/generate - Generate a contract PDF
router.post("/generate", authenticate, async (req: Request, res: Response) => {
    return res.status(403).json({ error: "PDF generation is disabled." });
});

// GET /api/pdf/list - List user's generated PDFs
router.get("/list", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).userId!;

        const documents = await prisma.generatedDocument.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                type: true,
                title: true,
                filename: true,
                path: true,
                createdAt: true
            }
        });

        res.json(documents);
    } catch (error) {
        logger.error("[PDF] Error listing PDFs:", { error });
        res.status(500).json({ error: "Failed to list documents" });
    }
});

// GET /api/pdf/:id - Get specific document info
router.get("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).userId!;
        const { id } = req.params;

        const document = await prisma.generatedDocument.findUnique({
            where: { id, userId }
        });

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Safe JSON parse for metadata
        let parsedMetadata = null;
        try {
            parsedMetadata = document.metadata ? JSON.parse(document.metadata) : null;
        } catch (e) {
            logger.warn(`[PDF] Invalid JSON in metadata for document ${id}`);
            parsedMetadata = null;
        }

        res.json({
            ...document,
            metadata: parsedMetadata
        });
    } catch (error) {
        logger.error("[PDF] Error getting document:", { error });
        res.status(500).json({ error: "Failed to get document" });
    }
});

// GET /api/pdf/download/:id - Download a generated document
router.get("/download/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).userId!;
        const { id } = req.params;

        const document = await prisma.generatedDocument.findUnique({
            where: { id, userId },
        });

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Validate path to prevent directory traversal attacks
        const filepath = path.resolve(document.path);
        if (!filepath.startsWith(GENERATED_PDFS_DIR)) {
            logger.error(`[PDF] Path traversal attempt blocked: ${document.path}`);
            return res.status(400).json({ error: "Invalid file path" });
        }

        if (!fs.existsSync(filepath)) {
            logger.error(`[PDF] File not found on disk: ${filepath}`);
            return res.status(404).json({ error: "File not found on disk" });
        }

        logger.info(`[PDF] Serving download for document ${id}, user ${userId}`);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(document.filename)}"`
        );
        res.sendFile(filepath, (err) => {
            if (err) {
                logger.error("[PDF] Error sending file:", { error: err });
                if (!res.headersSent) {
                    res.status(500).json({ error: "Failed to send file" });
                }
            }
        });
    } catch (error) {
        logger.error("[PDF] Error downloading document:", { error });
        return res.status(500).json({ error: "Failed to download document" });
    }
});

// DELETE /api/pdf/:id - Delete a generated document
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).userId!;
        const { id } = req.params;

        const document = await prisma.generatedDocument.findUnique({
            where: { id, userId }
        });

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Validate path to prevent path traversal
        const filepath = path.resolve(document.path);
        if (!filepath.startsWith(GENERATED_PDFS_DIR)) {
            logger.error(`[PDF] Path traversal attempt blocked: ${document.path}`);
            return res.status(400).json({ error: "Invalid file path" });
        }

        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }

        // Delete from database
        await prisma.generatedDocument.delete({ where: { id } });

        res.json({ success: true });
    } catch (error) {
        logger.error("[PDF] Error deleting document:", { error });
        res.status(500).json({ error: "Failed to delete document" });
    }
});

export default router;
