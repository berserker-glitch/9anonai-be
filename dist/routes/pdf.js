"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const fs_1 = __importDefault(require("fs"));
const prisma_1 = require("../services/prisma");
const contract_generator_1 = require("../services/contract-generator");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}
// Auth middleware
const authenticate = (req, res, next) => {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    }
    else if (req.query.token) {
        token = req.query.token;
    }
    if (!token) {
        return res.status(401).json({ error: "No token provided" });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
};
// GET /api/pdf/types - Get available contract types
router.get("/types", (req, res) => {
    res.json((0, contract_generator_1.getContractTypes)());
});
// POST /api/pdf/generate - Generate a contract PDF
router.post("/generate", authenticate, async (req, res) => {
    return res.status(403).json({ error: "PDF generation is disabled." });
});
// GET /api/pdf/list - List user's generated PDFs
router.get("/list", authenticate, async (req, res) => {
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
        console.error("Error listing PDFs:", error);
        res.status(500).json({ error: "Failed to list documents" });
    }
});
// GET /api/pdf/:id - Get specific document info
router.get("/:id", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const document = await prisma_1.prisma.generatedDocument.findUnique({
            where: { id, userId }
        });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }
        res.json({
            ...document,
            metadata: document.metadata ? JSON.parse(document.metadata) : null
        });
    }
    catch (error) {
        console.error("Error getting document:", error);
        res.status(500).json({ error: "Failed to get document" });
    }
});
// GET /api/pdf/download/:id - Download a generated document
router.get("/download/:id", authenticate, async (req, res) => {
    return res.status(404).json({ error: "Downloads are disabled." });
});
// DELETE /api/pdf/:id - Delete a generated document
router.delete("/:id", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const document = await prisma_1.prisma.generatedDocument.findUnique({
            where: { id, userId }
        });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }
        // Delete from filesystem - path in DB is absolute
        const filepath = document.path;
        if (fs_1.default.existsSync(filepath)) {
            fs_1.default.unlinkSync(filepath);
        }
        // Delete from database
        await prisma_1.prisma.generatedDocument.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ error: "Failed to delete document" });
    }
});
exports.default = router;
