"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");

const router = (0, express_1.Router)();

async function generateUniqueReferralCode() {
    while (true) {
        const code = (0, crypto_1.randomBytes)(4).toString("hex").toUpperCase();
        const existing = await prisma_1.prisma.user.findUnique({ where: { referralCode: code } });
        if (!existing) return code;
    }
}

/**
 * GET /api/referrals/me
 * Returns the authenticated user's referral code, referral count, and earned credits.
 * If the user has no referral code yet (registered before the system launched),
 * one is generated and saved automatically.
 */
router.get("/me", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;

    let user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            referralCode: true,
            referralCredits: true,
            _count: { select: { referrals: true } },
        },
    });

    if (!user) throw error_handler_1.HttpErrors.notFound("User");

    // Back-fill referral code for users who registered before the system launched
    if (!user.referralCode) {
        const newCode = await generateUniqueReferralCode();
        user = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { referralCode: newCode },
            select: {
                referralCode: true,
                referralCredits: true,
                _count: { select: { referrals: true } },
            },
        });
        logger_1.logger.info(`[REFERRALS] Back-filled referral code ${newCode} for user ${userId}`);
    }

    logger_1.logger.debug(`[REFERRALS] Stats fetched for user ${userId}`);

    res.json({
        code: user.referralCode,
        credits: user.referralCredits,
        referralCount: user._count.referrals,
    });
}));

exports.default = router;
