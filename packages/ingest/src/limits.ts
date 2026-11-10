// Every upload is untrusted. These bound memory and CPU before any parsing happens.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2_000;
export const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
export const MAX_CHAPTERS = 400;
export const MAX_BLOCKS = 60_000;

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}
