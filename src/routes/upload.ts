/**
 * @fileoverview File upload routes for user file management.
 * Handles single and multiple file uploads with proper validation.
 * @module routes/upload
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../services/prisma";
import { logger, logDbOperation } from "../services/logger";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { asyncHandler, HttpErrors } from "../middleware/error-handler";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Directory Setup
// ─────────────────────────────────────────────────────────────────────────────

/** Base directory for user uploads */
const uploadsDir = path.join(__dirname, "../../uploads/user-uploaded-files");

/** Directory for generated PDFs */
const pdfsDir = path.join(__dirname, "../../uploads/pdfs-generated");

// Ensure directories exist
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    logger.info(`[UPLOAD] Created uploads directory: ${uploadsDir}`);
}

if (!fs.existsSync(pdfsDir)) {
    fs.mkdirSync(pdfsDir, { recursive: true });
    logger.info(`[UPLOAD] Created PDFs directory: ${pdfsDir}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Multer Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Allowed MIME types for file uploads */
const ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** Maximum file size in bytes (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum number of files per upload */
const MAX_FILES = 5;

/**
 * Multer disk storage configuration.
 * Creates user-specific subdirectories for file organization.
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = (req as AuthenticatedRequest).userId;
        const userDir = path.join(uploadsDir, userId!);

        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with timestamp and random suffix
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    },
});

/**
 * File filter to validate upload MIME types.
 * Rejects files with disallowed types.
 */
const fileFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
): void => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype as any)) {
        cb(null, true);
    } else {
        logger.warn(`[UPLOAD] Rejected file type: ${file.mimetype}`);
        cb(new Error(`File type ${file.mimetype} not allowed`));
    }
};

/** Configured multer instance */
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 * Uploads a single file.
 * 
 * @route POST /api/upload
 * @security Bearer
 * @consumes multipart/form-data
 * @param {file} req.file - The file to upload
 * @returns {object} 200 - Uploaded file metadata
 * @returns {object} 400 - No file or invalid file type
 */
router.post("/", authenticate, upload.single("file"), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
        throw HttpErrors.badRequest("No file uploaded");
    }

    const userId = (req as AuthenticatedRequest).userId!;
    const fileUrl = `/uploads/user-uploaded-files/${userId}/${req.file.filename}`;

    // Save file metadata to database
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

    logDbOperation("create", "UserFile", true, `File ${savedFile.id} uploaded by ${userId}`);
    logger.info(`[UPLOAD] File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);

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
}));

/**
 * POST /api/upload/multiple
 * Uploads multiple files (up to 5).
 * 
 * @route POST /api/upload/multiple
 * @security Bearer
 * @consumes multipart/form-data
 * @param {files[]} req.files - Array of files to upload
 * @returns {object} 200 - Array of uploaded file metadata
 */
router.post("/multiple", authenticate, upload.array("files", MAX_FILES), asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    const userId = (req as AuthenticatedRequest).userId!;

    if (!files || files.length === 0) {
        throw HttpErrors.badRequest("No files uploaded");
    }

    // Save all files to database in parallel
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

    logger.info(`[UPLOAD] ${files.length} files uploaded by user ${userId}`);

    res.json({
        success: true,
        files: savedFiles,
    });
}));

/**
 * GET /api/upload/files
 * Lists all files uploaded by the authenticated user.
 * 
 * @route GET /api/upload/files
 * @security Bearer
 * @returns {Array} List of user's uploaded files
 */
router.get("/files", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;

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
}));

/**
 * DELETE /api/upload/:id
 * Deletes an uploaded file (from filesystem and database).
 * 
 * @route DELETE /api/upload/:id
 * @security Bearer
 * @param {string} req.params.id - File ID to delete
 * @returns {object} 200 - Success confirmation
 * @returns {object} 404 - File not found
 */
router.delete("/:id", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const { id } = req.params;

    // Find file and verify ownership
    const file = await prisma.userFile.findUnique({
        where: { id, userId }
    });

    if (!file) {
        throw HttpErrors.notFound("File");
    }

    // Delete from filesystem
    const filepath = path.join(__dirname, "../../", file.path);
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.debug(`[UPLOAD] Deleted file from disk: ${filepath}`);
    }

    // Delete from database
    await prisma.userFile.delete({ where: { id } });

    logDbOperation("delete", "UserFile", true, `File ${id} deleted by ${userId}`);

    res.json({ success: true });
}));

export default router;
