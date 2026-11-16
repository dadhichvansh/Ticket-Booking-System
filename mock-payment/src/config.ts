import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DB_PATH: z.string().min(1).default('./data/mock.db'),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  for (const issue of result.error.issues) {
    console.error(`Config error: ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(result.data);
