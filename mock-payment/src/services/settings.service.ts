import { AppError } from '../errors.js';
import type { ChargeMode, SettingsPatch } from '../utils/validate.js';

export type Settings = {
  failureRate: number;
  minDelayMs: number;
  maxDelayMs: number;
  chargeMode: ChargeMode;
  refundFailureRate: number;
  refundFailUntilAttempt: number;
};

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

export function updateSettings(patch: SettingsPatch): Settings {
  const next = { ...current, ...patch };

  // This rule needs the merged values, so it cannot live in the schema
  if (next.minDelayMs > next.maxDelayMs) {
    throw new AppError(
      'validation_error',
      'minDelayMs must not be larger than maxDelayMs',
    );
  }

  current = next;
  return getSettings();
}

export function resetSettings(): void {
  current = { ...DEFAULTS };
}
