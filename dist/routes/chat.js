"use strict";
/**
 * @fileoverview Chat routes for AI-powered legal advice streaming.
 * Provides SSE streaming and non-streaming endpoints for chat interactions.
 * @module routes/chat
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const lawyer_1 = require("../services/lawyer");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Schema for chat request body validation.
 */
const ChatSchema = zod_1.z.object({
    /** User's message/question */
    message: zod_1.z.string().min(1, "Message cannot be empty"),
    /** Previous conversation history for context */
    history: zod_1.z.array(zod_1.z.any()).optional(),
    /** Optional image attachments */
    images: zod_1.z.array(zod_1.z.object({
        data: zod_1.z.string(), // base64 encoded
        mimeType: zod_1.z.string(),
    })).optional(),
});
// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/chat
 * Streams AI legal advice response using Server-Sent Events (SSE).
 * Supports optional authentication for personalized responses.
 *
 * @route POST /api/chat
 * @security Bearer (optional)
 * @param {string} req.body.message - User's question or message
 * @param {Array} [req.body.history] - Previous messages for context
 * @param {Array} [req.body.images] - Image attachments (base64)
 * @returns {stream} SSE stream with AI response tokens and metadata
 */
router.post("/", auth_1.optionalAuth, async (req, res) => {
    // Set up SSE headers for streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        const userId = req.userId;
        // Log chat event
        (0, logger_1.logChatEvent)("stream_start", userId || null, {
            messageLength: message.length,
            historyLength: history?.length || 0,
            imageCount: images?.length || 0
        });
        // Start streaming response
        const stream = (0, lawyer_1.getLegalAdviceStream)(message, history || [], images || [], userId);
        // Stream events to client
        for await (const event of stream) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        (0, logger_1.logChatEvent)("stream_complete", userId || null);
        res.end();
    }
    catch (error) {
        logger_1.logger.error("[CHAT] Streaming error", { error });
        // Handle error based on whether headers were sent
        if (!res.headersSent) {
            if (error instanceof zod_1.z.ZodError) {
                res.status(400).json({ success: false, error: error.errors });
            }
            else {
                res.status(500).json({ success: false, error: "Internal Server Error" });
            }
        }
        else {
            // If stream already started, send error event
            res.write(`data: ${JSON.stringify({
                type: "error",
                content: "An error occurred during generation"
            })}\n\n`);
            res.end();
        }
    }
});
/**
 * POST /api/chat/non-stream
 * Returns complete AI response as JSON (for clients that don't support SSE).
 * Designed for React Native and other non-streaming clients.
 *
 * @route POST /api/chat/non-stream
 * @security Bearer (optional)
 * @param {string} req.body.message - User's question or message
 * @param {Array} [req.body.history] - Previous messages for context
 * @param {Array} [req.body.images] - Image attachments (base64)
 * @returns {object} 200 - Complete response with content and sources
 */
router.post("/non-stream", auth_1.optionalAuth, async (req, res) => {
    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        const userId = req.userId;
        (0, logger_1.logChatEvent)("non_stream_start", userId || null, {
            messageLength: message.length
        });
        // Consume stream and collect all events
        const stream = (0, lawyer_1.getLegalAdviceStream)(message, history || [], images || [], userId);
        let fullContent = "";
        let sources = [];
        let contract = null;
        for await (const event of stream) {
            switch (event.type) {
                case "token":
                    fullContent += event.content;
                    break;
                case "citation":
                    sources = event.sources || [];
                    break;
                case "contract_generated":
                    contract = event.document ? {
                        title: event.document.title,
                        path: event.document.id,
                        type: event.document.type
                    } : null;
                    break;
            }
        }
        (0, logger_1.logChatEvent)("non_stream_complete", userId || null, {
            responseLength: fullContent.length,
            sourceCount: sources.length
        });
        res.json({
            success: true,
            content: fullContent,
            sources,
            contract
        });
    }
    catch (error) {
        logger_1.logger.error("[CHAT] Non-stream error", { error });
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ success: false, error: error.errors });
        }
        else {
            res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    }
});
exports.default = router;
