import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}

// Middleware to verify JWT and check superadmin role
const authenticateSuperAdmin = async (req: Request, res: Response, next: Function) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

        // Check if user exists and has superadmin role
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true }
        });

        if (!user) {
            return res.status(401).json({ error: "User not found" });
        }

        if (user.role !== "superadmin") {
            return res.status(403).json({ error: "Access denied. Superadmin role required." });
        }

        (req as any).userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
};

// GET /api/admin/users - Get all users with conversation and message stats
router.get("/users", authenticateSuperAdmin, async (req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
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

        // Transform the data to include aggregated stats
        const usersWithStats = users.map(user => ({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt: user.createdAt,
            conversationCount: user._count.chats,
            messageCount: user.chats.reduce((total, chat) => total + chat._count.messages, 0)
        }));

        res.json({ users: usersWithStats });
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// GET /api/admin/stats - Get overall system statistics
router.get("/stats", authenticateSuperAdmin, async (req: Request, res: Response) => {
    try {
        const [userCount, chatCount, messageCount] = await Promise.all([
            prisma.user.count(),
            prisma.chat.count(),
            prisma.message.count()
        ]);

        res.json({
            totalUsers: userCount,
            totalConversations: chatCount,
            totalMessages: messageCount
        });
    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

export default router;
