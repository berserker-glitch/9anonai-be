import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { prisma } from "../services/prisma";
import { generateContract, ContractData, getContractTypes } from "../services/contract-generator";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}

// Auth middleware
const authenticate = (req: Request, res: Response, next: Function) => {
    let token: string | undefined;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    } else if (req.query.token) {
        token = req.query.token as string;
    }

    if (!token) {
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        (req as any).userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
};

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
        const userId = (req as any).userId;

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
        console.error("Error listing PDFs:", error);
        res.status(500).json({ error: "Failed to list documents" });
    }
});

// GET /api/pdf/:id - Get specific document info
router.get("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        const { id } = req.params;

        const document = await prisma.generatedDocument.findUnique({
            where: { id, userId }
        });

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        res.json({
            ...document,
            metadata: document.metadata ? JSON.parse(document.metadata) : null
        });
    } catch (error) {
        console.error("Error getting document:", error);
        res.status(500).json({ error: "Failed to get document" });
    }
});

// GET /api/pdf/download/:id - Download a generated document
router.get("/download/:id", authenticate, async (req: Request, res: Response) => {
    return res.status(404).json({ error: "Downloads are disabled." });
});

// DELETE /api/pdf/:id - Delete a generated document
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        const { id } = req.params;

        const document = await prisma.generatedDocument.findUnique({
            where: { id, userId }
        });

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Delete from filesystem - path in DB is absolute
        const filepath = document.path;
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }

        // Delete from database
        await prisma.generatedDocument.delete({ where: { id } });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ error: "Failed to delete document" });
    }
});

export default router;
