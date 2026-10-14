import type { UndoBlocked, UndoCollateral, UndoConflict, UndoDrift, UndoPlan, UndoTable } from '../api/undoSaveApi'
import { formatDate, formatDateTime, formatTime } from '../../../shared/utils/dateFormat'
import { friendlyTable } from './activityLogMeta'

// "Undo this save" in plain words (migration 150's plan → the preview's
// lines). Pure, so verify-undo-plan-text runs it against real plans' shapes.
// Conflicts come first, then what can't be undone, then what changes.

export type UndoTone = 'warn' | 'danger' | 'neutral'

export interface UndoLine {
  tone: UndoTone
  text: string
  /** A second, quieter line (the values now and after Undo). */
  detail?: string
}

export interface UndoPlanView {
  /** "73 changes · 14.10.2026 10:30 · You" */
  subtitle: string
  /** Rows changed again later: Undo overwrites or deletes something newer. */
  conflicts: UndoLine[]
  /** Rows a database rule changes again right after Undo. */
  drift: UndoLine[]
  /** Parts of the save Undo can't take back. */
  blocked: UndoLine[]
  /** What Undo changes, table by table. */
  changes: UndoLine[]
  /** What Undo's deletes take with them that the save didn't make. */
  also: UndoLine[]
  notes: string[]
  /** Why Undo can't run at all, as things are. */
  error: string | null
  /** Everything the save changed is already as it was. */
  nothingToDo: boolean
  canUndo: boolean
  confirmLabel: string
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

// Names that keep their capital in the middle of a sentence.
const PROPER = /^(TV|Kobo|ScreenScraper|GIF)\b/

/** "TV episode" → "TV episodes", "Task" → "task", "Diary entry" → "diary entries". */
export function tableNoun(table: string, count: number): string {
  const one = friendlyTable(table)
  const many = /series$/.test(one) ? one
    : /(s|x|ch|sh)$/.test(one) ? `${one}es`
    : /[^aeiou]y$/.test(one) ? `${one.slice(0, -1)}ies`
    : `${one}s`
  const word = count === 1 ? one : many
  return PROPER.test(word) ? word : word[0].toLowerCase() + word.slice(1)
}

/** "watched_at" → "watched date", "parent_task_id" → "parent task link". */
export function columnLabel(column: string): string {
  return column
    .replace(/_at$/, ' date')
    .replace(/_id$/, ' link')
    .replace(/_/g, ' ')
}

function columnList(columns: readonly string[], max = 3): string {
  const shown = columns.slice(0, max).map(columnLabel)
  return columns.length > max ? `${shown.join(', ')} +${columns.length - max} more` : shown.join(', ')
}

/** A stored value, shortly: dates as DD.MM.YYYY (HH:MM), empty as "empty". */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty'
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v)
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v)
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.slice(0, 5)
    return v.length > 40 ? `«${v.slice(0, 40)}…»` : `«${v}»`
  }
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > 40 ? `${s.slice(0, 40)}…` : s
  }
  return String(v)
}

/** A later time beside the save's: HH:MM on the same day, else the full date. */
function laterWhen(at: string, saveAt: string): string {
  return formatDate(at) === formatDate(saveAt) ? formatTime(at) : formatDateTime(at)
}

const nameOf = (c: { t: string; id: string | null; label: string | null }) =>
  `${friendlyTable(c.t)} «${c.label ?? (c.id ? `#${c.id.slice(0, 8)}` : '—')}»`

function conflictLine(c: UndoConflict, saveAt: string): UndoLine {
  // The last later save that touched these columns (or the row), if the log has it.
  const touching = c.later.filter(l => !l.columns || l.columns.some(col => c.columns.includes(col)))
  const last = (touching.length ? touching : c.later).at(-1)
  const when = last ? `later at ${laterWhen(last.at, saveAt)}` : 'since (not in the log)'
  const cols = c.columns.length ? ` (${columnList(c.columns)})` : ''
  const values = c.columns.length === 1 && c.now && c.undo
    ? `Now ${valueText(c.now[c.columns[0]])} · Undo puts back ${valueText(c.undo[c.columns[0]])}`
    : undefined
  switch (c.reason) {
    case 'deleted_later':
      return { tone: 'warn', text: `${nameOf(c)} — deleted ${when} · its old values can't go back` }
    case 'exists_again':
      return { tone: 'warn', text: `${nameOf(c)} — back again since and changed${cols} · Undo would replace it with the old one`, detail: values }
    default:
      return c.action === 'delete'
        ? { tone: 'warn', text: `${nameOf(c)} — made by this save, changed ${when}${cols} · Undo deletes it with that change` }
        : { tone: 'warn', text: `${nameOf(c)} — changed again ${when}${cols} · Undo would overwrite it`, detail: values }
  }
}

function blockedLine(b: UndoBlocked): UndoLine {
  const changes = n(b.count, 'change', 'changes')
  switch (b.reason) {
    case 'hidden':
      return { tone: 'danger', text: `${changes} of this save ${b.count === 1 ? "isn't" : "aren't"} in your log (written for no account) — Undo can't see ${b.count === 1 ? 'it' : 'them'}` }
    case 'table_gone':
      return { tone: 'danger', text: `${changes} to ${b.t ?? '?'} — that table no longer exists` }
    case 'no_access':
      return { tone: 'danger', text: `${changes} to ${tableNoun(b.t ?? '?', 2)} — you may not read that table` }
    case 'unreadable':
      return { tone: 'danger', text: `${changes} to ${tableNoun(b.t ?? '?', 2)} — the old values no longer fit the table`, detail: b.detail }
    default:
      return { tone: 'danger', text: `${changes} to ${tableNoun(b.t ?? '?', 2)} — rows without an id can't be undone` }
  }
}

function driftLine(d: UndoDrift): UndoLine {
  const name = nameOf(d)
  if (d.how === 'still_there') return { tone: 'warn', text: `${name} — a database rule keeps it after Undo deletes it` }
  if (d.how === 'missing') return { tone: 'warn', text: `${name} — a database rule removes it again after Undo puts it back` }
  return { tone: 'warn', text: `${name} — a database rule sets ${columnList(d.columns ?? [])} again after Undo · it won't be exactly as before` }
}

function tableLines(t: UndoTable): UndoLine[] {
  const out: UndoLine[] = []
  if (t.revert) out.push({ tone: 'neutral', text: `${t.revert} ${tableNoun(t.t, t.revert)}: ${columnList(t.columns)} put back` })
  if (t.reinsert) out.push({ tone: 'neutral', text: `${t.reinsert} ${tableNoun(t.t, t.reinsert)} deleted by this save: put back` })
  if (t.delete) out.push({ tone: 'neutral', text: `${t.delete} ${tableNoun(t.t, t.delete)} made by this save: deleted` })
  if (t.overwrite) out.push({ tone: 'neutral', text: `${t.overwrite} ${tableNoun(t.t, t.overwrite)} back again since: replaced with the old ${t.overwrite === 1 ? 'one' : 'ones'}` })
  if (t.already) out.push({ tone: 'neutral', text: `${t.already} ${tableNoun(t.t, t.already)} already as before` })
  return out
}

const HOW: Record<UndoCollateral['how'], string> = {
  deleted: 'Also deleted', unlinked: 'Also unlinked', changed: 'Also changed', hidden: 'Also deleted', too_big: 'Also',
}

function alsoLines(rows: readonly UndoCollateral[]): UndoLine[] {
  const groups = new Map<string, UndoCollateral[]>()
  for (const r of rows) groups.set(`${r.how}:${r.t}`, [...(groups.get(`${r.how}:${r.t}`) ?? []), r])
  return [...groups.values()].map(g => {
    const { how, t } = g[0]
    if (how === 'hidden') return { tone: 'warn', text: `${HOW.hidden}: rows of ${tableNoun(t, 2)} you can't see` }
    if (how === 'too_big') return { tone: 'warn', text: `Too much goes with ${tableNoun(t, 2)} to list it all` }
    const names = g.slice(0, 3).map(r => `«${r.label ?? (r.id ? `#${r.id.slice(0, 8)}` : '—')}»`).join(', ')
    const more = g.length > 3 ? ` +${g.length - 3} more` : ''
    return { tone: 'warn', text: `${HOW[how]}: ${g.length} ${tableNoun(t, g.length)} not made by this save (${names}${more})` }
  })
}

// Linked services follow the database's own triggers and the app's Undo
// follow-ups: an undo of a synced change sends the reverse change there.
const SYNCED: Record<string, string> = {
  tasks: 'Google Tasks', time_blocks: 'Google Calendar', schedule_blocks: 'Google Calendar',
  user_movie_entries: 'Trakt', user_tv_entries: 'Trakt', user_tv_episodes: 'Trakt',
}

function notesOf(plan: UndoPlan): string[] {
  const notes: string[] = []
  if (plan.kept.length) {
    notes.push(`${n(plan.kept.length, 'row was', 'rows were')} changed again later in other fields — Undo keeps those changes`)
  }
  for (const t of plan.tables) {
    for (const [col, why] of Object.entries(t.skipped_columns)) {
      const where = `${columnLabel(col)} (${tableNoun(t.t, 2)})`
      notes.push(why === 'generated' ? `${where} is worked out by the database — it follows`
        : why === 'identity' ? `${where} is numbered by the database — a row put back gets a new number`
        : `${where} no longer exists — its old value can't go back`)
    }
    if (!t.audited && t.revert + t.reinsert + t.delete + t.overwrite > 0) {
      notes.push(`${friendlyTable(t.t)} changes are no longer logged — this undo can't be undone itself`)
    }
  }
  const services = [...new Set(plan.tables
    .filter(t => t.revert + t.reinsert + t.delete + t.overwrite > 0 && SYNCED[t.t])
    .map(t => SYNCED[t.t]))]
  if (services.length) notes.push(`${services.join(' and ')} ${services.length === 1 ? 'gets' : 'get'} the reverse change too`)
  notes.push('Only what the activity log keeps can be undone — synced data (Hevy, Health, Strava) isn\'t in it')
  return notes
}

const ERRORS: Record<string, string> = {
  '23503': 'a row it needs was deleted since',
  '23505': 'another row has taken its place since',
  '23514': 'an old value breaks a rule of the table now',
  '23502': 'a value the table now needs is missing',
  '42501': 'some of these rows may not be changed',
  UD004: 'a row can\'t be written back (gone, or not yours)',
}

export function describeUndoPlan(plan: UndoPlan): UndoPlanView {
  const who = plan.actors.includes('web') ? (plan.actors.includes('service') ? 'You and AI / sync' : 'You') : 'AI / sync'
  const blocked = [
    ...plan.blocked.map(blockedLine),
    ...plan.not_logged.map(x => {
      const rows = tableNoun(x.t, 2)
      return {
        tone: 'danger' as const,
        text: `${rows[0].toUpperCase()}${rows.slice(1)} that went with a deleted ${tableNoun(x.parent, 1)} aren't in the log — they can't come back`,
      }
    }),
  ]
  const error = plan.error ? `Undo can't run: ${ERRORS[plan.error.code] ?? plan.error.message}` : null
  const nothingToDo = plan.steps === 0 && plan.conflicts.length === 0 && plan.blocked.length === 0 && !plan.not_logged.length
  return {
    subtitle: [n(plan.changes, 'change', 'changes'), formatDateTime(plan.at), who].filter(Boolean).join(' · '),
    conflicts: plan.conflicts.map(c => conflictLine(c, plan.at)),
    drift: (plan.drift ?? []).map(driftLine),
    blocked,
    changes: plan.tables.flatMap(tableLines),
    also: alsoLines(plan.collateral),
    notes: notesOf(plan),
    error,
    nothingToDo,
    canUndo: plan.can_apply && plan.steps > 0,
    confirmLabel: plan.needs_confirm ? 'Undo anyway' : 'Undo',
  }
}

/** How many rows an applied undo changed (its own answer). */
export function undoneCount(plan: UndoPlan): number {
  const r = plan.result
  return r ? r.reverted + r.overwritten + r.deleted + r.reinserted : 0
}

/** The toast after an undo, from its own answer. */
export function undoDoneMessage(plan: UndoPlan): string {
  const count = undoneCount(plan)
  return count === 0 ? 'Nothing to undo — already as before' : `Save undone · ${n(count, 'change', 'changes')} put back`
}
