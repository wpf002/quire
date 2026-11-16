import type { Pass } from './types';

/** Notes from a structural pass that ran before the latest upload quote text the manuscript no longer has. */
export function currentStructuralPass(passes: Pass[], latestUploadAt: string | undefined): Pass | undefined {
  const uploadedAt = latestUploadAt ? Date.parse(latestUploadAt) : Number.NEGATIVE_INFINITY;
  return passes.find(
    (pass) => pass.kind === 'structural' && pass.status === 'done' && pass.notes !== null && pass.notes.length > 0 && Date.parse(pass.createdAt) > uploadedAt,
  );
}
