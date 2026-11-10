import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { badRequest } from './errors';

export function parseWith<Schema extends z.ZodTypeAny>(schema: Schema, value: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request');
  }
  return parsed.data;
}

export function idParam(request: FastifyRequest): string {
  const params = request.params as { id?: unknown };
  if (typeof params.id !== 'string' || params.id.length > 64) throw badRequest('Invalid id');
  return params.id;
}
