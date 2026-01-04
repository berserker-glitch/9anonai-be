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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
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
    try {
        const userId = (req as any).userId;
        const contractData: ContractData = req.body;

        if (!contractData.type) {
            return res.status(400).json({ error: "Contract type is required" });
        }

        if (!contractData.parties || contractData.parties.length < 2) {
            return res.status(400).json({ error: "At least two parties are required" });
        }

        // Generate the PDF
        const result = await generateContract(userId, contractData);

        // Save to database
        const savedDoc = await prisma.generatedDocument.create({
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
    } catch (error) {
        console.error("PDF generation error:", error);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
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

        // Delete from filesystem
        const filepath = path.join(__dirname, "../../", document.path);
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
