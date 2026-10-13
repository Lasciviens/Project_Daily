import { supabase } from '../../integrations/supabase/client'

// The one way to delete rows with Undo (migration 144). app_delete_rows
// deletes and, in the same transaction, returns what went with the rows — the
// rows a foreign key deleted with them, the links it emptied, the rows a rule
// changed — so Undo puts back exactly that, with the same ids, in one call.
// Its answer is the result: NULL = nothing was deleted (gone already), no
// second read needed. See confirmDelete (shared/modals/deleteFlow.ts) for the
// question and the "Deleted · Undo" toast around it.

export interface DeletedGroup {
  table: string
  /** The table's key column, null for a child with a composite key. */
  pk: string | null
  rows: Record<string, unknown>[]
}

export interface DeletedRows {
  v: 1
  root: string
  deleted: number
  /** The rows themselves and everything deleted with them, parents first. */
  groups: DeletedGroup[]
  /** Rows whose link to a deleted row was emptied (their values before). */
  links: (DeletedGroup & { col: string })[]
  /** Rows a rule changed because of the delete (their values before). */
  touched: DeletedGroup[]
  /** Tables of rows deleted with them that you can't read (can't come back). */
  hidden: string[]
  /** Too many rows to hold for Undo — deleted all the same. */
  too_big?: boolean
}

/** Per table: columns to replace when putting rows back (e.g. ids of things deleted outside the app). */
export type RowOverrides = Record<string, Record<string, unknown>>

export interface RestoreResult {
  restored: number
  relinked: number
  /** Tables whose rows could not be written back. */
  skipped: string[]
}

const functionMissing = (e: { code?: string } | null) => e?.code === 'PGRST202' || e?.code === '42883'

/** Deletes the rows by id; returns what was deleted, or null when nothing was there. */
export async function deleteRows(table: string, ids: readonly string[]): Promise<DeletedRows | null> {
  if (!ids.length) return null
  const { data, error } = await supabase.rpc('app_delete_rows', { p_table: table, p_ids: [...ids] })
  if (!error) return (data as DeletedRows | null) ?? null
  if (!functionMissing(error)) throw error
  // Before migration 144: the rows alone (Undo brings back only them).
  const res = await supabase.from(table).delete().in('id', [...ids]).select()
  if (res.error) throw res.error
  if (!res.data?.length) return null
  return { v: 1, root: table, deleted: res.data.length, groups: [{ table, pk: 'id', rows: res.data }], links: [], touched: [], hidden: [] }
}

/** Puts a delete back with the same ids, all or nothing. */
export async function restoreRows(snapshot: DeletedRows, overrides: RowOverrides = {}): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('app_restore_rows', { p_snapshot: snapshot, p_overrides: overrides })
  if (!error) return data as RestoreResult
  if (!functionMissing(error)) throw error
  let restored = 0
  for (const g of snapshot.groups) {
    const rows = g.rows.map(r => ({ ...r, ...(overrides[g.table] ?? {}) }))
    const res = await supabase.from(g.table).upsert(rows, { onConflict: g.pk ?? undefined, ignoreDuplicates: true }).select()
    if (res.error) throw res.error
    restored += res.data?.length ?? 0
  }
  return { restored, relinked: 0, skipped: [] }
}

/** The deleted rows of one table. */
export function rowsOf<T>(snapshot: DeletedRows | null | undefined, table: string): T[] {
  return (snapshot?.groups ?? []).filter(g => g.table === table).flatMap(g => g.rows as T[])
}

/** What Undo could not bring back, said plainly (empty when everything came back). */
export function notRestoredNote(snapshot: DeletedRows, result: RestoreResult, names: Record<string, string> = {}): string {
  const lost = [...new Set([...snapshot.hidden, ...result.skipped])].map(t => names[t] ?? t.replace(/_/g, ' '))
  return lost.length ? `Not brought back: ${lost.join(', ')}` : ''
}
