import { z } from 'zod';
import { AppError } from '../errors.js';

export const CHARGE_MODES = [
  'normal',
  'always_fail',
  'timeout_after_charge',
  'crash_after_charge',
  'crash_before_charge',
] as const;

export type ChargeMode = (typeof CHARGE_MODES)[number];

// Any subset of the settings. Unknown keys are rejected, so a typo like
// "failurRate" gives an error instead of being ignored silently.
export const settingsPatchSchema = z
  .strictObject({
    failureRate: z.number().min(0).max(1),
    minDelayMs: z.number().int().min(0),
    maxDelayMs: z.number().int().min(0),
    chargeMode: z.enum(CHARGE_MODES),
    refundFailureRate: z.number().min(0).max(1),
    refundFailUntilAttempt: z.number().int().min(0),
  })
  .partial();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') || 'body';
    throw new AppError(
      'validation_error',
      `${field}: ${first?.message ?? 'invalid'}`,
    );
  }
  return result.data;
}
