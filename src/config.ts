import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_USER: z.string().min(1, 'POSTGRES_USER is required'),
  POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required'),
  POSTGRES_DB: z.string().min(1, 'POSTGRES_DB is required'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 30 characters long'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(3600),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  for (const issue of result.error.issues) {
    console.error(`Config error: ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(result.data);
