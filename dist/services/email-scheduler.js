"use strict";
/**
 * @fileoverview Email scheduler for 9anon re-engagement campaigns.
 * Runs daily cron jobs to identify inactive users and send re-engagement emails.
 *
 * Setup: Runs automatically on app startup via initEmailScheduler().
 * Requires RESEND_API_KEY to be set — silently skips if not configured.
 *
 * @module services/email-scheduler
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initEmailScheduler = initEmailScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("./prisma");
const email_1 = require("./email");
const logger_1 = require("./logger");
// ─── Constants ───────────────────────────────────────────────────────────────
/** Re-engagement window: send email to users inactive for exactly 3 days */
const REENGAGEMENT_DAYS = 3;
/** Max emails per scheduler run (avoid spamming on large user bases) */
const MAX_EMAILS_PER_RUN = 50;
// ─── Re-engagement Job ────────────────────────────────────────────────────────
async function runReengagementJob() {
    if (!process.env.RESEND_API_KEY) {
        logger_1.logger.debug("[SCHEDULER] No RESEND_API_KEY — skipping re-engagement job");
        return;
    }
    const now = new Date();
    const cutoffStart = new Date(now);
    cutoffStart.setDate(cutoffStart.getDate() - REENGAGEMENT_DAYS - 1); // 4 days ago
    const cutoffEnd = new Date(now);
    cutoffEnd.setDate(cutoffEnd.getDate() - REENGAGEMENT_DAYS); // 3 days ago
    try {
        // Find users who:
        // 1. Are onboarded (sent at least one message — lastActiveAt is set)
        // 2. Were last active 3 days ago (within 1-day window to avoid double-sending)
        // 3. Have not been active since
        const inactiveUsers = await prisma_1.prisma.user.findMany({
            where: {
                isOnboarded: true,
                lastActiveAt: {
                    gte: cutoffStart,
                    lt: cutoffEnd,
                },
            },
            select: {
                id: true,
                email: true,
                name: true,
                personalization: true,
            },
            take: MAX_EMAILS_PER_RUN,
        });
        if (inactiveUsers.length === 0) {
            logger_1.logger.debug("[SCHEDULER] Re-engagement: No inactive users to contact today");
            return;
        }
        logger_1.logger.info(`[SCHEDULER] Re-engagement: Sending to ${inactiveUsers.length} inactive users`);
        let sent = 0;
        for (const user of inactiveUsers) {
            // Detect user's preferred language from personalization JSON
            let lang = "ar";
            try {
                if (user.personalization) {
                    const p = JSON.parse(user.personalization);
                    if (p.spokenLanguage && p.spokenLanguage !== "auto") {
                        lang = p.spokenLanguage;
                    }
                }
            }
            catch {
                // Use default language
            }
            try {
                await (0, email_1.sendReengagementEmail)(user.email, user.name, lang);
                sent++;
            }
            catch (err) {
                logger_1.logger.error("[SCHEDULER] Failed to send re-engagement email", {
                    userId: user.id,
                    error: err?.message,
                });
            }
        }
        logger_1.logger.info(`[SCHEDULER] Re-engagement: Sent ${sent}/${inactiveUsers.length} emails`);
    }
    catch (err) {
        logger_1.logger.error("[SCHEDULER] Re-engagement job failed", { error: err?.message });
    }
}
// ─── Scheduler Init ────────────────────────────────────────────────────────
/**
 * Initializes all email cron jobs.
 * Called once on server startup from app.ts.
 */
function initEmailScheduler() {
    // Run re-engagement job every day at 9:00 AM (server time)
    node_cron_1.default.schedule("0 9 * * *", () => {
        logger_1.logger.info("[SCHEDULER] Running daily re-engagement email job...");
        runReengagementJob();
    });
    logger_1.logger.info("[SCHEDULER] Email scheduler initialized (re-engagement: daily at 09:00)");
}
