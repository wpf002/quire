import type { Prisma } from '@quire/db';

/** Serialize a typed value for a Prisma Json column. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Read a Json column this service wrote from a typed value. Columns holding
 * outside input (manuscripts) are parsed with zod instead.
 */
export function fromJson<T>(value: Prisma.JsonValue | null): T {
  return value as T;
}
