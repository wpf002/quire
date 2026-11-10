import type { FastifyInstance } from 'fastify';
import { newId } from '@quire/core';
import { Prisma } from '@quire/db';
import { z } from 'zod';
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from '../auth';
import type { AppContext } from '../context';
import { HttpError, conflict } from '../errors';
import { parseWith } from '../http';
import { PLANS } from '../plans';

const MIN_PASSWORD = 10;
const AUTH_RATE = { max: 10, timeWindow: '1 minute' };

const SignupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(MIN_PASSWORD).max(256),
});
const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(256) });

const publicUser = (user: { id: string; email: string; name: string; plan: keyof typeof PLANS; spendCapCentsDaily: number }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  plan: user.plan,
  spendCapCentsDaily: user.spendCapCentsDaily,
});

export function authRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/auth/signup', { config: { rateLimit: AUTH_RATE } }, async (request, reply) => {
    const body = parseWith(SignupSchema, request.body);
    try {
      const user = await context.prisma.user.create({
        data: { id: newId('usr'), email: body.email, name: body.name, passwordHash: await hashPassword(body.password), plan: 'starter', spendCapCentsDaily: PLANS.starter.spendCapCentsDaily },
      });
      const { csrfToken } = await createSession(context, user.id, reply);
      return reply.code(201).send({ user: publicUser(user), csrfToken });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('An account with that email exists');
      throw error;
    }
  });

  app.post('/auth/login', { config: { rateLimit: AUTH_RATE } }, async (request, reply) => {
    const body = parseWith(LoginSchema, request.body);
    const user = await context.prisma.user.findUnique({ where: { email: body.email } });
    // Same error for unknown email and wrong password.
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) throw new HttpError(401, 'bad_credentials', 'Email or password is wrong');
    const { csrfToken } = await createSession(context, user.id, reply);
    return { user: publicUser(user), csrfToken };
  });

  app.post('/auth/logout', async (request, reply) => {
    await requireUser(context, request);
    await destroySession(context, request, reply);
    return { ok: true };
  });

  app.get('/auth/me', async (request) => {
    const { user, csrfToken } = await requireUser(context, request);
    return { user: publicUser(user), csrfToken };
  });

  const AccountPatchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), spendCapCentsDaily: z.number().int().min(0).optional() });
  app.patch('/account', async (request) => {
    const { user } = await requireUser(context, request);
    const body = parseWith(AccountPatchSchema, request.body);
    const ceiling = PLANS[user.plan].spendCapCentsDaily;
    if (body.spendCapCentsDaily !== undefined && body.spendCapCentsDaily > ceiling) throw new HttpError(400, 'cap_too_high', `Your plan allows up to ${ceiling}¢ a day`);
    const updated = await context.prisma.user.update({ where: { id: user.id }, data: body });
    return { user: publicUser(updated) };
  });

  const PlanSchema = z.object({ plan: z.enum(['starter', 'author', 'press']) });
  app.post('/account/plan', async (request) => {
    const { user } = await requireUser(context, request);
    const { plan } = parseWith(PlanSchema, request.body);
    // Checkout isn't connected. Outside production the plan can be switched for testing.
    if (context.env.NODE_ENV === 'production') throw new HttpError(402, 'checkout_unavailable', 'Plan changes open when checkout is connected');
    const updated = await context.prisma.user.update({ where: { id: user.id }, data: { plan, spendCapCentsDaily: Math.min(user.spendCapCentsDaily, PLANS[plan].spendCapCentsDaily) || PLANS[plan].spendCapCentsDaily } });
    return { user: publicUser(updated) };
  });
}
