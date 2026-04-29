"use strict";
/**
 * @fileoverview Quota guard middleware.
 * Enforces the per-conversation message limit for free-tier users.
 * Free plan: 15 user messages per conversation. Paid plans: unlimited.
 * @module middleware/quota-guard
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.quotaGuard = exports.FREE_MSG_WARN_AT = void 0;
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
/** Free plan conversation message limit */
const FREE_MSG_LIMIT = 15;
/** Warn after this many messages (used by FE to show counter) */
exports.FREE_MSG_WARN_AT = 12;
/**
 * Checks whether the authenticated user has an active paid subscription.
 * Returns the plan name, or "free" if no active paid sub exists.
 */
async function getUserPlanName(userId) {
    const sub = await prisma_1.prisma.subscription.findUnique({
        where: { userId },
        select: { status: true, plan: { select: { name: true } } },
    });
    if (sub && sub.status === 'active' && sub.plan.name !== 'free') {
        return sub.plan.name;
    }
    return 'free';
}
/**
 * Middleware that enforces the free-plan conversation cap.
 *
 * Must be placed AFTER optionalAuth/authenticate in the middleware chain,
 * and BEFORE the SSE headers are set, so a 402 JSON response can still be sent.
 *
 * Behaviour:
 * - Unauthenticated guests: allowed through (no quota).
 * - Superadmin: always allowed.
 * - Paid subscribers: always allowed.
 * - Free users with chatId in body: count their user-role messages in that chat.
 *   If count >= FREE_MSG_LIMIT, return 402 with structured error.
 * - Free users without chatId: allowed (new chat, first message).
 */
const quotaGuard = async (req, res, next) => {
    const userId = req.userId;
    const userRole = req.userRole;
    // Guests and superadmins are always allowed
    if (!userId || userRole === 'superadmin') {
        next();
        return;
    }
    try {
        const planName = await getUserPlanName(userId);
        // Paid plans have no conversation cap
        if (planName !== 'free') {
            next();
            return;
        }
        // Free plan: check the per-conversation message count
        const { chatId } = req.body;
        if (!chatId) {
            // First message of a brand-new chat — no existing count to check
            next();
            return;
        }
        const userMessageCount = await prisma_1.prisma.message.count({
            where: { chatId, role: 'user' },
        });
        if (userMessageCount >= FREE_MSG_LIMIT) {
            logger_1.logger.info(`[QUOTA] Conversation cap reached | user=${userId} chat=${chatId} count=${userMessageCount}`);
            res.status(402).json({
                error: 'conversation_limit_reached',
                limit: FREE_MSG_LIMIT,
                count: userMessageCount,
                plan: 'free',
                upgrade_url: '/pricing',
            });
            return;
        }
        // Attach remaining count so the FE can show the counter
        req.msgCount = userMessageCount;
        next();
    }
    catch (error) {
        // Fail open — a DB error should not block the user's message
        logger_1.logger.error('[QUOTA] Error in quota guard', { error, userId });
        next();
    }
};
exports.quotaGuard = quotaGuard;
