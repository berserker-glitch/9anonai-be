import { Router, Request, Response } from "express";
import { z } from "zod";
import { getLegalAdviceStream } from "../services/lawyer";

const router = Router();

// Validation Schema
const ChatSchema = z.object({
    message: z.string().min(1, "Message cannot be empty"),
    history: z.array(z.any()).optional(),
    images: z.array(z.object({
        data: z.string(), // base64
        mimeType: z.string(),
    })).optional(),
});

router.post("/", async (req: Request, res: Response) => {
    // Set Headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
        const { message, history, images } = ChatSchema.parse(req.body);

        // Consume Stream
        const stream = getLegalAdviceStream(message, history || [], images || []);

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
