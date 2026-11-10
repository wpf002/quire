import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { newId } from '@quire/core';
import type { User } from '@quire/db';
import type { AppContext } from './context';
import { HttpError } from './errors';

export const SESSION_COOKIE = 'quire_session';
export const CSRF_HEADER = 'x-quire-csrf';
const SESSION_DAYS = 30;
const TOKEN_BYTES = 32;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export async function createSession(context: AppContext, userId: string, reply: FastifyReply): Promise<{ csrfToken: string }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const csrfToken = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(context.clock().getTime() + SESSION_DAYS * 86_400_000);
  await context.prisma.session.create({ data: { id: newId('ses'), userId, tokenHash: hashToken(token), csrfToken, expiresAt } });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: context.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
    signed: true,
  });
  return { csrfToken };
}

export async function destroySession(context: AppContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = readToken(request);
  if (token) await context.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export interface Authed {
  user: User;
  csrfToken: string;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Resolve the session and, on mutating requests, require the CSRF header to match. */
export async function requireUser(context: AppContext, request: FastifyRequest): Promise<Authed> {
  const token = readToken(request);
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  const session = await context.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt.getTime() < context.clock().getTime()) throw new HttpError(401, 'unauthenticated', 'Session expired');
  if (MUTATING.has(request.method)) {
    const header = request.headers[CSRF_HEADER];
    const supplied = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(session.csrfToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(403, 'csrf', 'Missing or invalid CSRF token');
  }
  return { user: session.user, csrfToken: session.csrfToken };
}
