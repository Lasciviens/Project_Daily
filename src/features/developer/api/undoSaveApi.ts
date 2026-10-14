import { supabase } from '../../../integrations/supabase/client'
import type { RowOverrides } from '../../../shared/utils/deletedRows'

// "Undo this save" on Developer → Activity (migration 150). One save = one
// database transaction in audit_logs (tx_id). app_undo_transaction plans the
// inverse of every change of it and tries it (rolled back), so the preview
// says exactly what will change, what was changed again later (conflicts) and
// what can't come back; applying runs the same steps in one transaction and
// must pass back the plan's `confirm` fingerprint when it listed anything to
// confirm. Both answers are the result — no second read.

export interface LaterChange {
  tx: number
  at: string
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  actor: 'web' | 'service'
  /** UPDATE: the columns it changed; null for an insert/delete (the whole row). */
  columns: string[] | null
}

export interface UndoTable {
  t: string
  /** The table still has the audit trigger (so this undo can itself be undone). */
  audited: boolean
  revert: number
  delete: number
  reinsert: number
  overwrite: number
  /** Rows deleted since: their old values can't go back. */
  skip: number
  /** Rows already back as they were before the save. */
  already: number
  /** Rows the save changed and changed back (nothing to do). */
  same: number
  /** Columns put back. */
  columns: string[]
  /** Columns a value can't go back into, with why. */
  skipped_columns: Record<string, 'generated' | 'identity' | 'dropped'>
}

export interface UndoConflict {
  t: string
  id: string
  label: string | null
  action: 'revert' | 'delete' | 'overwrite' | 'skip'
  reason: 'changed_later' | 'deleted_later' | 'exists_again'
  columns: string[]
  now: Record<string, unknown> | null
  undo: Record<string, unknown> | null
  later: LaterChange[]
}

export interface UndoKept {
  t: string
  id: string
  label: string | null
  later: LaterChange[]
}

export interface UndoBlocked {
  t?: string
  reason: 'hidden' | 'table_gone' | 'no_key' | 'no_id' | 'no_access' | 'unreadable'
  count: number
  detail?: string
}

export interface UndoCollateral {
  t: string
  id: string | null
  how: 'deleted' | 'unlinked' | 'changed' | 'hidden' | 'too_big'
  label: string | null
}

/** A row that isn't as the undo left it once its steps ran: a trigger changed it again. */
export interface UndoDrift {
  t: string
  id: string
  how: 'changed' | 'still_there' | 'missing'
  /** changed: the columns that aren't back to their old value. */
  columns: string[] | null
  label: string | null
}

export interface UndoRowGroup {
  table: string
  pk: string | null
  rows: Record<string, unknown>[]
}

export interface UndoResult {
  /** This undo's own transaction in the log: undoing it is the way back. */
  undo_tx: number
  reverted: number
  overwritten: number
  deleted: number
  reinserted: number
  /** Rows written back, as they are now, with the columns put back. */
  reverted_rows: { t: string; columns: string[]; row: Record<string, unknown> }[]
  /** Rows inserted again, as they were (before the overrides). */
  reinserted_rows: { t: string; row: Record<string, unknown> }[]
  /** Rows deleted, with what went with them. */
  deleted_rows: UndoRowGroup[]
}

export interface UndoPlan {
  tx_id: number
  at: string
  actors: ('web' | 'service')[]
  /** Changes of the save in the log. */
  changes: number
  /** Changes of the save the caller's log doesn't show. */
  hidden: number
  /** Rows the undo changes. */
  steps: number
  tables: UndoTable[]
  conflicts: UndoConflict[]
  kept: UndoKept[]
  blocked: UndoBlocked[]
  collateral: UndoCollateral[]
  /** Tables outside the log a put-back row's foreign keys reach. */
  not_logged: { t: string; parent: string }[]
  /** Rows a trigger changes again after the undo (from the trial run, or the run itself). */
  drift: UndoDrift[]
  /** Why the trial run failed (the undo can't run as things are). */
  error: { message: string; code: string } | null
  can_apply: boolean
  needs_confirm: boolean
  /** The plan's fingerprint; an apply passes it back. */
  confirm: string
  applied: boolean
  result: UndoResult | null
}

const MESSAGES: Record<string, string> = {
  UD001: 'Undo needs you to confirm what it lists first — look again.',
  UD002: 'This save changed since you looked — look again.',
  UD003: 'This save is no longer in the activity log (cleared, or older than 30 days).',
  PGRST202: 'Undo isn\'t available yet (migration 150 not applied).',
  '42883': 'Undo isn\'t available yet (migration 150 not applied).',
}

function undoError(error: { code?: string; message: string }): Error {
  return new Error((error.code && MESSAGES[error.code]) || error.message)
}

/** What undoing the save would do — changes nothing. */
export async function fetchUndoPlan(txId: number, overrides: RowOverrides): Promise<UndoPlan> {
  const { data, error } = await supabase.rpc('app_undo_transaction', {
    p_tx_id: txId, p_apply: false, p_confirm: null, p_overrides: overrides,
  })
  if (error) throw undoError(error)
  return data as UndoPlan
}

/** Undoes the save in one transaction; `confirm` is the previewed plan's fingerprint. */
export async function applyUndo(txId: number, confirm: string, overrides: RowOverrides): Promise<UndoPlan> {
  const { data, error } = await supabase.rpc('app_undo_transaction', {
    p_tx_id: txId, p_apply: true, p_confirm: confirm, p_overrides: overrides,
  })
  if (error) throw undoError(error)
  return data as UndoPlan
}
