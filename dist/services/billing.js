"use strict";
/**
 * @fileoverview Billing service — Paddle SDK integration.
 * Uses the official @paddle/paddle-node-sdk — no manual fetch or HMAC needed.
 * @module services/billing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unmarshalWebhook = unmarshalWebhook;
exports.createCheckoutUrl = createCheckoutUrl;
exports.activateSubscription = activateSubscription;
exports.cancelSubscription = cancelSubscription;
exports.handlePaddleEvent = handlePaddleEvent;
const paddle_node_sdk_1 = require("@paddle/paddle-node-sdk");
const prisma_1 = require("./prisma");
const logger_1 = require("./logger");
// ─────────────────────────────────────────────────────────────────────────────
// Paddle client (singleton)
// ─────────────────────────────────────────────────────────────────────────────
const paddle = new paddle_node_sdk_1.Paddle(process.env.PADDLE_API_KEY || 'no_key_set', {
    environment: process.env.PADDLE_SANDBOX === 'true'
        ? paddle_node_sdk_1.Environment.sandbox
        : paddle_node_sdk_1.Environment.production,
});
// ─────────────────────────────────────────────────────────────────────────────
// Price IDs — one USD price per plan, set in .env after creating in Paddle
// ─────────────────────────────────────────────────────────────────────────────
const PRICE_IDS = {
    basic: process.env.PADDLE_PRICE_BASIC || '',
    pro: process.env.PADDLE_PRICE_PRO || '',
};
// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification — SDK handles HMAC automatically
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Verifies the Paddle-Signature header and returns the parsed event.
 * Throws if the signature is invalid.
 */
async function unmarshalWebhook(rawBody, signatureHeader) {
    const secret = process.env.PADDLE_WEBHOOK_SECRET || '';
    if (!secret) {
        logger_1.logger.warn('[BILLING] PADDLE_WEBHOOK_SECRET not set — skipping verification');
        return JSON.parse(rawBody);
    }
    // SDK verifies HMAC-SHA256 and returns a typed event object
    return paddle.webhooks.unmarshal(rawBody, secret, signatureHeader);
}
/**
 * Creates a Paddle hosted-checkout transaction and returns the checkout URL.
 * All prices are in USD — Paddle handles currency display for the customer.
 */
async function createCheckoutUrl(opts) {
    const { userId, email, planName } = opts;
    const priceId = PRICE_IDS[planName];
    if (!priceId) {
        throw new Error(`No price ID configured for plan=${planName}. Set PADDLE_PRICE_${planName.toUpperCase()} in .env`);
    }
    const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customData: { userId, planName },
        checkout: {
            url: `${process.env.FRONTEND_URL || 'https://9anonai.com'}/pricing?status=success`,
        },
    });
    const url = transaction.checkout?.url;
    if (!url)
        throw new Error('Paddle did not return a checkout URL');
    return url;
}
// ─────────────────────────────────────────────────────────────────────────────
// Subscription lifecycle — called from webhook handler
// ─────────────────────────────────────────────────────────────────────────────
async function activateSubscription(opts) {
    const { userId, planName, paddleSubscriptionId, paddleTransactionId, currentPeriodStart, currentPeriodEnd, amountCents, currency } = opts;
    const plan = await prisma_1.prisma.plan.findUnique({ where: { name: planName } });
    if (!plan) {
        logger_1.logger.error(`[BILLING] Plan not found: ${planName}`);
        return;
    }
    await prisma_1.prisma.$transaction([
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
async function cancelSubscription(opts) {
    const { userId, paddleSubscriptionId, cancelledAt } = opts;
    const where = userId ? { userId } : { externalId: paddleSubscriptionId };
    await prisma_1.prisma.subscription.updateMany({ where, data: { status: 'cancelled', cancelledAt } });
    logger_1.logger.info(`[BILLING] Subscription cancelled | paddleId=${paddleSubscriptionId}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// Webhook event router
// ─────────────────────────────────────────────────────────────────────────────
async function handlePaddleEvent(event) {
    const type = event.eventType || event.event_type || '';
    const data = event.data || {};
    logger_1.logger.info(`[BILLING] Paddle event: ${type}`);
    const customData = data.customData || data.custom_data || {};
    const userId = customData.userId;
    const planName = customData.planName;
    const subId = data.id || data.subscriptionId || data.subscription_id || '';
    switch (type) {
        case 'subscription.activated':
        case 'subscription.renewed': {
            if (!userId || !planName) {
                logger_1.logger.warn('[BILLING] Missing userId/planName in customData', { customData });
                return;
            }
            const billingPeriod = data.currentBillingPeriod || data.current_billing_period || {};
            const totals = data.recurringTransactionDetails?.totals
                || data.recurring_transaction_details?.totals
                || {};
            await activateSubscription({
                userId,
                planName,
                paddleSubscriptionId: subId,
                paddleTransactionId: data.transactionId || data.transaction_id,
                currentPeriodStart: new Date(billingPeriod.startsAt || billingPeriod.starts_at || Date.now()),
                currentPeriodEnd: new Date(billingPeriod.endsAt || billingPeriod.ends_at || Date.now()),
                amountCents: Number(totals.total ?? 0),
                currency: data.currencyCode || data.currency_code || 'USD',
            });
            break;
        }
        case 'subscription.cancelled': {
            await cancelSubscription({
                userId,
                paddleSubscriptionId: subId,
                cancelledAt: new Date(data.cancelledAt || data.cancelled_at || Date.now()),
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
