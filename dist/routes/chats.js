"use strict";
/**
 * @fileoverview Chat persistence routes for managing conversation history.
 * Provides CRUD operations for chats and messages with versioning support.
 * @module routes/chats
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../services/prisma");
const title_generator_1 = require("../services/title-generator");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Schema for creating a new chat.
 */
const CreateChatSchema = zod_1.z.object({
    title: zod_1.z.string().optional(),
    firstMessage: zod_1.z.string().optional(),
});
/**
 * Schema for adding a message to a chat.
 */
const AddMessageSchema = zod_1.z.object({
    role: zod_1.z.enum(["user", "assistant"]),
    content: zod_1.z.string(),
    sources: zod_1.z.any().optional(),
    parentId: zod_1.z.string().optional(),
    attachmentUrl: zod_1.z.string().optional(),
    attachmentName: zod_1.z.string().optional(),
});
/**
 * Schema for updating message feedback.
 */
const FeedbackSchema = zod_1.z.object({
    feedback: zod_1.z.enum(["like", "dislike"]).nullable(),
});
// ─────────────────────────────────────────────────────────────────────────────
// Chat CRUD Routes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /api/chats
 * Lists all chats for the authenticated user.
 * Supports search filtering by title.
 *
 * @route GET /api/chats
 * @security Bearer
 * @param {string} [req.query.search] - Optional search filter for chat titles
 * @returns {Array} List of user's chats (pinned first, then by updatedAt)
 */
router.get("/", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const search = req.query.search;
    const chats = await prisma_1.prisma.chat.findMany({
        where: {
            userId,
            ...(search ? { title: { contains: search } } : {})
        },
        orderBy: [
            { isPinned: "desc" }, // Pinned chats first
            { updatedAt: "desc" } // Then by most recent
        ],
        select: {
            id: true,
            title: true,
            isPinned: true,
            createdAt: true,
            updatedAt: true
        },
    });
    (0, logger_1.logDbOperation)("findMany", "Chat", true, `Found ${chats.length} chats for user ${userId}`);
    res.json(chats);
}));
/**
 * POST /api/chats
 * Creates a new chat with optional AI-generated title.
 *
 * @route POST /api/chats
 * @security Bearer
 * @param {string} [req.body.title] - Optional custom title
 * @param {string} [req.body.firstMessage] - First message for AI title generation
 * @returns {object} 201 - Created chat object
 */
router.post("/", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { title, firstMessage } = CreateChatSchema.parse(req.body);
    // Generate title from first message if not provided
    let chatTitle = title;
    if (!chatTitle && firstMessage) {
        chatTitle = await (0, title_generator_1.generateChatTitle)(firstMessage);
        logger_1.logger.debug(`[CHATS] Generated title: "${chatTitle}" for user ${userId}`);
    }
    const chat = await prisma_1.prisma.chat.create({
        data: {
            title: chatTitle || "New Chat",
            userId
        },
    });
    (0, logger_1.logDbOperation)("create", "Chat", true, `Chat ${chat.id} created`);
    res.status(201).json(chat);
}));
/**
 * GET /api/chats/:id
 * Retrieves a chat with all its messages.
 *
 * @route GET /api/chats/:id
 * @security Bearer
 * @param {string} req.params.id - Chat ID
 * @returns {object} 200 - Chat with messages
 * @returns {object} 404 - Chat not found
 */
router.get("/:id", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const chat = await prisma_1.prisma.chat.findUnique({
        where: { id, userId },
        include: {
            messages: {
                orderBy: { createdAt: "asc" }
            }
        },
    });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    res.json(chat);
}));
/**
 * GET /api/chats/:id/messages
 * Retrieves messages for a specific chat.
 *
 * @route GET /api/chats/:id/messages
 * @security Bearer
 * @param {string} req.params.id - Chat ID
 * @returns {Array} List of messages ordered by creation time
 */
router.get("/:id/messages", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    // Verify chat belongs to user
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    const messages = await prisma_1.prisma.message.findMany({
        where: { chatId: id },
        orderBy: { createdAt: "asc" },
    });
    res.json(messages);
}));
/**
 * DELETE /api/chats/:id
 * Deletes a chat and all its messages.
 *
 * @route DELETE /api/chats/:id
 * @security Bearer
 * @param {string} req.params.id - Chat ID
 * @returns {object} 200 - Success confirmation
 */
router.delete("/:id", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    await prisma_1.prisma.chat.delete({ where: { id, userId } });
    (0, logger_1.logDbOperation)("delete", "Chat", true, `Chat ${id} deleted by user ${userId}`);
    res.json({ success: true });
}));
// ─────────────────────────────────────────────────────────────────────────────
// Chat Management Routes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * PATCH /api/chats/:id/pin
 * Toggles the pin status of a chat.
 *
 * @route PATCH /api/chats/:id/pin
 * @security Bearer
 * @param {string} req.params.id - Chat ID
 * @returns {object} 200 - Updated chat with new pin status
 */
router.patch("/:id/pin", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    const updated = await prisma_1.prisma.chat.update({
        where: { id },
        data: { isPinned: !chat.isPinned },
    });
    logger_1.logger.debug(`[CHATS] Chat ${id} pin toggled: ${updated.isPinned}`);
    res.json(updated);
}));
/**
 * PATCH /api/chats/:id/title
 * Updates the title of a chat.
 *
 * @route PATCH /api/chats/:id/title
 * @security Bearer
 * @param {string} req.params.id - Chat ID
 * @param {string} req.body.title - New title
 * @returns {object} 200 - Updated chat
 */
router.patch("/:id/title", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title } = req.body;
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    const updated = await prisma_1.prisma.chat.update({
        where: { id },
        data: { title },
    });
    res.json(updated);
}));
// ─────────────────────────────────────────────────────────────────────────────
// Message Routes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/chats/:id/messages
 * Adds a new message to a chat.
 * Supports message versioning for regeneration.
 *
 * @route POST /api/chats/:id/messages
 * @security Bearer
 * @param {string} req.params.id - Chat ID
 * @param {string} req.body.role - Message role ("user" or "assistant")
 * @param {string} req.body.content - Message content
 * @param {any} [req.body.sources] - Citation sources
 * @param {string} [req.body.parentId] - Parent message ID for versioning
 * @returns {object} 201 - Created message
 */
router.post("/:id/messages", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { id: chatId } = req.params;
    const messageData = AddMessageSchema.parse(req.body);
    // Verify chat belongs to user
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    // Handle message versioning for regeneration
    let version = 1;
    if (messageData.parentId) {
        const existingVersions = await prisma_1.prisma.message.count({
            where: { parentId: messageData.parentId }
        });
        version = existingVersions + 1;
        // Mark previous versions as inactive
        await prisma_1.prisma.message.updateMany({
            where: { parentId: messageData.parentId, isActive: true },
            data: { isActive: false }
        });
    }
    // Create new message
    const message = await prisma_1.prisma.message.create({
        data: {
            role: messageData.role,
            content: messageData.content,
            sources: messageData.sources ? JSON.stringify(messageData.sources) : null,
            attachmentUrl: messageData.attachmentUrl || null,
            attachmentName: messageData.attachmentName || null,
            parentId: messageData.parentId || undefined,
            version,
            isActive: true,
            chatId,
        },
    });
    // Update chat's timestamp
    await prisma_1.prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() }
    });
    (0, logger_1.logDbOperation)("create", "Message", true, `Message ${message.id} added to chat ${chatId}`);
    res.status(201).json(message);
}));
/**
 * PATCH /api/chats/:chatId/messages/:messageId
 * Updates feedback (like/dislike) on a message.
 *
 * @route PATCH /api/chats/:chatId/messages/:messageId
 * @security Bearer
 * @param {string} req.params.chatId - Chat ID
 * @param {string} req.params.messageId - Message ID
 * @param {string|null} req.body.feedback - "like", "dislike", or null
 * @returns {object} 200 - Updated message
 */
router.patch("/:chatId/messages/:messageId", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { chatId, messageId } = req.params;
    const { feedback } = FeedbackSchema.parse(req.body);
    // Verify chat belongs to user
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    const message = await prisma_1.prisma.message.update({
        where: { id: messageId, chatId },
        data: { feedback },
    });
    logger_1.logger.debug(`[CHATS] Feedback ${feedback} set on message ${messageId}`);
    res.json(message);
}));
// ─────────────────────────────────────────────────────────────────────────────
// Message Versioning Routes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /api/chats/:chatId/messages/:messageId/versions
 * Retrieves all versions of a regenerated message.
 *
 * @route GET /api/chats/:chatId/messages/:messageId/versions
 * @security Bearer
 * @returns {Array} List of message versions
 */
router.get("/:chatId/messages/:messageId/versions", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { chatId, messageId } = req.params;
    // Verify chat belongs to user
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    // Get the original message to find its parentId
    const message = await prisma_1.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
        throw error_handler_1.HttpErrors.notFound("Message");
    }
    // Find all versions with the same parentId
    const parentId = message.parentId || message.id;
    const versions = await prisma_1.prisma.message.findMany({
        where: {
            OR: [
                { id: parentId },
                { parentId: parentId }
            ],
            chatId
        },
        orderBy: { version: "asc" }
    });
    res.json(versions);
}));
/**
 * PATCH /api/chats/:chatId/messages/:messageId/activate
 * Sets a specific message version as the active one.
 *
 * @route PATCH /api/chats/:chatId/messages/:messageId/activate
 * @security Bearer
 * @returns {object} 200 - Success confirmation
 */
router.patch("/:chatId/messages/:messageId/activate", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { chatId, messageId } = req.params;
    // Verify chat belongs to user
    const chat = await prisma_1.prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    const message = await prisma_1.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
        throw error_handler_1.HttpErrors.notFound("Message");
    }
    const parentId = message.parentId || message.id;
    // Deactivate all versions
    await prisma_1.prisma.message.updateMany({
        where: {
            OR: [{ id: parentId }, { parentId }],
            chatId
        },
        data: { isActive: false }
    });
    // Activate selected version
    await prisma_1.prisma.message.update({
        where: { id: messageId },
        data: { isActive: true }
    });
    logger_1.logger.debug(`[CHATS] Activated message version ${messageId}`);
    res.json({ success: true });
}));
exports.default = router;
