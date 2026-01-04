import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}

// Create uploads directory if it doesn't exist - now using user-uploaded-files
const uploadsDir = path.join(__dirname, "../../uploads/user-uploaded-files");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Also ensure pdfs-generated directory exists
const pdfsDir = path.join(__dirname, "../../uploads/pdfs-generated");
if (!fs.existsSync(pdfsDir)) {
    fs.mkdirSync(pdfsDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = (req as any).userId;
        const userDir = path.join(uploadsDir, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    },
});

// File filter for allowed types
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/markdown",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} not allowed`));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

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

// POST /api/upload - Upload a file
router.post("/", authenticate, upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const userId = (req as any).userId;
    const fileUrl = `/uploads/user-uploaded-files/${userId}/${req.file.filename}`;

    try {
        // Save file info to database
        const savedFile = await prisma.userFile.create({
            data: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                path: fileUrl,
                userId,
            }
        });

        res.json({
            success: true,
            file: {
                id: savedFile.id,
                originalName: req.file.originalname,
                filename: req.file.filename,
                mimetype: req.file.mimetype,
                size: req.file.size,
                url: fileUrl,
                createdAt: savedFile.createdAt
            },
        });
    } catch (error) {
        console.error("Error saving file to database:", error);
        res.status(500).json({ error: "Failed to save file" });
    }
});

// POST /api/upload/multiple - Upload multiple files
router.post("/multiple", authenticate, upload.array("files", 5), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    const userId = (req as any).userId;

    if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
    }

    try {
        const savedFiles = await Promise.all(files.map(async (file) => {
            const fileUrl = `/uploads/user-uploaded-files/${userId}/${file.filename}`;

            const saved = await prisma.userFile.create({
                data: {
                    filename: file.filename,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    path: fileUrl,
                    userId,
                }
            });

            return {
                id: saved.id,
                originalName: file.originalname,
                filename: file.filename,
                mimetype: file.mimetype,
                size: file.size,
                url: fileUrl,
                createdAt: saved.createdAt
            };
        }));

        res.json({
            success: true,
            files: savedFiles,
        });
    } catch (error) {
        console.error("Error saving files to database:", error);
        res.status(500).json({ error: "Failed to save files" });
    }
});

// GET /api/upload/files - List user's uploaded files
router.get("/files", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;

        const files = await prisma.userFile.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                filename: true,
                originalName: true,
                mimetype: true,
                size: true,
                path: true,
                createdAt: true
            }
        });

        res.json(files);
    } catch (error) {
        console.error("Error listing files:", error);
        res.status(500).json({ error: "Failed to list files" });
    }
});

// DELETE /api/upload/:id - Delete an uploaded file
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId;
        const { id } = req.params;

        const file = await prisma.userFile.findUnique({
            where: { id, userId }
        });

        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        // Delete from filesystem
        const filepath = path.join(__dirname, "../../", file.path);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }

        // Delete from database
        await prisma.userFile.delete({ where: { id } });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting file:", error);
        res.status(500).json({ error: "Failed to delete file" });
    }
});

export default router;
