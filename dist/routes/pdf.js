"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const prisma_1 = require("../services/prisma");
const contract_generator_1 = require("../services/contract-generator");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../services/logger");
const router = (0, express_1.Router)();
/** Base directory for generated PDFs, used for path traversal validation */
const GENERATED_PDFS_DIR = path_1.default.resolve(__dirname, "../../uploads/pdfs-generated");
// GET /api/pdf/types - Get available contract types
router.get("/types", (req, res) => {
    res.json((0, contract_generator_1.getContractTypes)());
});
// POST /api/pdf/generate - Generate a contract PDF
router.post("/generate", auth_1.authenticate, async (req, res) => {
    return res.status(403).json({ error: "PDF generation is disabled." });
});
// GET /api/pdf/list - List user's generated PDFs
router.get("/list", auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const documents = await prisma_1.prisma.generatedDocument.findMany({
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
    }
    catch (error) {
        logger_1.logger.error("[PDF] Error listing PDFs:", { error });
        res.status(500).json({ error: "Failed to list documents" });
    }
});
// GET /api/pdf/:id - Get specific document info
router.get("/:id", auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const document = await prisma_1.prisma.generatedDocument.findUnique({
            where: { id, userId }
        });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }
        // Safe JSON parse for metadata
        let parsedMetadata = null;
        try {
            parsedMetadata = document.metadata ? JSON.parse(document.metadata) : null;
        }
        catch (e) {
            logger_1.logger.warn(`[PDF] Invalid JSON in metadata for document ${id}`);
            parsedMetadata = null;
        }
        res.json({
            ...document,
            metadata: parsedMetadata
        });
    }
    catch (error) {
        logger_1.logger.error("[PDF] Error getting document:", { error });
        res.status(500).json({ error: "Failed to get document" });
    }
});
// GET /api/pdf/download/:id - Download a generated document
router.get("/download/:id", auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const document = await prisma_1.prisma.generatedDocument.findUnique({
            where: { id, userId },
        });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }
        // Validate path to prevent directory traversal attacks
        const filepath = path_1.default.resolve(document.path);
        if (!filepath.startsWith(GENERATED_PDFS_DIR)) {
            logger_1.logger.error(`[PDF] Path traversal attempt blocked: ${document.path}`);
            return res.status(400).json({ error: "Invalid file path" });
        }
        if (!fs_1.default.existsSync(filepath)) {
            logger_1.logger.error(`[PDF] File not found on disk: ${filepath}`);
            return res.status(404).json({ error: "File not found on disk" });
        }
        logger_1.logger.info(`[PDF] Serving download for document ${id}, user ${userId}`);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(document.filename)}"`);
        res.sendFile(filepath, (err) => {
            if (err) {
                logger_1.logger.error("[PDF] Error sending file:", { error: err });
                if (!res.headersSent) {
                    res.status(500).json({ error: "Failed to send file" });
                }
            }
        });
    }
    catch (error) {
        logger_1.logger.error("[PDF] Error downloading document:", { error });
        return res.status(500).json({ error: "Failed to download document" });
    }
});
// DELETE /api/pdf/:id - Delete a generated document
router.delete("/:id", auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const document = await prisma_1.prisma.generatedDocument.findUnique({
            where: { id, userId }
        });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }
        // Validate path to prevent path traversal
        const filepath = path_1.default.resolve(document.path);
        if (!filepath.startsWith(GENERATED_PDFS_DIR)) {
            logger_1.logger.error(`[PDF] Path traversal attempt blocked: ${document.path}`);
            return res.status(400).json({ error: "Invalid file path" });
        }
        if (fs_1.default.existsSync(filepath)) {
            fs_1.default.unlinkSync(filepath);
        }
        // Delete from database
        await prisma_1.prisma.generatedDocument.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        logger_1.logger.error("[PDF] Error deleting document:", { error });
        res.status(500).json({ error: "Failed to delete document" });
    }
});
exports.default = router;
