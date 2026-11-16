// Pure rules for the device copy of the app's last answers (persist.ts): what may be kept, for how long,
// and when a kept copy may be shown. Checked by scripts/verify-query-persist.cjs.

/** A kept answer older than this is dropped: a page not opened for a week starts empty, as before. */
export const KEEP_MS = 7 * 24 * 60 * 60_000

/**
 * Answers that never go to the device, by the first part of their query key:
 * - where the phone is (`geolocation`, the stops near it) — asked once per session, never stored;
 * - Apple Calendar's status and its queue (`icloud`: one of its reads sends an item — it must run, never replay);
 * - the Developer page's logs (large, and they name every save);
 * - live or one-off outside answers (departures, trips, a stop search, one news article).
 */
export const NEVER_KEPT: ReadonlySet<string> = new Set([
  'geolocation', 'nearby-stops', 'icloud', 'audit-logs', 'error-logs',
  'departures', 'trip', 'trip-via', 'stopSearch', 'stop-directions', 'news-article',
])

export interface KeptQueryFacts {
  queryKey: readonly unknown[]
  status: string
  dataUpdatedAt: number
  /** `gcTime: 0` marks an answer its own hook wants gone at once (an undo plan, a move preview). */
  gcTime?: number
}

/** Whether one answer goes into the device copy: a successful read, not on the never-kept list, read within the week. */
export function keepsQuery(q: KeptQueryFacts, now: number): boolean {
  if (q.status !== 'success') return false
  if (q.gcTime === 0) return false
  const root = q.queryKey[0]
  if (typeof root !== 'string' || NEVER_KEPT.has(root)) return false
  return q.dataUpdatedAt > 0 && now - q.dataUpdatedAt <= KEEP_MS
}

export interface KeptCopyFacts {
  /** The app build that wrote the copy: another build may read other columns, so its copy is dropped. */
  build: string
  /** The account the answers belong to. */
  userId: string
  savedAt: number
}

/**
 * Whether a kept copy may be shown: written by this build, for the account signed in on this device now,
 * within the week. Anything else is deleted, never shown.
 */
export function mayShowCopy(copy: Partial<KeptCopyFacts> | null | undefined, now: { build: string; userId: string | null; at: number }): boolean {
  if (!copy || !now.userId) return false
  if (typeof copy.userId !== 'string' || copy.userId !== now.userId) return false
  if (copy.build !== now.build) return false
  if (typeof copy.savedAt !== 'number' || copy.savedAt > now.at || now.at - copy.savedAt > KEEP_MS) return false
  return true
}
