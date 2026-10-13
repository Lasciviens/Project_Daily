import type { QueryClient, QueryKey } from '@tanstack/react-query'

// Cache patches from a write's own answer (owner, 13.10.2026: "check the
// result like sy-subrc instead of reading the database again"). A write that
// returns its row tells us exactly what is stored now, so every cached list
// holding that row is updated in place at once; the background refresh that
// follows only moves rows between lists (a task that now belongs to another
// day). Only arrays of rows with an `id` and single rows with an `id` are
// touched — any other shape under the root is left to the refresh.

type Row = { id: string }
export type CacheSnapshot = Array<[QueryKey, unknown]>

const isRow = (v: unknown): v is Row =>
  !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'

const isRowList = (v: unknown): v is Row[] => Array.isArray(v) && v.every(isRow)

/** Everything cached under `root`, to put back if the write fails. */
export function snapshotCache(qc: QueryClient, root: QueryKey): CacheSnapshot {
  return qc.getQueriesData({ queryKey: root })
}

export function restoreCache(qc: QueryClient, snapshot: CacheSnapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data)
}

/** Replaces matching rows (by id) in every cached list and single row under `root`. */
export function mapRowsInCache<T extends Row>(qc: QueryClient, root: QueryKey, ids: ReadonlySet<string>, fn: (row: T) => T): void {
  for (const [key, data] of qc.getQueriesData({ queryKey: root })) {
    if (isRowList(data)) {
      if (!data.some(r => ids.has(r.id))) continue
      qc.setQueryData(key, data.map(r => (ids.has(r.id) ? fn(r as T) : r)))
    } else if (isRow(data) && ids.has(data.id)) {
      qc.setQueryData(key, fn(data as T))
    }
  }
}

/** Puts the stored row (a write's answer) in place of the cached copy, wherever it is cached. */
export function putRowsInCache<T extends Row>(qc: QueryClient, root: QueryKey, rows: readonly T[]): void {
  const byId = new Map(rows.map(r => [r.id, r]))
  mapRowsInCache<T>(qc, root, new Set(byId.keys()), r => ({ ...r, ...byId.get(r.id) }))
}

/** Takes rows out of every cached list under `root` (single-row entries are left to their own re-read). */
export function removeRowsFromCache(qc: QueryClient, root: QueryKey, ids: ReadonlySet<string>): void {
  for (const [key, data] of qc.getQueriesData({ queryKey: root })) {
    if (isRowList(data) && data.some(r => ids.has(r.id))) qc.setQueryData(key, data.filter(r => !ids.has(r.id)))
  }
}
