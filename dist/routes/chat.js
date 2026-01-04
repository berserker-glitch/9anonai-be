"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const lawyer_1 = require("../services/lawyer");
const router = (0, express_1.Router)();
// Validation Schema
const ChatSchema = zod_1.z.object({
    message: zod_1.z.string().min(1, "Message cannot be empty"),
    history: zod_1.z.array(zod_1.z.any()).optional(),
    images: zod_1.z.array(zod_1.z.object({
        data: zod_1.z.string(), // base64
        mimeType: zod_1.z.string(),
    })).optional(),
});
router.post("/", async (req, res) => {
    // Set Headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        // Consume Stream
        const stream = (0, lawyer_1.getLegalAdviceStream)(message, history || [], images || []);
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
exports.default = router;
