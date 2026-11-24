// When the app's own quick sync runs (traktAutoSync.ts). Pure (scripts/verify-media-queue.cjs).

/** A change here is sent a few seconds later instead of waiting for the 30-minute cron. */
export const SYNC_DELAY_MS = 4000
/** A sync that found another one running tries once more after this long. */
export const BUSY_RETRY_MS = 15_000

/**
 * After a quick sync's answer: run once more after this many ms, or not (null).
 * A run that found another sync under way ("busy") retries once, so a watch
 * marked during a running sync still reaches Trakt — and still takes a
 * Completed film out of the Queue — without waiting for the cron.
 */
export function syncRetryAfter(result: { busy?: boolean } | null | undefined, attempt: number): number | null {
  return result?.busy === true && attempt === 0 ? BUSY_RETRY_MS : null
}
