"use strict";
/**
 * @fileoverview Newsletter subscription route.
 * Stores subscriber emails and sends a welcome email via Resend.
 * @module routes/newsletter
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const error_handler_1 = require("../middleware/error-handler");
const email_1 = require("../services/email");
const router = (0, express_1.Router)();
// ─── Validation ──────────────────────────────────────────────────────────────
const SubscribeSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email"),
    lang: zod_1.z.enum(["ar", "fr", "en"]).default("ar"),
    source: zod_1.z.string().optional().default("blog"),
});
// ─── Rate limiting (5 subscriptions per IP per hour) ─────────────────────────
const subscribeLimiter = (0, express_rate_limit_1.default)({
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
router.post("/subscribe", subscribeLimiter, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { email, lang, source } = SubscribeSchema.parse(req.body);
    // Upsert — silently succeed if already subscribed
    const existing = await prisma_1.prisma.subscriber.findUnique({ where: { email } });
    if (existing) {
        return res.json({ success: true, message: "Already subscribed" });
    }
    await prisma_1.prisma.subscriber.create({
        data: { email, lang, source },
    });
    logger_1.logger.info(`[NEWSLETTER] New subscriber: ${email} (${lang}, ${source})`);
    // Send welcome email (fire-and-forget — don't block the response)
    (0, email_1.sendWelcomeNewsletterEmail)(email, lang).catch((err) => logger_1.logger.error("[NEWSLETTER] Failed to send welcome email", { error: err?.message }));
    return res.status(201).json({ success: true, message: "Subscribed successfully" });
}));
exports.default = router;
