import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  QUIRE_API_PORT: z.coerce.number().int().positive().default(4000),
  QUIRE_WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  QUIRE_SESSION_SECRET: z.string().min(32, 'QUIRE_SESSION_SECRET must be at least 32 characters'),
  QUIRE_STORAGE_DIR: z.string().default('./storage'),
  ANTHROPIC_API_KEY: z.string().optional().transform((value) => (value ? value : undefined)),
  QUIRE_MODEL_CHEAP: z.string().default('claude-haiku-5-5'),
  QUIRE_MODEL_STRUCTURAL: z.string().default('claude-sonnet-5-5'),
  QUIRE_PLATFORM_SPEND_CAP_CENTS_DAILY: z.coerce.number().int().nonnegative().default(2_000),
  QUIRE_DISCOVERY_PROVIDERS: z.string().default('amazon,sample').transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean)),
  QUIRE_RANK_PROVIDER: z.enum(['sample']).default('sample'),
  QUIRE_WORKER: z.enum(['on', 'off']).default('on'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse once at startup. A bad config stops the process with every problem listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return parsed.data;
}
