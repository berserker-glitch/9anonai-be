"use strict";
/**
 * @fileoverview Billing service — Paddle integration.
 * Handles subscription activation, cancellation, and webhook event processing.
 * @module services/billing
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PADDLE_PRICE_IDS = void 0;
exports.verifyPaddleWebhook = verifyPaddleWebhook;
exports.createCheckoutUrl = createCheckoutUrl;
exports.activateSubscription = activateSubscription;
exports.cancelSubscription = cancelSubscription;
exports.handlePaddleEvent = handlePaddleEvent;
const prisma_1 = require("./prisma");
const logger_1 = require("./logger");
const crypto_1 = __importDefault(require("crypto"));
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';
const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
const PADDLE_SANDBOX = process.env.PADDLE_SANDBOX === 'true';
const PADDLE_BASE_URL = PADDLE_SANDBOX
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
// ─────────────────────────────────────────────────────────────────────────────
// Plan price IDs (configured in Paddle dashboard)
// ─────────────────────────────────────────────────────────────────────────────
exports.PADDLE_PRICE_IDS = {
    basic: {
        mad: process.env.PADDLE_PRICE_BASIC_MAD || '',
        eur: process.env.PADDLE_PRICE_BASIC_EUR || '',
    },
    pro: {
        mad: process.env.PADDLE_PRICE_PRO_MAD || '',
        eur: process.env.PADDLE_PRICE_PRO_EUR || '',
    },
};
// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature verification
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Verifies a Paddle webhook signature using HMAC-SHA256.
 * Paddle sends: Paddle-Signature: ts=<timestamp>;h1=<hmac>
 */
function verifyPaddleWebhook(rawBody, signatureHeader) {
    if (!PADDLE_WEBHOOK_SECRET) {
        logger_1.logger.warn('[BILLING] PADDLE_WEBHOOK_SECRET not set — skipping verification');
        return true;
    }
    try {
        const parts = Object.fromEntries(signatureHeader.split(';').map(p => p.split('=')));
        const ts = parts['ts'];
        const h1 = parts['h1'];
        if (!ts || !h1)
            return false;
        const payload = `${ts}:${rawBody.toString('utf8')}`;
        const expected = crypto_1.default
            .createHmac('sha256', PADDLE_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
        return crypto_1.default.timingSafeEqual(Buffer.from(h1), Buffer.from(expected));
    }
    catch {
        return false;
    }
}
/**
 * Creates a Paddle checkout URL for the given plan and currency.
 * Returns the hosted checkout URL to redirect the user to.
 */
async function createCheckoutUrl(opts) {
    const { userId, email, planName, currency } = opts;
    const priceId = exports.PADDLE_PRICE_IDS[planName]?.[currency.toLowerCase()];
    if (!priceId) {
        throw new Error(`No Paddle price ID configured for plan=${planName} currency=${currency}`);
    }
    const res = await fetch(`${PADDLE_BASE_URL}/transactions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PADDLE_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            items: [{ price_id: priceId, quantity: 1 }],
            customer: { email },
            custom_data: { userId, planName },
            checkout: { url: `${process.env.FRONTEND_URL}/pricing?status=success` },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Paddle checkout error: ${err}`);
    }
    const data = await res.json();
    return data.data.checkout.url;
}
// ─────────────────────────────────────────────────────────────────────────────
// Subscription management
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Activates or renews a subscription for a user.
 * Called when Paddle fires subscription.activated or subscription.renewed.
 */
async function activateSubscription(opts) {
    const { userId, planName, paddleSubscriptionId, paddleTransactionId, currentPeriodStart, currentPeriodEnd, amountCents, currency } = opts;
    const plan = await prisma_1.prisma.plan.findUnique({ where: { name: planName } });
    if (!plan) {
        logger_1.logger.error(`[BILLING] Plan not found: ${planName}`);
        return;
    }
    await prisma_1.prisma.$transaction([
        // Upsert subscription
        prisma_1.prisma.subscription.upsert({
            where: { userId },
            create: {
                userId,
                planId: plan.id,
                status: 'active',
                currentPeriodStart,
                currentPeriodEnd,
                externalId: paddleSubscriptionId,
                paymentProvider: 'paddle',
                currency,
            },
            update: {
                planId: plan.id,
                status: 'active',
                currentPeriodStart,
                currentPeriodEnd,
                externalId: paddleSubscriptionId,
                cancelledAt: null,
                currency,
            },
        }),
        // Record payment
        ...(paddleTransactionId ? [prisma_1.prisma.payment.create({
                data: {
                    userId,
                    amount: amountCents,
                    currency,
                    status: 'completed',
                    paymentProvider: 'paddle',
                    externalId: paddleTransactionId,
                    type: 'subscription',
                    metadata: JSON.stringify({ planName, paddleSubscriptionId }),
                },
            })] : []),
    ]);
    logger_1.logger.info(`[BILLING] Subscription activated | user=${userId} plan=${planName}`);
}
/**
 * Cancels a subscription. Sets status to 'cancelled' but keeps access
 * until currentPeriodEnd (Paddle handles this grace period).
 */
async function cancelSubscription(opts) {
    const { userId, paddleSubscriptionId, cancelledAt } = opts;
    const where = userId
        ? { userId }
        : { externalId: paddleSubscriptionId };
    await prisma_1.prisma.subscription.updateMany({
        where,
        data: { status: 'cancelled', cancelledAt },
    });
    logger_1.logger.info(`[BILLING] Subscription cancelled | paddleId=${paddleSubscriptionId}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// Webhook event router
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Routes an incoming Paddle webhook event to the appropriate handler.
 */
async function handlePaddleEvent(event) {
    const type = event.event_type || event.notification_type || '';
    const data = event.data || {};
    logger_1.logger.info(`[BILLING] Paddle event: ${type}`);
    const userId = data.custom_data?.userId;
    const planName = data.custom_data?.planName;
    const subId = data.id || data.subscription_id || '';
    switch (type) {
        case 'subscription.activated':
        case 'subscription.renewed': {
            if (!userId || !planName) {
                logger_1.logger.warn('[BILLING] Missing userId/planName in custom_data', { data });
                return;
            }
            await activateSubscription({
                userId,
                planName,
                paddleSubscriptionId: subId,
                paddleTransactionId: data.transaction_id,
                currentPeriodStart: new Date(data.current_billing_period?.starts_at || Date.now()),
                currentPeriodEnd: new Date(data.current_billing_period?.ends_at || Date.now()),
                amountCents: data.recurring_transaction_details?.totals?.total ?? 0,
                currency: data.currency_code || 'MAD',
            });
            break;
        }
        case 'subscription.cancelled': {
            await cancelSubscription({
                userId,
                paddleSubscriptionId: subId,
                cancelledAt: new Date(data.cancelled_at || Date.now()),
            });
            break;
        }
        case 'subscription.past_due': {
            await prisma_1.prisma.subscription.updateMany({
                where: { externalId: subId },
                data: { status: 'past_due' },
            });
            logger_1.logger.warn(`[BILLING] Subscription past due | paddleId=${subId}`);
            break;
        }
        default:
            logger_1.logger.debug(`[BILLING] Unhandled Paddle event: ${type}`);
    }
}
