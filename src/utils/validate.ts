import { z } from 'zod';
import { AppError } from '../errors.js';

// Same body for signup and login (05 sections 3.1 and 3.2)
export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'),
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
