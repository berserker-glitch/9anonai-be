"use strict";
/**
 * @fileoverview Admin routes for superadmin dashboard and user management.
 * Provides user statistics, conversation viewing, and system metrics.
 * @module routes/admin
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Admin Routes (all require superadmin role)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /api/admin/users
 * Retrieves all users with their conversation and message statistics.
 *
 * @route GET /api/admin/users
 * @security Bearer (superadmin)
 * @returns {object} 200 - List of users with stats
 */
router.get("/users", auth_1.authenticate, auth_1.requireSuperAdmin, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const adminId = req.userId;
    logger_1.logger.info(`[ADMIN] User list requested by admin ${adminId}`);
    const users = await prisma_1.prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
            _count: {
                select: {
                    chats: true
                }
            },
            chats: {
                select: {
                    _count: {
                        select: {
                            messages: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: "desc" }
    });
    // Transform data to include aggregated stats
    const usersWithStats = users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        conversationCount: user._count.chats,
        messageCount: user.chats.reduce((total, chat) => total + chat._count.messages, 0)
    }));
    (0, logger_1.logDbOperation)("findMany", "User", true, `Retrieved ${users.length} users`);
    res.json({ users: usersWithStats });
}));
/**
 * GET /api/admin/stats
 * Retrieves overall system statistics.
 *
 * @route GET /api/admin/stats
 * @security Bearer (superadmin)
 * @returns {object} 200 - System statistics (users, conversations, messages)
 */
router.get("/stats", auth_1.authenticate, auth_1.requireSuperAdmin, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const adminId = req.userId;
    logger_1.logger.info(`[ADMIN] Stats requested by admin ${adminId}`);
    // Fetch all counts in parallel for performance
    const [userCount, chatCount, messageCount] = await Promise.all([
        prisma_1.prisma.user.count(),
        prisma_1.prisma.chat.count(),
        prisma_1.prisma.message.count()
    ]);
    (0, logger_1.logDbOperation)("count", "Stats", true, `Users: ${userCount}, Chats: ${chatCount}, Messages: ${messageCount}`);
    res.json({
        totalUsers: userCount,
        totalConversations: chatCount,
        totalMessages: messageCount
    });
}));
/**
 * GET /api/admin/users/:userId/chats
 * Retrieves all conversations for a specific user.
 *
 * @route GET /api/admin/users/:userId/chats
 * @security Bearer (superadmin)
 * @param {string} req.params.userId - Target user's ID
 * @returns {object} 200 - User info and their chats
 * @returns {object} 404 - User not found
 */
router.get("/users/:userId/chats", auth_1.authenticate, auth_1.requireSuperAdmin, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { userId } = req.params;
    const adminId = req.userId;
    logger_1.logger.info(`[ADMIN] Chats for user ${userId} requested by admin ${adminId}`);
    // Verify user exists
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true }
    });
    if (!user) {
        throw error_handler_1.HttpErrors.notFound("User");
    }
    // Fetch user's chats with message counts
    const chats = await prisma_1.prisma.chat.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            _count: {
                select: { messages: true }
            }
        }
    });
    res.json({
        user,
        chats: chats.map(chat => ({
            ...chat,
            messageCount: chat._count.messages
        }))
    });
}));
/**
 * GET /api/admin/chats/:chatId/messages
 * Retrieves all messages for a specific chat (admin access).
 *
 * @route GET /api/admin/chats/:chatId/messages
 * @security Bearer (superadmin)
 * @param {string} req.params.chatId - Target chat's ID
 * @returns {object} 200 - Chat with user info and messages
 * @returns {object} 404 - Chat not found
 */
router.get("/chats/:chatId/messages", auth_1.authenticate, auth_1.requireSuperAdmin, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { chatId } = req.params;
    const adminId = req.userId;
    logger_1.logger.info(`[ADMIN] Messages for chat ${chatId} requested by admin ${adminId}`);
    const chat = await prisma_1.prisma.chat.findUnique({
        where: { id: chatId },
        include: {
            user: {
                select: { id: true, email: true, name: true }
            },
            messages: {
                orderBy: { createdAt: "asc" },
                select: {
                    id: true,
                    role: true,
                    content: true,
                    createdAt: true,
                    sources: true
                }
            }
        }
    });
    if (!chat) {
        throw error_handler_1.HttpErrors.notFound("Chat");
    }
    res.json(chat);
}));
exports.default = router;
