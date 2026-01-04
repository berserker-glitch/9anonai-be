"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../services/prisma");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}
// Create uploads directory if it doesn't exist - now using user-uploaded-files
const uploadsDir = path_1.default.join(__dirname, "../../uploads/user-uploaded-files");
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
// Also ensure pdfs-generated directory exists
const pdfsDir = path_1.default.join(__dirname, "../../uploads/pdfs-generated");
if (!fs_1.default.existsSync(pdfsDir)) {
    fs_1.default.mkdirSync(pdfsDir, { recursive: true });
}
// Multer configuration
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const userId = req.userId;
        const userDir = path_1.default.join(uploadsDir, userId);
        if (!fs_1.default.existsSync(userDir)) {
            fs_1.default.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path_1.default.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    },
});
// File filter for allowed types
const fileFilter = (req, file, cb) => {
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
    }
    else {
        cb(new Error(`File type ${file.mimetype} not allowed`));
    }
};
const upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});
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
// POST /api/upload - Upload a file
router.post("/", authenticate, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }
    const userId = req.userId;
    const fileUrl = `/uploads/user-uploaded-files/${userId}/${req.file.filename}`;
    try {
        // Save file info to database
        const savedFile = await prisma_1.prisma.userFile.create({
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
    }
    catch (error) {
        console.error("Error saving file to database:", error);
        res.status(500).json({ error: "Failed to save file" });
    }
});
// POST /api/upload/multiple - Upload multiple files
router.post("/multiple", authenticate, upload.array("files", 5), async (req, res) => {
    const files = req.files;
    const userId = req.userId;
    if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
    }
    try {
        const savedFiles = await Promise.all(files.map(async (file) => {
            const fileUrl = `/uploads/user-uploaded-files/${userId}/${file.filename}`;
            const saved = await prisma_1.prisma.userFile.create({
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
    }
    catch (error) {
        console.error("Error saving files to database:", error);
        res.status(500).json({ error: "Failed to save files" });
    }
});
// GET /api/upload/files - List user's uploaded files
router.get("/files", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const files = await prisma_1.prisma.userFile.findMany({
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
    }
    catch (error) {
        console.error("Error listing files:", error);
        res.status(500).json({ error: "Failed to list files" });
    }
});
// DELETE /api/upload/:id - Delete an uploaded file
router.delete("/:id", authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const file = await prisma_1.prisma.userFile.findUnique({
            where: { id, userId }
        });
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }
        // Delete from filesystem
        const filepath = path_1.default.join(__dirname, "../../", file.path);
        if (fs_1.default.existsSync(filepath)) {
            fs_1.default.unlinkSync(filepath);
        }
        // Delete from database
        await prisma_1.prisma.userFile.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error("Error deleting file:", error);
        res.status(500).json({ error: "Failed to delete file" });
    }
});
exports.default = router;
