import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { SpendCapError } from '@quire/core';
import { IngestError, MAX_UPLOAD_BYTES } from '@quire/ingest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { requireUser } from './auth';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { authRoutes } from './routes/auth';
import { bookRoutes } from './routes/books';
import { workflowRoutes } from './routes/workflow';
import { usageSummary } from './services/usage';

const GLOBAL_RATE = { max: 300, timeWindow: '1 minute' };

export async function buildApp(context: AppContext, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: context.env.NODE_ENV === 'test' ? 'warn' : 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-quire-csrf"]'] },
    genReqId: () => randomUUID(),
    bodyLimit: 1_000_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: context.env.QUIRE_WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: context.env.QUIRE_SESSION_SECRET });
  await app.register(rateLimit, GLOBAL_RATE);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ error: 'bad_request', message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    if (error instanceof IngestError) return reply.code(422).send({ error: 'unreadable', message: error.message });
    if (error instanceof SpendCapError) return reply.code(402).send({ error: 'spend_cap', message: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'request_error', message: error.message });
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.get('/health', async () => {
    await context.prisma.$queryRaw`SELECT 1`;
    return { ok: true, model: context.gateway.available, rankProvider: context.ranks.name };
  });

  app.get('/usage', async (request) => {
    const { user } = await requireUser(context, request);
    return usageSummary(context, user.id);
  });

  authRoutes(app, context);
  bookRoutes(app, context);
  workflowRoutes(app, context);
  return app;
}
