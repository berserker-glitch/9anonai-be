"use strict";
/**
 * @fileoverview File upload routes for user file management.
 * Handles single and multiple file uploads with proper validation.
 * @module routes/upload
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Directory Setup
// ─────────────────────────────────────────────────────────────────────────────
/** Base directory for user uploads */
const uploadsDir = path_1.default.join(__dirname, "../../uploads/user-uploaded-files");
/** Directory for generated PDFs */
const pdfsDir = path_1.default.join(__dirname, "../../uploads/pdfs-generated");
// Ensure directories exist
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
    logger_1.logger.info(`[UPLOAD] Created uploads directory: ${uploadsDir}`);
}
if (!fs_1.default.existsSync(pdfsDir)) {
    fs_1.default.mkdirSync(pdfsDir, { recursive: true });
    logger_1.logger.info(`[UPLOAD] Created PDFs directory: ${pdfsDir}`);
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
];
/** Maximum file size in bytes (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** Maximum number of files per upload */
const MAX_FILES = 5;
/**
 * Multer disk storage configuration.
 * Creates user-specific subdirectories for file organization.
 */
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
        // Generate unique filename with timestamp and random suffix
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path_1.default.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    },
});
/**
 * File filter to validate upload MIME types.
 * Rejects files with disallowed types.
 */
const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        logger_1.logger.warn(`[UPLOAD] Rejected file type: ${file.mimetype}`);
        cb(new Error(`File type ${file.mimetype} not allowed`));
    }
};
/** Configured multer instance */
const upload = (0, multer_1.default)({
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
router.post("/", auth_1.authenticate, upload.single("file"), (0, error_handler_1.asyncHandler)(async (req, res) => {
    if (!req.file) {
        throw error_handler_1.HttpErrors.badRequest("No file uploaded");
    }
    const userId = req.userId;
    const fileUrl = `/uploads/user-uploaded-files/${userId}/${req.file.filename}`;
    // Save file metadata to database
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
    (0, logger_1.logDbOperation)("create", "UserFile", true, `File ${savedFile.id} uploaded by ${userId}`);
    logger_1.logger.info(`[UPLOAD] File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);
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
router.post("/multiple", auth_1.authenticate, upload.array("files", MAX_FILES), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const files = req.files;
    const userId = req.userId;
    if (!files || files.length === 0) {
        throw error_handler_1.HttpErrors.badRequest("No files uploaded");
    }
    // Save all files to database in parallel
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
    logger_1.logger.info(`[UPLOAD] ${files.length} files uploaded by user ${userId}`);
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
router.get("/files", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
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
router.delete("/:id", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    // Find file and verify ownership
    const file = await prisma_1.prisma.userFile.findUnique({
        where: { id, userId }
    });
    if (!file) {
        throw error_handler_1.HttpErrors.notFound("File");
    }
    // Delete from filesystem
    const filepath = path_1.default.join(__dirname, "../../", file.path);
    if (fs_1.default.existsSync(filepath)) {
        fs_1.default.unlinkSync(filepath);
        logger_1.logger.debug(`[UPLOAD] Deleted file from disk: ${filepath}`);
    }
    // Delete from database
    await prisma_1.prisma.userFile.delete({ where: { id } });
    (0, logger_1.logDbOperation)("delete", "UserFile", true, `File ${id} deleted by ${userId}`);
    res.json({ success: true });
}));
exports.default = router;
