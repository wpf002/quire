import { DeferJobError } from '../queue';

export const AMAZON_BLOCKED_CODE = 'amazon_blocked';
/** Amazon's robot checks clear on their own; asking again sooner only extends them. */
export const AMAZON_BLOCK_RETRY_MS = 30 * 60_000;

export function deferForAmazonBlock(reason: string): DeferJobError {
  return new DeferJobError(AMAZON_BLOCKED_CODE, AMAZON_BLOCK_RETRY_MS, `Amazon blocked the lookup: ${reason}`);
}
