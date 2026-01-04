import { Router, Request, Response } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma";
import { generateChatTitle } from "../services/title-generator";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}

// Middleware to verify JWT and extract userId
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

// GET /api/chats - List user's chats (with optional search)
router.get("/", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const search = req.query.search as string | undefined;

    const chats = await prisma.chat.findMany({
        where: {
            userId,
            ...(search ? { title: { contains: search } } : {})
        },
        orderBy: [
            { isPinned: "desc" },  // Pinned first
            { updatedAt: "desc" }
        ],
        select: { id: true, title: true, isPinned: true, createdAt: true, updatedAt: true },
    });

    res.json(chats);
});

// POST /api/chats - Create new chat (with optional AI-generated title)
router.post("/", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { title, firstMessage } = req.body;

    // Generate title from first message if not provided
    let chatTitle = title;
    if (!chatTitle && firstMessage) {
        chatTitle = await generateChatTitle(firstMessage);
    }

    const chat = await prisma.chat.create({
        data: { title: chatTitle || "New Chat", userId },
    });

    res.status(201).json(chat);
});

// GET /api/chats/:id - Get chat with messages
router.get("/:id", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;

    const chat = await prisma.chat.findUnique({
        where: { id, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    res.json(chat);
});

// GET /api/chats/:id/messages - Get messages for a chat
router.get("/:id/messages", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;

    // Verify chat belongs to user
    const chat = await prisma.chat.findUnique({ where: { id, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    const messages = await prisma.message.findMany({
        where: { chatId: id },
        orderBy: { createdAt: "asc" },
    });

    res.json(messages);
});

// DELETE /api/chats/:id - Delete chat
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;

    await prisma.chat.delete({ where: { id, userId } });
    res.json({ success: true });
});

// PATCH /api/chats/:id/pin - Toggle pin status
router.patch("/:id/pin", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;

    const chat = await prisma.chat.findUnique({ where: { id, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    const updated = await prisma.chat.update({
        where: { id },
        data: { isPinned: !chat.isPinned },
    });

    res.json(updated);
});

// PATCH /api/chats/:id/title - Update chat title (AI-generated or manual)
router.patch("/:id/title", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { title } = req.body;

    const chat = await prisma.chat.findUnique({ where: { id, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    const updated = await prisma.chat.update({
        where: { id },
        data: { title },
    });

    res.json(updated);
});

// POST /api/chats/:id/messages - Add message to chat
router.post("/:id/messages", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id: chatId } = req.params;
    const { role, content, sources, parentId } = req.body;

    // Verify chat belongs to user
    const chat = await prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    // If this is a regeneration (parentId provided), get the version number
    let version = 1;
    if (parentId) {
        const existingVersions = await prisma.message.count({
            where: { parentId }
        });
        version = existingVersions + 1;

        // Mark previous versions as inactive
        await prisma.message.updateMany({
            where: { parentId, isActive: true },
            data: { isActive: false }
        });
    }

    const message = await prisma.message.create({
        data: {
            role,
            content,
            sources: sources ? JSON.stringify(sources) : null,
            attachmentUrl: req.body.attachmentUrl || null,
            attachmentName: req.body.attachmentName || null,
            parentId: parentId || undefined,
            version,
            isActive: true,
            chatId,
        },
    });

    // Update chat's updatedAt
    await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

    res.status(201).json(message);
});

// PATCH /api/chats/:chatId/messages/:messageId - Update message feedback
router.patch("/:chatId/messages/:messageId", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { chatId, messageId } = req.params;
    const { feedback } = req.body;

    // Verify chat belongs to user
    const chat = await prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    // Validate feedback value
    if (feedback !== null && feedback !== "like" && feedback !== "dislike") {
        return res.status(400).json({ error: "Invalid feedback value" });
    }

    const message = await prisma.message.update({
        where: { id: messageId, chatId },
        data: { feedback },
    });

    res.json(message);
});

// GET /api/chats/:chatId/messages/:messageId/versions - Get all versions of a message
router.get("/:chatId/messages/:messageId/versions", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { chatId, messageId } = req.params;

    // Verify chat belongs to user
    const chat = await prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    // Get the original message to find its parentId
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
        return res.status(404).json({ error: "Message not found" });
    }

    // Find all versions with the same parentId (or if this is the parent)
    const parentId = message.parentId || message.id;

    const versions = await prisma.message.findMany({
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
});

// PATCH /api/chats/:chatId/messages/:messageId/activate - Set a version as active
router.patch("/:chatId/messages/:messageId/activate", authenticate, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { chatId, messageId } = req.params;

    // Verify chat belongs to user
    const chat = await prisma.chat.findUnique({ where: { id: chatId, userId } });
    if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
    }

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
        return res.status(404).json({ error: "Message not found" });
    }

    const parentId = message.parentId || message.id;

    // Deactivate all versions
    await prisma.message.updateMany({
        where: {
            OR: [{ id: parentId }, { parentId }],
            chatId
        },
        data: { isActive: false }
    });

    // Activate this version
    await prisma.message.update({
        where: { id: messageId },
        data: { isActive: true }
    });

    res.json({ success: true });
});

export default router;
