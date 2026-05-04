import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { logger } from "../services/logger";
import { authenticate, AuthenticatedRequest } from "../middleware/auth";
import { asyncHandler, HttpErrors } from "../middleware/error-handler";

const router = Router();

/**
 * GET /api/referrals/me
 * Returns the authenticated user's referral code, referral count, and earned credits.
 */
router.get("/me", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            referralCode: true,
            referralCredits: true,
            _count: { select: { referrals: true } },
        },
    });

    if (!user) throw HttpErrors.notFound("User");

    logger.debug(`[REFERRALS] Stats fetched for user ${userId}`);

    res.json({
        code: user.referralCode,
        credits: user.referralCredits,
        referralCount: user._count.referrals,
    });
}));

export default router;
