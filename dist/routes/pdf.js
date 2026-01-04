"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const path_1 = __importDefault(require("path"));
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
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
    try {
        const userId = req.userId;
        const contractData = req.body;
        if (!contractData.type) {
            return res.status(400).json({ error: "Contract type is required" });
        }
        if (!contractData.parties || contractData.parties.length < 2) {
            return res.status(400).json({ error: "At least two parties are required" });
        }
        // Generate the PDF
        const result = await (0, contract_generator_1.generateContract)(userId, contractData);
        // Save to database
        const savedDoc = await prisma_1.prisma.generatedDocument.create({
            data: {
                type: result.type,
                title: result.title,
                filename: result.filename,
                path: result.path,
                metadata: JSON.stringify(contractData),
                userId,
            }
        });
        res.status(201).json({
            success: true,
            document: {
                id: savedDoc.id,
                type: savedDoc.type,
                title: savedDoc.title,
                filename: savedDoc.filename,
                downloadUrl: result.path,
                createdAt: savedDoc.createdAt
            }
        });
    }
    catch (error) {
        console.error("PDF generation error:", error);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
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
        // Delete from filesystem
        const filepath = path_1.default.join(__dirname, "../../", document.path);
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
