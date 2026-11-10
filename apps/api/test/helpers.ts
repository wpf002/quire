import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Completion, CompletionRequest, ModelGateway } from '@quire/core';
import { createPrisma } from '@quire/db';
import { providersFromConfig } from '@quire/discovery';
import { SampleRankProvider } from '@quire/tracking';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../src/context';
import { loadEnv } from '../src/env';
import { PrismaSpendLedger } from '../src/ledger';
import { FileStorage } from '../src/storage';

export const TEST_DATABASE_URL = process.env.QUIRE_TEST_DATABASE_URL ?? 'postgresql://willfoti@localhost:5432/quire_test';

/** Records every call so tests can prove the spend cap stopped a request before it left. */
export class RecordingGateway implements ModelGateway {
  readonly available = true;
  calls: CompletionRequest[] = [];
  async complete(request: CompletionRequest): Promise<Completion> {
    this.calls.push(request);
    return { text: '[]', model: request.model, tokens: { input: 10, output: 2 } };
  }
}

export async function testContext(overrides: Partial<AppContext> = {}): Promise<AppContext> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    QUIRE_SESSION_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    QUIRE_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'quire-test-')),
    QUIRE_DISCOVERY_PROVIDERS: 'sample',
    QUIRE_WORKER: 'off',
  });
  const prisma = createPrisma(env.DATABASE_URL);
  const clock = () => new Date();
  return {
    env,
    prisma,
    clock,
    storage: new FileStorage(env.QUIRE_STORAGE_DIR),
    ledger: new PrismaSpendLedger(prisma, env.QUIRE_PLATFORM_SPEND_CAP_CENTS_DAILY, clock),
    gateway: new RecordingGateway(),
    discovery: providersFromConfig(env.QUIRE_DISCOVERY_PROVIDERS),
    ranks: Object.assign(new SampleRankProvider(), { supportsBackfill: true }),
    ...overrides,
  };
}

export async function resetDatabase(context: AppContext): Promise<void> {
  const tables = await context.prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  for (const { tablename } of tables) {
    // Table names come from pg_tables, not user input.
    await context.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
  }
}

/** A minimal cookie-carrying client over app.inject. */
export class TestClient {
  private cookie = '';
  csrf = '';
  constructor(private readonly app: FastifyInstance) {}

  async request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, options: { csrf?: boolean } = {}) {
    const response = await this.app.inject({
      method,
      url,
      headers: { cookie: this.cookie, ...(options.csrf === false || !this.csrf ? {} : { 'x-quire-csrf': this.csrf }) },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    const setCookie = response.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) this.cookie = first.split(';')[0]!;
    return { status: response.statusCode, json: () => response.json() as Record<string, unknown>, raw: response };
  }

  async upload(url: string, filename: string, content: string) {
    const boundary = '----quiretest';
    const payload = [`--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, 'Content-Type: text/markdown', '', content, `--${boundary}--`, ''].join('\r\n');
    const response = await this.app.inject({
      method: 'POST',
      url,
      headers: { cookie: this.cookie, 'x-quire-csrf': this.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    return { status: response.statusCode, json: () => response.json() as Record<string, unknown> };
  }

  async signup(email: string) {
    const response = await this.request('POST', '/auth/signup', { name: 'Test Author', email, password: 'correct-horse-battery' });
    this.csrf = String(response.json().csrfToken);
    return response;
  }
}

export const SAMPLE_MANUSCRIPT = `# The Salt Road

## Chapter One

The caravan left before dawn -- nobody spoke. Mara counted the the camels twice. she had done this before...

The desert was quiet , and cold.

## Chapter Two

By noon the dunes gave way to flats of white salt. Her father had walked this road forty years ago.
`;
