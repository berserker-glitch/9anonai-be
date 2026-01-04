import { Router, Request, Response } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { getLegalAdviceStream } from "../services/lawyer";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Validation Schema
const ChatSchema = z.object({
    message: z.string().min(1, "Message cannot be empty"),
    history: z.array(z.any()).optional(),
    images: z.array(z.object({
        data: z.string(), // base64
        mimeType: z.string(),
    })).optional(),
});

// Optional auth middleware - extracts userId if token present
const optionalAuth = (req: Request, res: Response, next: Function) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ") && JWT_SECRET) {
        const token = authHeader.split(" ")[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
            (req as any).userId = decoded.userId;
        } catch (error) {
            // Token invalid, continue without userId
        }
    }
    next();
};

router.post("/", optionalAuth, async (req: Request, res: Response) => {
    // Set Headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
        const { message, history, images } = ChatSchema.parse(req.body);
        const userId = (req as any).userId;

        // Consume Stream - pass userId for contract generation
        const stream = getLegalAdviceStream(message, history || [], images || [], userId);

        for await (const event of stream) {
            // Write event to stream
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        res.end();
    } catch (error) {
        console.error("Chat API Error:", error);
        // If headers not sent, send JSON error (rare case here since we set headers early)
        if (!res.headersSent) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ success: false, error: error.errors });
            } else {
                res.status(500).json({ success: false, error: "Internal Server Error" });
            }
        } else {
            // If stream started, send error event
            res.write(`data: ${JSON.stringify({ type: "error", content: "Internal Server Error" })}\n\n`);
            res.end();
        }
    }
});

export default router;
