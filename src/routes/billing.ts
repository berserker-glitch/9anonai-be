/**
 * @fileoverview Billing API routes — Paddle integration.
 * Provides endpoints for checkout, subscription status, and webhook processing.
 *
 * IMPORTANT: The webhook endpoint must receive the RAW body (not parsed JSON)
 * for HMAC signature verification. It is registered in app.ts BEFORE the
 * global express.json() middleware, with its own raw body parser.
 *
 * @module routes/billing
 */

import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, HttpErrors } from '../middleware/error-handler';
import { prisma } from '../services/prisma';
import { logger } from '../services/logger';
import {
    createCheckoutUrl,
    handlePaddleEvent,
    verifyPaddleWebhook,
} from '../services/billing';
import { z } from 'zod';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const CheckoutSchema = z.object({
    plan: z.enum(['basic', 'pro']),
    currency: z.enum(['MAD', 'EUR']).default('MAD'),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout
// Creates a Paddle hosted checkout URL for the requested plan.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/checkout', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const { plan, currency } = CheckoutSchema.parse(req.body);

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });

    if (!user) throw HttpErrors.notFound('User');

    const checkoutUrl = await createCheckoutUrl({
        userId,
        email: user.email,
        planName: plan,
        currency,
    });

    res.json({ checkout_url: checkoutUrl });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/billing/subscription
// Returns the current user's subscription status and plan details.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/subscription', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;

    const subscription = await prisma.subscription.findUnique({
        where: { userId },
        select: {
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            cancelledAt: true,
            currency: true,
            plan: {
                select: {
                    name: true,
                    displayName: true,
                    priceMAD: true,
                    priceEUR: true,
                    messagesPerConversation: true,
                    contractsPerMonth: true,
                    maxSavedChats: true,
                },
            },
        },
    });

    if (!subscription || subscription.status !== 'active') {
        res.json({
            plan: 'free',
            subscription: null,
        });
        return;
    }

    res.json({
        plan: subscription.plan.name,
        subscription: {
            status: subscription.status,
            planName: subscription.plan.name,
            planDisplayName: subscription.plan.displayName,
            priceMAD: subscription.plan.priceMAD,
            priceEUR: subscription.plan.priceEUR,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelledAt: subscription.cancelledAt,
            currency: subscription.currency,
            messagesPerConversation: subscription.plan.messagesPerConversation,
            contractsPerMonth: subscription.plan.contractsPerMonth,
        },
    });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/webhook  (raw body — registered separately in app.ts)
// Receives and processes Paddle webhook events.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/webhook', async (req: Request, res: Response) => {
    const rawBody: Buffer = (req as any).rawBody;
    const signatureHeader = req.headers['paddle-signature'] as string | undefined;

    if (!signatureHeader) {
        logger.warn('[BILLING] Webhook received without Paddle-Signature header');
        res.status(400).json({ error: 'Missing Paddle-Signature header' });
        return;
    }

    if (!verifyPaddleWebhook(rawBody, signatureHeader)) {
        logger.warn('[BILLING] Webhook signature verification failed');
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
    }

    let event: any;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    } catch {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
    }

    try {
        await handlePaddleEvent(event);
        res.json({ received: true });
    } catch (err) {
        logger.error('[BILLING] Error processing webhook event', { err, eventType: event?.event_type });
        // Return 200 to prevent Paddle from retrying a permanent error
        res.json({ received: true, warning: 'Processing error logged' });
    }
});

export default router;
