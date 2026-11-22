import { z } from 'zod';
import { AppError } from '../errors.js';

// Same body for signup and login (05 sections 3.1 and 3.2)
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8).max(72),
});

export type Credentials = z.infer<typeof credentialsSchema>;

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

// :eventId from the URL. Digits only, at most 18 digits, so it always fits in BIGINT.
// Without the length limit, a 25-digit number would make PostgreSQL fail and return a 500.
export const eventIdParamsSchema = z.object({
  eventId: z.string().regex(/^\d{1,18}$/, 'must be a positive whole number'),
});

// Same rule as eventId: digits only, at most 18 digits, so it fits in BIGINT.
const idString = z
  .string()
  .regex(/^\d{1,18}$/, 'must be a positive whole number');

// Body of POST /api/holds (05 section 7.2). The baseline uses the same shape.
export const holdBodySchema = z.object({
  eventId: idString,
  seatId: idString,
});

export type HoldBody = z.infer<typeof holdBodySchema>;
