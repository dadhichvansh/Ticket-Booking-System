import { z } from 'zod';

export const CHARGE_MODES = [
  'normal',
  'always_fail',
  'timeout_after_charge',
  'crash_after_charge',
  'crash_before_charge',
] as const;

const shape = {
  failureRate: z.number().min(0).max(1),
  minDelayMs: z.number().int().min(0),
  maxDelayMs: z.number().int().min(0),
  chargeMode: z.enum(CHARGE_MODES),
  refundFailureRate: z.number().min(0).max(1),
  refundFailUntilAttempt: z.number().int().min(0),
};

// Any subset of the settings. Unknown keys are rejected, so a typo like
// "failurRate" gives an error instead of being ignored silently.
export const settingsPatchSchema = z.strictObject(shape).partial();

export type Settings = {
  failureRate: number;
  minDelayMs: number;
  maxDelayMs: number;
  chargeMode: (typeof CHARGE_MODES)[number];
  refundFailureRate: number;
  refundFailUntilAttempt: number;
};

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

// Defaults from 02 (A-2) and 05 section 8.3
const DEFAULTS: Settings = {
  failureRate: 0.1,
  minDelayMs: 50,
  maxDelayMs: 2000,
  chargeMode: 'normal',
  refundFailureRate: 0,
  refundFailUntilAttempt: 0,
};

let current: Settings = { ...DEFAULTS };

export function getSettings(): Settings {
  return { ...current };
}

type UpdateResult =
  | { ok: true; settings: Settings }
  | { ok: false; message: string };

export function updateSettings(patch: SettingsPatch): UpdateResult {
  const next = { ...current, ...patch };

  // This rule needs the merged values, so it cannot live in the schema
  if (next.minDelayMs > next.maxDelayMs) {
    return {
      ok: false,
      message: 'minDelayMs must not be larger than maxDelayMs',
    };
  }

  current = next;
  return { ok: true, settings: getSettings() };
}

export function resetSettings(): void {
  current = { ...DEFAULTS };
}
