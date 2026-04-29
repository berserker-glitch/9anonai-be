"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const billing_1 = require("../services/billing");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────
const CheckoutSchema = zod_1.z.object({
    plan: zod_1.z.enum(['basic', 'pro']),
    currency: zod_1.z.enum(['MAD', 'EUR']).default('MAD'),
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout
// Creates a Paddle hosted checkout URL for the requested plan.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/checkout', auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { plan, currency } = CheckoutSchema.parse(req.body);
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });
    if (!user)
        throw error_handler_1.HttpErrors.notFound('User');
    const checkoutUrl = await (0, billing_1.createCheckoutUrl)({
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
router.get('/subscription', auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const subscription = await prisma_1.prisma.subscription.findUnique({
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
router.post('/webhook', async (req, res) => {
    const rawBody = req.rawBody;
    const signatureHeader = req.headers['paddle-signature'];
    if (!signatureHeader) {
        logger_1.logger.warn('[BILLING] Webhook received without Paddle-Signature header');
        res.status(400).json({ error: 'Missing Paddle-Signature header' });
        return;
    }
    if (!(0, billing_1.verifyPaddleWebhook)(rawBody, signatureHeader)) {
        logger_1.logger.warn('[BILLING] Webhook signature verification failed');
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
    }
    let event;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    }
    catch {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
    }
    try {
        await (0, billing_1.handlePaddleEvent)(event);
        res.json({ received: true });
    }
    catch (err) {
        logger_1.logger.error('[BILLING] Error processing webhook event', { err, eventType: event?.event_type });
        // Return 200 to prevent Paddle from retrying a permanent error
        res.json({ received: true, warning: 'Processing error logged' });
    }
});
exports.default = router;
