/**
 * @fileoverview Admin routes for superadmin dashboard and user management.
 * Provides user statistics, conversation viewing, and system metrics.
 * @module routes/admin
 */

import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { logger, logDbOperation } from "../services/logger";
import { authenticate, requireSuperAdmin, AuthenticatedRequest } from "../middleware/auth";
import { asyncHandler, HttpErrors } from "../middleware/error-handler";

const router = Router();

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
router.get("/users", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const adminId = (req as AuthenticatedRequest).userId;
    logger.info(`[ADMIN] User list requested by admin ${adminId}`);

    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
            marketingSource: true,
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
        marketingSource: user.marketingSource,
        conversationCount: user._count.chats,
        messageCount: user.chats.reduce((total, chat) => total + chat._count.messages, 0)
    }));

    logDbOperation("findMany", "User", true, `Retrieved ${users.length} users`);
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
router.get("/stats", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const adminId = (req as AuthenticatedRequest).userId;
    logger.info(`[ADMIN] Stats requested by admin ${adminId}`);

    // Fetch all counts in parallel for performance
    const [userCount, chatCount, messageCount] = await Promise.all([
        prisma.user.count(),
        prisma.chat.count(),
        prisma.message.count()
    ]);

    logDbOperation("count", "Stats", true, `Users: ${userCount}, Chats: ${chatCount}, Messages: ${messageCount}`);

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
router.get("/users/:userId/chats", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const adminId = (req as AuthenticatedRequest).userId;
    logger.info(`[ADMIN] Chats for user ${userId} requested by admin ${adminId}`);

    // Verify user exists
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true }
    });

    if (!user) {
        throw HttpErrors.notFound("User");
    }

    // Fetch user's chats with message counts
    const chats = await prisma.chat.findMany({
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
router.get("/chats/:chatId/messages", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { chatId } = req.params;
    const adminId = (req as AuthenticatedRequest).userId;
    logger.info(`[ADMIN] Messages for chat ${chatId} requested by admin ${adminId}`);

    const chat = await prisma.chat.findUnique({
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
        throw HttpErrors.notFound("Chat");
    }

    res.json(chat);
}));

export default router;
