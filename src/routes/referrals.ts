import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import { prisma } from "../services/prisma";
import { logger } from "../services/logger";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { asyncHandler, HttpErrors } from "../middleware/error-handler";

const router = Router();

async function generateUniqueReferralCode(): Promise<string> {
    while (true) {
        const code = randomBytes(4).toString("hex").toUpperCase();
        const existing = await prisma.user.findUnique({ where: { referralCode: code } });
        if (!existing) return code;
    }
}

/**
 * GET /api/referrals/me
 * Returns the authenticated user's referral code, referral count, and earned credits.
 * If the user has no referral code yet (registered before the system launched),
 * one is generated and saved automatically.
 */
router.get("/me", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;

    let user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            referralCode: true,
            referralCredits: true,
            _count: { select: { referrals: true } },
        },
    });

    if (!user) throw HttpErrors.notFound("User");

    // Back-fill referral code for users who registered before the system launched
    if (!user.referralCode) {
        const newCode = await generateUniqueReferralCode();
        user = await prisma.user.update({
            where: { id: userId },
            data: { referralCode: newCode },
            select: {
                referralCode: true,
                referralCredits: true,
                _count: { select: { referrals: true } },
            },
        });
        logger.info(`[REFERRALS] Back-filled referral code ${newCode} for user ${userId}`);
    }

    logger.debug(`[REFERRALS] Stats fetched for user ${userId}`);

    res.json({
        code: user.referralCode,
        credits: user.referralCredits,
        referralCount: user._count.referrals,
    });
}));

export default router;
