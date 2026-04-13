/**
 * @fileoverview Newsletter subscription route.
 * Stores subscriber emails and sends a welcome email via Resend.
 * @module routes/newsletter
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../services/prisma";
import { logger } from "../services/logger";
import { asyncHandler, HttpErrors } from "../middleware/error-handler";
import { sendWelcomeNewsletterEmail } from "../services/email";

const router = Router();

// ─── Validation ──────────────────────────────────────────────────────────────

const SubscribeSchema = z.object({
    email: z.string().email("Invalid email"),
    lang: z.enum(["ar", "fr", "en"]).default("ar"),
    source: z.string().optional().default("blog"),
});

// ─── Rate limiting (5 subscriptions per IP per hour) ─────────────────────────

const subscribeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
});

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/newsletter/subscribe
 * Adds an email to the subscriber list and sends a welcome email.
 */
router.post(
    "/subscribe",
    subscribeLimiter,
    asyncHandler(async (req: Request, res: Response) => {
        const { email, lang, source } = SubscribeSchema.parse(req.body);

        // Upsert — silently succeed if already subscribed
        const existing = await prisma.subscriber.findUnique({ where: { email } });
        if (existing) {
            return res.json({ success: true, message: "Already subscribed" });
        }

        await prisma.subscriber.create({
            data: { email, lang, source },
        });

        logger.info(`[NEWSLETTER] New subscriber: ${email} (${lang}, ${source})`);

        // Send welcome email (fire-and-forget — don't block the response)
        sendWelcomeNewsletterEmail(email, lang).catch((err) =>
            logger.error("[NEWSLETTER] Failed to send welcome email", { error: err?.message })
        );

        return res.status(201).json({ success: true, message: "Subscribed successfully" });
    })
);

export default router;
