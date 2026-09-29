// Pure pieces of the motion test set (THEME.md §7): number easing, what a
// count-up shows mid-way, when it runs at all, and which list rows are new.
// Import-free so scripts/verify-truncate-and-motion.cjs can check them.

/** Fast start, gentle landing — the curve every count-up and ring sweep uses. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - c, 3)
}

/** The value `t` (already eased, 0..1) of the way from `from` to `to`. */
export function tweenValue(from: number, to: number, t: number): number {
  if (t >= 1) return to
  if (t <= 0) return from
  return from + (to - from) * t
}

/** Rounds to `decimals` places without float noise (0.1 + 0.2 → 0.3). */
export function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, Math.max(0, decimals))
  return Math.round(value * f) / f
}

/** The text a count-up shows: fixed decimals, so its width doesn't jump between frames. */
export function formatTweenNumber(value: number, decimals = 0): string {
  return roundTo(value, decimals).toFixed(Math.max(0, decimals))
}

/**
 * Should the number animate from what it shows now to `next`? Only a real
 * change of a finite number: a refetch that brings the same value back, a
 * NaN/Infinity or a disabled setting never animates.
 */
export function shouldTween(from: number | null, next: number, enabled: boolean): boolean {
  if (!enabled || from == null) return false
  if (!Number.isFinite(from) || !Number.isFinite(next)) return false
  return from !== next
}

export interface NewIdsState {
  /** The context the ids belong to (a day, a list); a new scope starts a fresh baseline. */
  scope: string
  /** Ids on screen last time; null until the list has loaded once. */
  known: ReadonlySet<string> | null
  /** Ids that appeared in the latest change. */
  fresh: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

/**
 * Which rows are NEW since the list was last seen. The first load (and the
 * first load in a new scope — another day) is the baseline and marks nothing,
 * so a page's rows never all "arrive" on open. A row that comes back (an Undo)
 * counts as new again.
 */
export function nextNewIds(prev: NewIdsState | null, ids: readonly string[], scope: string): NewIdsState {
  if (!prev || prev.known == null || prev.scope !== scope) return { scope, known: new Set(ids), fresh: NONE }
  const fresh = new Set<string>()
  for (const id of ids) if (!prev.known.has(id)) fresh.add(id)
  return { scope, known: new Set(ids), fresh: fresh.size ? fresh : NONE }
}
