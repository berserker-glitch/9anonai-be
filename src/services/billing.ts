/**
 * @fileoverview Billing service — Paddle integration.
 * Handles subscription activation, cancellation, and webhook event processing.
 * @module services/billing
 */

import { prisma } from './prisma';
import { logger } from './logger';
import crypto from 'crypto';

const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';
const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
const PADDLE_SANDBOX = process.env.PADDLE_SANDBOX === 'true';

const PADDLE_BASE_URL = PADDLE_SANDBOX
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';

// ─────────────────────────────────────────────────────────────────────────────
// Plan price IDs (configured in Paddle dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export const PADDLE_PRICE_IDS: Record<string, { mad: string; eur: string }> = {
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
export function verifyPaddleWebhook(rawBody: Buffer, signatureHeader: string): boolean {
    if (!PADDLE_WEBHOOK_SECRET) {
        logger.warn('[BILLING] PADDLE_WEBHOOK_SECRET not set — skipping verification');
        return true;
    }

    try {
        const parts = Object.fromEntries(
            signatureHeader.split(';').map(p => p.split('=') as [string, string])
        );
        const ts = parts['ts'];
        const h1 = parts['h1'];

        if (!ts || !h1) return false;

        const payload = `${ts}:${rawBody.toString('utf8')}`;
        const expected = crypto
            .createHmac('sha256', PADDLE_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');

        return crypto.timingSafeEqual(Buffer.from(h1), Buffer.from(expected));
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout session creation
// ─────────────────────────────────────────────────────────────────────────────

interface CheckoutOptions {
    userId: string;
    email: string;
    planName: 'basic' | 'pro';
    currency: 'MAD' | 'EUR';
}

/**
 * Creates a Paddle checkout URL for the given plan and currency.
 * Returns the hosted checkout URL to redirect the user to.
 */
export async function createCheckoutUrl(opts: CheckoutOptions): Promise<string> {
    const { userId, email, planName, currency } = opts;
    const priceId = PADDLE_PRICE_IDS[planName]?.[currency.toLowerCase() as 'mad' | 'eur'];

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

    const data = await res.json() as { data: { checkout: { url: string } } };
    return data.data.checkout.url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Activates or renews a subscription for a user.
 * Called when Paddle fires subscription.activated or subscription.renewed.
 */
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
        // Upsert subscription
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
        // Record payment
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

/**
 * Cancels a subscription. Sets status to 'cancelled' but keeps access
 * until currentPeriodEnd (Paddle handles this grace period).
 */
export async function cancelSubscription(opts: {
    userId?: string;
    paddleSubscriptionId: string;
    cancelledAt: Date;
}): Promise<void> {
    const { userId, paddleSubscriptionId, cancelledAt } = opts;

    const where = userId
        ? { userId }
        : { externalId: paddleSubscriptionId };

    await prisma.subscription.updateMany({
        where,
        data: { status: 'cancelled', cancelledAt },
    });

    logger.info(`[BILLING] Subscription cancelled | paddleId=${paddleSubscriptionId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook event router
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Routes an incoming Paddle webhook event to the appropriate handler.
 */
export async function handlePaddleEvent(event: any): Promise<void> {
    const type: string = event.event_type || event.notification_type || '';
    const data = event.data || {};

    logger.info(`[BILLING] Paddle event: ${type}`);

    const userId: string | undefined = data.custom_data?.userId;
    const planName: string | undefined = data.custom_data?.planName;
    const subId: string = data.id || data.subscription_id || '';

    switch (type) {
        case 'subscription.activated':
        case 'subscription.renewed': {
            if (!userId || !planName) {
                logger.warn('[BILLING] Missing userId/planName in custom_data', { data });
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
