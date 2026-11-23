import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Talks to the mock payment service (05 section 8). Never retries by itself:
// the recovery job asks the mock and decides (03 section 5.1).

export type ChargeResult =
  | { outcome: 'succeeded'; chargeId: string }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'unknown' }; // timeout, network error, or still processing

export type RefundResult =
  | { outcome: 'succeeded'; alreadyProcessed: boolean }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'unknown' };

const chargeReplySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('succeeded'), chargeId: z.string() }),
  z.object({ status: z.literal('failed'), reason: z.string() }),
  z.object({ status: z.literal('processing') }),
]);

const refundReplySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('succeeded'),
    alreadyProcessed: z.boolean().optional(),
  }),
  z.object({ status: z.literal('failed'), reason: z.string() }),
]);

// null = no usable answer (timeout, network error, body not JSON).
// The timeout covers reading the body too, so it sits inside the try.
async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown } | null> {
  try {
    const res = await fetch(`${config.MOCK_PAYMENT_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.PAYMENT_TIMEOUT_MS),
    });
    const json: unknown = await res.json();
    return { status: res.status, json };
  } catch (err) {
    logger.warn(
      { path, reason: err instanceof Error ? err.name : 'unknown' },
      'mock payment: no usable answer',
    );
    return null;
  }
}

export async function chargePayment(
  paymentKey: string,
  amountRupees: number,
): Promise<ChargeResult> {
  const answer = await post('/charges', { paymentKey, amountRupees });
  if (!answer || answer.status >= 500) return { outcome: 'unknown' };
  if (answer.status !== 200) {
    // 4xx means our request was wrong. That is a bug in our code, not a payment result.
    throw new Error(`mock payment rejected the charge: HTTP ${answer.status}`);
  }

  const parsed = chargeReplySchema.safeParse(answer.json);
  if (!parsed.success) return { outcome: 'unknown' };

  const reply = parsed.data;
  if (reply.status === 'succeeded') {
    return { outcome: 'succeeded', chargeId: reply.chargeId };
  }
  if (reply.status === 'failed') {
    return { outcome: 'failed', reason: reply.reason };
  }
  return { outcome: 'unknown' }; // 'processing'
}

export async function refundPayment(
  refundKey: string,
  paymentKey: string,
  amountRupees: number,
): Promise<RefundResult> {
  const answer = await post('/refunds', {
    refundKey,
    paymentKey,
    amountRupees,
  });
  if (!answer || answer.status >= 500) return { outcome: 'unknown' };
  if (answer.status !== 200) {
    throw new Error(`mock payment rejected the refund: HTTP ${answer.status}`);
  }

  const parsed = refundReplySchema.safeParse(answer.json);
  if (!parsed.success) return { outcome: 'unknown' };

  const reply = parsed.data;
  if (reply.status === 'succeeded') {
    return {
      outcome: 'succeeded',
      alreadyProcessed: reply.alreadyProcessed ?? false,
    };
  }
  return { outcome: 'failed', reason: reply.reason };
}
