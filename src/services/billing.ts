/**
 * @fileoverview Billing service — Paddle SDK integration.
 * Uses the official @paddle/paddle-node-sdk — no manual fetch or HMAC needed.
 * @module services/billing
 */

import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { prisma } from './prisma';
import { logger } from './logger';

// ─────────────────────────────────────────────────────────────────────────────
// Paddle client (singleton)
// ─────────────────────────────────────────────────────────────────────────────

const paddle = new Paddle(process.env.PADDLE_API_KEY || 'no_key_set', {
    environment: process.env.PADDLE_SANDBOX === 'true'
        ? Environment.sandbox
        : Environment.production,
});

// ─────────────────────────────────────────────────────────────────────────────
// Price IDs — set these in .env after creating prices in the Paddle dashboard
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_IDS: Record<string, { MAD: string; EUR: string }> = {
    basic: {
        MAD: process.env.PADDLE_PRICE_BASIC_MAD || '',
        EUR: process.env.PADDLE_PRICE_BASIC_EUR || '',
    },
    pro: {
        MAD: process.env.PADDLE_PRICE_PRO_MAD || '',
        EUR: process.env.PADDLE_PRICE_PRO_EUR || '',
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification — SDK handles HMAC automatically
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies the Paddle-Signature header and returns the parsed event.
 * Throws if the signature is invalid.
 */
export async function unmarshalWebhook(rawBody: string, signatureHeader: string) {
    const secret = process.env.PADDLE_WEBHOOK_SECRET || '';
    if (!secret) {
        logger.warn('[BILLING] PADDLE_WEBHOOK_SECRET not set — skipping verification');
        return JSON.parse(rawBody);
    }
    // SDK verifies HMAC-SHA256 and returns a typed event object
    return paddle.webhooks.unmarshal(rawBody, secret, signatureHeader);
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────────────

interface CheckoutOptions {
    userId: string;
    email: string;
    planName: 'basic' | 'pro';
    currency: 'MAD' | 'EUR';
}

/**
 * Creates a Paddle hosted-checkout transaction and returns the checkout URL.
 */
export async function createCheckoutUrl(opts: CheckoutOptions): Promise<string> {
    const { userId, email, planName, currency } = opts;
    const priceId = PRICE_IDS[planName]?.[currency];

    if (!priceId) {
        throw new Error(`No price ID configured for plan=${planName} currency=${currency}. Set PADDLE_PRICE_${planName.toUpperCase()}_${currency} in .env`);
    }

    const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customData: { userId, planName } as any,
        checkout: {
            url: `${process.env.FRONTEND_URL || 'https://9anonai.com'}/pricing?status=success`,
        } as any,
    } as any);

    const url = (transaction as any).checkout?.url;
    if (!url) throw new Error('Paddle did not return a checkout URL');
    return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription lifecycle — called from webhook handler
// ─────────────────────────────────────────────────────────────────────────────

export async function activateSubscription(opts: {
    userId: string;
    planName: string;
    paddleSubscriptionId: string;
    paddleTransactionId?: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    amountCents: number;
    currency: string;
}): Promise<void> {
    const { userId, planName, paddleSubscriptionId, paddleTransactionId,
        currentPeriodStart, currentPeriodEnd, amountCents, currency } = opts;

    const plan = await prisma.plan.findUnique({ where: { name: planName } });
    if (!plan) {
        logger.error(`[BILLING] Plan not found: ${planName}`);
        return;
    }

    await prisma.$transaction([
        prisma.subscription.upsert({
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
        ...(paddleTransactionId ? [prisma.payment.create({
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

    logger.info(`[BILLING] Subscription activated | user=${userId} plan=${planName}`);
}

export async function cancelSubscription(opts: {
    userId?: string;
    paddleSubscriptionId: string;
    cancelledAt: Date;
}): Promise<void> {
    const { userId, paddleSubscriptionId, cancelledAt } = opts;
    const where = userId ? { userId } : { externalId: paddleSubscriptionId };
    await prisma.subscription.updateMany({ where, data: { status: 'cancelled', cancelledAt } });
    logger.info(`[BILLING] Subscription cancelled | paddleId=${paddleSubscriptionId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook event router
// ─────────────────────────────────────────────────────────────────────────────

export async function handlePaddleEvent(event: any): Promise<void> {
    const type: string = event.eventType || event.event_type || '';
    const data = event.data || {};

    logger.info(`[BILLING] Paddle event: ${type}`);

    const customData = data.customData || data.custom_data || {};
    const userId: string | undefined = customData.userId;
    const planName: string | undefined = customData.planName;
    const subId: string = data.id || data.subscriptionId || data.subscription_id || '';

    switch (type) {
        case 'subscription.activated':
        case 'subscription.renewed': {
            if (!userId || !planName) {
                logger.warn('[BILLING] Missing userId/planName in customData', { customData });
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
                currency: data.currencyCode || data.currency_code || 'MAD',
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
            await prisma.subscription.updateMany({
                where: { externalId: subId },
                data: { status: 'past_due' },
            });
            logger.warn(`[BILLING] Subscription past due | paddleId=${subId}`);
            break;
        }

        default:
            logger.debug(`[BILLING] Unhandled Paddle event: ${type}`);
    }
}
