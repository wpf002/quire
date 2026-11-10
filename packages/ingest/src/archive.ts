import JSZip from 'jszip';
import { IngestError, MAX_ARCHIVE_ENTRIES, MAX_UNCOMPRESSED_BYTES } from './limits';

interface ZipEntryInternals {
  _data?: { uncompressedSize?: number };
}

/** Rejects zip bombs and path traversal before any entry is inflated. */
export async function assertArchiveWithinLimits(buffer: Buffer): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new IngestError(`Not a valid archive: ${(error as Error).message}`);
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new IngestError('Archive has too many files');
  let declaredTotal = 0;
  for (const entry of entries) {
    if (entry.name.includes('..') || entry.name.startsWith('/')) throw new IngestError('Archive contains unsafe paths');
    // JSZip reads sizes from the central directory without inflating; there is no public accessor.
    declaredTotal += (entry as unknown as ZipEntryInternals)._data?.uncompressedSize ?? 0;
  }
  if (declaredTotal > MAX_UNCOMPRESSED_BYTES) throw new IngestError('Archive expands past the size limit');
  return zip;
}

export async function readEntryText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  return entry ? entry.async('string') : null;
}
