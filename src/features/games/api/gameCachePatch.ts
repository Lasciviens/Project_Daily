// Optimistic cache patching for the games namespace. Pure (no React, no
// Supabase), so scripts/verify-game-cache-patch.cjs can require it directly.
//
// Every read of the library lives under ['games', …] with a different shape:
// arrays of rows (the retro list, each provider library, the queue), one row
// (a detail), or `{ rows, platforms }` (the stats read). A status, rating or
// queue tap patches the row wherever it is cached, instead of refetching
// several megabytes of library to change one field.

import { playStatsOf, type PlayStatRow } from '../gameStats'

type Row = { id: string }

function patchRows<T>(rows: T[], id: string, patch: object): T[] {
  let hit = false
  const out = rows.map(r => {
    if (r && (r as unknown as Row).id === id) { hit = true; return { ...r, ...patch } }
    return r
  })
  return hit ? out : rows
}

/**
 * One cached value with row `id` patched. Unknown shapes, and caches that do
 * not hold the row, are returned untouched (same reference, so nothing
 * re-renders). An unloaded cache (undefined) stays undefined — writing `[]`
 * there would paint "library empty" until the next fetch.
 */
export function patchGameData<T>(data: T, id: string, patch: object): T {
  if (data == null) return data
  if (Array.isArray(data)) return patchRows(data, id, patch) as unknown as T
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.id === id) return { ...d, ...patch } as T
    if (Array.isArray(d.rows)) {
      const rows = patchRows(d.rows as unknown[], id, patch)
      return rows === d.rows ? data : ({ ...d, rows } as T)
    }
  }
  return data
}

/**
 * What a status change writes — the ONE rule for the server write
 * (setPlayStatus) and the optimistic patch. Playing stamps `started_at` and
 * Completed stamps `finished_at` only when still empty; the finish date is the
 * provider's last session (playStatsOf), `now` only when none was reported.
 */
export function statusPatch(
  current: (PlayStatRow & { started_at?: string | null; finished_at?: string | null }) | null,
  status: string,
  nowIso: string,
): { play_status: string; started_at?: string; finished_at?: string } {
  const patch: { play_status: string; started_at?: string; finished_at?: string } = { play_status: status }
  if (status === 'playing' && !current?.started_at) patch.started_at = nowIso
  if (status === 'completed' && !current?.finished_at) patch.finished_at = (current ? playStatsOf(current).last : null) ?? nowIso
  return patch
}

/** The next queue position among every cached row (the server recomputes its own). */
export function nextQueuePosition(lists: unknown[]): number {
  let max = 0
  for (const d of lists) {
    const rows = Array.isArray(d) ? d : null
    if (!rows) continue
    for (const r of rows) {
      const o = (r as { play_order?: number | null })?.play_order
      if (typeof o === 'number' && o > max) max = o
    }
  }
  return max + 1
}
