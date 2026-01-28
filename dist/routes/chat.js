"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const lawyer_1 = require("../services/lawyer");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET;
// Validation Schema
const ChatSchema = zod_1.z.object({
    message: zod_1.z.string().min(1, "Message cannot be empty"),
    history: zod_1.z.array(zod_1.z.any()).optional(),
    images: zod_1.z.array(zod_1.z.object({
        data: zod_1.z.string(), // base64
        mimeType: zod_1.z.string(),
    })).optional(),
});
// Optional auth middleware - extracts userId if token present
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ") && JWT_SECRET) {
        const token = authHeader.split(" ")[1];
        try {
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            req.userId = decoded.userId;
        }
        catch (error) {
            // Token invalid, continue without userId
        }
    }
    next();
};
router.post("/", optionalAuth, async (req, res) => {
    // Set Headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        const userId = req.userId;
        // Consume Stream - pass userId for contract generation
        const stream = (0, lawyer_1.getLegalAdviceStream)(message, history || [], images || [], userId);
        for await (const event of stream) {
            // Write event to stream
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
    }
    catch (error) {
        console.error("Chat API Error:", error);
        // If headers not sent, send JSON error (rare case here since we set headers early)
        if (!res.headersSent) {
            if (error instanceof zod_1.z.ZodError) {
                res.status(400).json({ success: false, error: error.errors });
            }
            else {
                res.status(500).json({ success: false, error: "Internal Server Error" });
            }
        }
        else {
            // If stream started, send error event
            res.write(`data: ${JSON.stringify({ type: "error", content: "Internal Server Error" })}\n\n`);
            res.end();
        }
    }
});
// Non-streaming endpoint for React Native (doesn't support ReadableStream)
router.post("/non-stream", optionalAuth, async (req, res) => {
    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        const userId = req.userId;
        // Consume Stream and collect all events
        const stream = (0, lawyer_1.getLegalAdviceStream)(message, history || [], images || [], userId);
        let fullContent = "";
        let sources = [];
        let contract = null;
        for await (const event of stream) {
            if (event.type === "token") {
                fullContent += event.content;
            }
            else if (event.type === "citation") {
                sources = event.sources || [];
            }
            else if (event.type === "contract_generated") {
                contract = event.document ? {
                    title: event.document.title,
                    path: event.document.id,
                    type: event.document.type
                } : null;
            }
        }
        res.json({
            success: true,
            content: fullContent,
            sources,
            contract
        });
    }
    catch (error) {
        console.error("Non-stream Chat API Error:", error);
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ success: false, error: error.errors });
        }
        else {
            res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    }
});
exports.default = router;
