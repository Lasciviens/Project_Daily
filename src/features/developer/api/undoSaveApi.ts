import { supabase } from '../../../integrations/supabase/client'
import type { RowOverrides } from '../../../shared/utils/deletedRows'
import { UNDO_ERROR_TEXT } from '../undoErrorText'

// "Undo this save" on Developer → Activity (migrations 150, 151). One save =
// one database transaction in audit_logs (tx_id). app_undo_transaction plans
// the inverse of every change of it and tries it (rolled back), so the
// preview says exactly what will change, what was changed again later
// (conflicts), what can't come back, what rules change besides and what goes
// to Trakt / Google; applying runs the same steps in one transaction and must
// pass back the plan's `confirm` fingerprint when it listed anything to
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
  /** order_unknown: a row changed more than once whose changes don't chain up (logged before 150). */
  reason: 'hidden' | 'table_gone' | 'no_key' | 'no_id' | 'no_access' | 'unreadable' | 'order_unknown'
  /** Changes of the save. */
  count: number
  detail?: string
  /** order_unknown: how many rows, and the first few names. */
  rows?: number
  labels?: string[]
}

/** A row outside the steps that a rule changed while the undo ran (151). */
export interface UndoSideEffect {
  t: string
  id: string | null
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  /** UPDATE: the columns it changed (bookkeeping aside). */
  columns: string[] | null
  label: string | null
}

export type UndoService = 'trakt' | 'google_tasks' | 'google_calendar'

/** Outbox rows the trial run queued for an outside service, per kind (151). */
export interface UndoOutbox {
  s: UndoService
  /**
   * Trakt: history_add, history_remove_play, history_remove (every play of an
   * item), watchlist_*, rating_*, note_*, dropped_*; Google Tasks: create,
   * update, delete; Google Calendar: delete (queued), create / update (the
   * browser right after the undo).
   */
  op: string
  n: number
  /** Trakt history_remove: the items whose every play goes. */
  items?: string[] | null
}

/** Another save by the same actor seconds from this one, on the same tables (151). */
export interface UndoNearby {
  tx: number
  at: string
  changes: number
  when: 'before' | 'after'
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
  /**
   * Tables outside the log a put-back row's foreign keys reach, for `rows`
   * put-back rows they could point at: their rows were deleted with it, or
   * only unlinked (SET NULL).
   */
  not_logged: { t: string; parent: string; how: 'deleted' | 'unlinked'; rows: number }[]
  /** Rows a trigger changes again after the undo (from the trial run, or the run itself). */
  drift: UndoDrift[]
  /** Rows outside the steps a rule changes while the undo runs. */
  side_effects: UndoSideEffect[]
  /** Such changes the caller's log doesn't show. */
  side_hidden: number
  /** What goes to Trakt / Google: the outbox rows the undo queues, and the Calendar events the browser makes or moves right after. */
  outbox: UndoOutbox[]
  /** Outside links (a slot's event, a task's Google task or list, a Trakt note) the save changed that Undo leaves as they are now. */
  links_kept: { t: string; c: string; n: number }[]
  /** A save by AI / a sync: the synced tables its undo changes (that service changes too). */
  sync_save: string[]
  /** Saves by the same actor within seconds that touched the same tables (a hint; not in the fingerprint). */
  nearby: UndoNearby[]
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
  '55P03': 'Another save is writing these rows — try again in a moment.',
  '57014': 'This save is too big to undo here.',
  PGRST202: 'Undo isn\'t available yet (migration 150 not applied).',
  '42883': 'Undo isn\'t available yet (migration 150 not applied).',
}

/** An undo's error as the preview would say it, never raw Postgres text when the code is known. */
function undoError(error: { code?: string; message: string }): Error {
  const code = error.code ?? ''
  if (MESSAGES[code]) return new Error(MESSAGES[code])
  if (UNDO_ERROR_TEXT[code]) return new Error(`Undo can't run: ${UNDO_ERROR_TEXT[code]}.`)
  return new Error(error.message)
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
