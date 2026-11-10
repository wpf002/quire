import type { FastifyInstance } from 'fastify';
import { KDP_EXTENT_OPTIONS } from '@quire/compliance';
import { TRIM_SIZES, blockText, countWords, newId } from '@quire/core';
import { IngestError, MAX_UPLOAD_BYTES, detectFormat, ingestManuscript } from '@quire/ingest';
import { z } from 'zod';
import { requireUser } from '../auth';
import type { AppContext } from '../context';
import { HttpError, badRequest } from '../errors';
import { idParam, parseWith } from '../http';
import { toJson } from '../json';
import { PLANS } from '../plans';
import { advanceStage, loadOwnedBook } from '../services/books';
import { latestManuscript, requireManuscript, saveManuscript } from '../services/manuscripts';

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).nullable().optional(),
  author: z.string().trim().min(1).max(200),
  genre: z.string().trim().max(80).default(''),
});

const ExtentSchema = z.enum(KDP_EXTENT_OPTIONS).nullable();
const DeclarationPart = z.object({ used: z.boolean(), extent: ExtentSchema, tool: z.string().max(120).nullable() });
const PatchSchema = CreateSchema.partial().extend({
  trimSize: z.enum(Object.keys(TRIM_SIZES) as [keyof typeof TRIM_SIZES]).optional(),
  isbn: z.string().trim().max(20).nullable().optional(),
  asin: z.string().trim().max(20).nullable().optional(),
  aboutAuthor: z.string().max(2_000).nullable().optional(),
  dedication: z.string().max(500).nullable().optional(),
  seriesStarter: z.boolean().optional(),
  declaration: z.object({ textGeneratedOutsideQuire: DeclarationPart, imagesGenerated: DeclarationPart, translationGenerated: DeclarationPart }).optional(),
});

export function bookRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/books', async (request) => {
    const { user } = await requireUser(context, request);
    const books = await context.prisma.book.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        manuscripts: { orderBy: { version: 'desc' }, take: 1, select: { wordCount: true, version: true } },
        _count: { select: { edits: { where: { status: 'pending' } }, recommendations: { where: { status: 'open' } } } },
      },
    });
    return {
      books: books.map(({ manuscripts, _count, blurb: _blurb, declaration: _declaration, ...book }) => ({
        ...book,
        wordCount: manuscripts[0]?.wordCount ?? 0,
        manuscriptVersion: manuscripts[0]?.version ?? 0,
        pendingEdits: _count.edits,
        openRecommendations: _count.recommendations,
      })),
    };
  });

  app.post('/books', async (request, reply) => {
    const { user } = await requireUser(context, request);
    const body = parseWith(CreateSchema, request.body);
    const count = await context.prisma.book.count({ where: { userId: user.id } });
    if (count >= PLANS[user.plan].activeBooks) throw new HttpError(402, 'plan_limit', `${PLANS[user.plan].name} includes ${PLANS[user.plan].activeBooks} ${PLANS[user.plan].activeBooks === 1 ? 'book' : 'books'}`);
    const book = await context.prisma.book.create({ data: { id: newId('book'), userId: user.id, ...body, subtitle: body.subtitle ?? null } });
    return reply.code(201).send({ book });
  });

  app.get('/books/:id', async (request) => {
    const { user } = await requireUser(context, request);
    const book = await loadOwnedBook(context.prisma, user.id, idParam(request));
    const latest = await latestManuscript(context.prisma, book.id);
    const [pendingEdits, openRecommendations, uploads] = await Promise.all([
      context.prisma.edit.count({ where: { bookId: book.id, status: 'pending' } }),
      context.prisma.recommendation.count({ where: { bookId: book.id, status: 'open' } }),
      context.prisma.upload.findMany({ where: { bookId: book.id }, orderBy: { createdAt: 'desc' }, select: { id: true, filename: true, format: true, bytes: true, createdAt: true } }),
    ]);
    return {
      book,
      manuscript: latest
        ? {
            version: latest.version,
            chapters: latest.manuscript.chapters.map((chapter) => ({
              id: chapter.id,
              title: chapter.title,
              words: chapter.blocks.reduce((sum, block) => sum + countWords(blockText(block)), 0),
            })),
          }
        : null,
      pendingEdits,
      openRecommendations,
      uploads,
    };
  });

  app.patch('/books/:id', async (request) => {
    const { user } = await requireUser(context, request);
    const book = await loadOwnedBook(context.prisma, user.id, idParam(request));
    const { declaration, ...body } = parseWith(PatchSchema, request.body);
    const updated = await context.prisma.book.update({ where: { id: book.id }, data: { ...body, ...(declaration ? { declaration: toJson(declaration) } : {}) } });
    return { book: updated };
  });

  app.delete('/books/:id', async (request) => {
    const { user } = await requireUser(context, request);
    const book = await loadOwnedBook(context.prisma, user.id, idParam(request));
    await context.prisma.book.delete({ where: { id: book.id } });
    return { ok: true };
  });

  app.get('/books/:id/manuscript', async (request) => {
    const { user } = await requireUser(context, request);
    const book = await loadOwnedBook(context.prisma, user.id, idParam(request));
    const query = parseWith(z.object({ version: z.coerce.number().int().positive().optional() }), request.query);
    const { version, manuscript } = await requireManuscript(context.prisma, book.id, query.version);
    return { version, manuscript };
  });

  app.post('/books/:id/upload', async (request, reply) => {
    const { user } = await requireUser(context, request);
    const book = await loadOwnedBook(context.prisma, user.id, idParam(request));
    const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    if (!file) throw badRequest('Attach a .docx, .epub or .md file');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'too_large', 'File is over 25 MB');
    // The filename is only used for format detection and display; storage keys use ids.
    const filename = file.filename.slice(0, 200);
    let format;
    let manuscript;
    try {
      format = detectFormat(filename, buffer);
      manuscript = await ingestManuscript(filename, buffer);
    } catch (error) {
      if (error instanceof IngestError) throw new HttpError(422, 'unreadable', error.message);
      throw error;
    }
    const uploadId = newId('upl');
    const storagePath = await context.storage.put(`uploads/${book.id}/${uploadId}.${format}`, buffer);
    await context.prisma.upload.create({ data: { id: uploadId, bookId: book.id, filename, format, bytes: buffer.length, storagePath } });
    const version = await saveManuscript(context.prisma, book.id, manuscript, `upload:${format}`);
    await advanceStage(context.prisma, book.id, 'edit');
    return reply.code(201).send({ version, chapters: manuscript.chapters.length });
  });
}
