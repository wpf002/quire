import { api } from './api';
import type { Job } from './types';

const POLL_MS = 800;
const MAX_WAIT_MS = 10 * 60_000;
/** Set by the API when Amazon served a robot check and the job was requeued. */
const AMAZON_BLOCKED_CODE = 'amazon_blocked';

export function retryLaterMessage(job: Job): string | null {
  if (job.errorCode !== AMAZON_BLOCKED_CODE) return null;
  if (job.status === 'failed') return 'Amazon Blocked. Retry Later.';
  if (job.status !== 'queued') return null;
  const at = new Date(job.runAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Amazon Blocked. Retry Later. Requeued for ${at}.`;
}

/** Poll a queued job until it finishes. Rejects if it fails or runs past MAX_WAIT_MS. */
export async function waitForJob(jobId: string, onUpdate?: (job: Job) => void): Promise<Job> {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const { job } = await api.get<{ job: Job }>(`/jobs/${jobId}`);
    onUpdate?.(job);
    if (job.status === 'done') return job;
    const retryLater = retryLaterMessage(job);
    if (retryLater) throw new Error(retryLater);
    if (job.status === 'failed') throw new Error(job.error ?? 'Job failed');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('Job is still running. Check back shortly.');
}
