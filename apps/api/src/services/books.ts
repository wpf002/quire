import { BOOK_STAGES, type BookStage } from '@quire/core';
import type { Book, PrismaClient } from '@quire/db';
import { notFound } from '../errors';

export async function loadOwnedBook(prisma: PrismaClient, userId: string, bookId: string): Promise<Book> {
  const book = await prisma.book.findFirst({ where: { id: bookId, userId } });
  if (!book) throw notFound('Book');
  return book;
}

/** Stages only move forward; redoing an earlier step doesn't send the book back. */
export function laterStage(current: BookStage, reached: BookStage): BookStage {
  return BOOK_STAGES.indexOf(reached) > BOOK_STAGES.indexOf(current) ? reached : current;
}

export async function advanceStage(prisma: PrismaClient, bookId: string, reached: BookStage): Promise<void> {
  const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId }, select: { stage: true } });
  const next = laterStage(book.stage, reached);
  if (next !== book.stage) await prisma.book.update({ where: { id: bookId }, data: { stage: next } });
}
