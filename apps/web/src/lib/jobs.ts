import { api } from './api';
import type { Job } from './types';

const POLL_MS = 800;
const MAX_WAIT_MS = 10 * 60_000;

/** Poll a queued job until it finishes. Rejects if it fails or runs past MAX_WAIT_MS. */
export async function waitForJob(jobId: string, onUpdate?: (job: Job) => void): Promise<Job> {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const { job } = await api.get<{ job: Job }>(`/jobs/${jobId}`);
    onUpdate?.(job);
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error ?? 'Job failed');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('Job is still running. Check back shortly.');
}
