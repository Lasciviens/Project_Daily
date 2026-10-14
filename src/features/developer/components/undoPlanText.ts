import type {
  UndoBlocked, UndoCollateral, UndoConflict, UndoDrift, UndoNearby, UndoOutbox, UndoPlan, UndoService, UndoSideEffect, UndoTable,
} from '../api/undoSaveApi'
import { UNDO_ERROR_TEXT } from '../undoErrorText'
import { formatDate, formatDateTime, formatTime } from '../../../shared/utils/dateFormat'
import { friendlyTable } from './activityLogMeta'

// "Undo this save" in plain words (migrations 150/151's plan → the preview's
// lines). Pure, so verify-undo-plan-text runs it against real plans' shapes.
// Conflicts come first, then what goes outside the app, then what can't be
// undone, then what changes.

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
  /** Other media saves seconds from this one (one Spread makes up to three): undo them too, if they belong together. */
  hint: NearbyHint | null
  /** Rows changed again later: Undo overwrites or deletes something newer. */
  conflicts: UndoLine[]
  /** Rows a database rule changes again right after Undo. */
  drift: UndoLine[]
  /** What Undo changes on Trakt / Google, and a sync's save. */
  outside: UndoLine[]
  /** Parts of the save Undo can't take back. */
  blocked: UndoLine[]
  /** What Undo changes, table by table. */
  changes: UndoLine[]
  /** What Undo's deletes take with them that the save didn't make, and rows a rule changes besides. */
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
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

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

/** «a», «b», «c» +2 more */
function nameList(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).map(x => `«${x}»`).join(', ')
  return names.length > max ? `${shown} +${names.length - max} more` : shown
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

const rowName = (c: { id: string | null; label: string | null }) => c.label ?? (c.id ? `#${c.id.slice(0, 8)}` : '—')
const nameOf = (c: { t: string; id: string | null; label: string | null }) => `${friendlyTable(c.t)} «${rowName(c)}»`

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
    case 'order_unknown': {
      const rows = b.rows ?? 1
      const names = b.labels?.length ? ` (${nameList(b.labels)})` : ''
      return { tone: 'danger', text: `${n(rows, tableNoun(b.t ?? '?', 1), tableNoun(b.t ?? '?', 2))}${names} changed more than once in this save, order unknown — Undo leaves ${rows === 1 ? 'it' : 'them'} as ${rows === 1 ? 'it is' : 'they are'}` }
    }
    default:
      return { tone: 'danger', text: `${changes} to ${tableNoun(b.t ?? '?', 2)} — rows without an id can't be undone` }
  }
}

function notLoggedLine(x: UndoPlan['not_logged'][number]): UndoLine {
  const rows = cap(tableNoun(x.t, 2))
  const count = x.rows ?? 1
  const parent = count === 1 ? `a deleted ${tableNoun(x.parent, 1)}` : `${count} deleted ${tableNoun(x.parent, count)}`
  const had = count === 1 ? 'if it had any' : 'if they had any'
  return x.how === 'unlinked'
    ? { tone: 'danger', text: `${rows} that pointed at ${parent} aren't in the log — ${had}, they stay unlinked` }
    : { tone: 'danger', text: `${rows} of ${parent} aren't in the log — ${had}, they can't come back` }
}

function driftLine(d: UndoDrift): UndoLine {
  const name = nameOf(d)
  if (d.how === 'still_there') return { tone: 'warn', text: `${name} — a database rule keeps it after Undo deletes it` }
  if (d.how === 'missing') return { tone: 'warn', text: `${name} — a database rule removes it again after Undo puts it back` }
  return { tone: 'warn', text: `${name} — a database rule changes ${columnList(d.columns ?? [])} right after Undo · it won't be exactly as before` }
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
    return { tone: 'warn', text: `${HOW[how]}: ${g.length} ${tableNoun(t, g.length)} not made by this save (${nameList(g.map(rowName))})` }
  })
}

const SIDE_VERB: Record<UndoSideEffect['op'], string> = { DELETE: 'deleted', INSERT: 'made', UPDATE: 'changed' }

/** Rows a rule (a trigger between tables) changes while Undo runs, grouped. */
function sideLines(rows: readonly UndoSideEffect[], hidden: number): UndoLine[] {
  const groups = new Map<string, UndoSideEffect[]>()
  for (const r of rows) groups.set(`${r.op}:${r.t}`, [...(groups.get(`${r.op}:${r.t}`) ?? []), r])
  const out: UndoLine[] = [...groups.values()].map(g => {
    const { op, t } = g[0]
    const cols = op === 'UPDATE' ? [...new Set(g.flatMap(r => r.columns ?? []))] : []
    return {
      tone: 'warn' as const,
      text: `Also ${SIDE_VERB[op]} by a database rule: ${g.length} ${tableNoun(t, g.length)} (${nameList(g.map(rowName))})${cols.length ? ` · ${columnList(cols)}` : ''}`,
    }
  })
  if (hidden > 0) out.push({ tone: 'warn', text: `${n(hidden, 'more change', 'more changes')} a database rule makes ${hidden === 1 ? "isn't" : "aren't"} in your log` })
  return out
}

/**
 * The table → outside service map: an undo of a change to one of these goes
 * there too. Kept in step with app_undo_synced (migration 151) —
 * verify-undo-plan-text compares the two.
 */
export const SYNCED: Record<string, UndoService> = {
  tasks: 'google_tasks', time_blocks: 'google_calendar', schedule_blocks: 'google_calendar',
  user_movie_entries: 'trakt', user_tv_entries: 'trakt', user_tv_episodes: 'trakt', media_watches: 'trakt',
}

export const SERVICE_NAME: Record<UndoService, string> = {
  trakt: 'Trakt', google_tasks: 'Google Tasks', google_calendar: 'Google Calendar',
}

const SERVICE_ORDER: UndoService[] = ['trakt', 'google_tasks', 'google_calendar']

function joinAnd(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** Trakt's outbox kinds in plain words; a whole-item remove gets a line of its own. */
function traktLines(rows: readonly UndoOutbox[]): UndoLine[] {
  const count = (...ops: string[]) => rows.filter(r => ops.includes(r.op)).reduce((s, r) => s + r.n, 0)
  const out: UndoLine[] = []
  const whole = rows.find(r => r.op === 'history_remove')
  if (whole) {
    const items = whole.items?.length ? ` (${nameList(whole.items)})` : ''
    out.push({ tone: 'danger', text: `Trakt: every play of ${n(whole.n, 'item', 'items')}${items} is removed there — this can't be undone on Trakt` })
  }
  const parts: string[] = []
  const removed = count('history_remove_play')
  const added = count('history_add')
  if (removed && added) parts.push(`${n(removed, 'play', 'plays')} removed and ${added} added at the restored dates`)
  else if (removed) parts.push(`${n(removed, 'play', 'plays')} removed`)
  else if (added) parts.push(`${n(added, 'play', 'plays')} added at the restored dates`)
  const watchlist = count('watchlist_add', 'watchlist_remove')
  if (watchlist) parts.push(`${n(watchlist, 'watchlist change', 'watchlist changes')}`)
  const ratings = count('rating_add', 'rating_remove')
  if (ratings) parts.push(`${n(ratings, 'rating', 'ratings')} changed`)
  const notes = count('note_set', 'note_remove')
  if (notes) parts.push(`${n(notes, 'note', 'notes')} changed`)
  const dropped = count('dropped_add', 'dropped_remove')
  if (dropped) parts.push(`${n(dropped, 'dropped mark', 'dropped marks')} changed`)
  const known = ['history_remove', 'history_remove_play', 'history_add', 'watchlist_add', 'watchlist_remove', 'rating_add', 'rating_remove',
    'note_set', 'note_remove', 'dropped_add', 'dropped_remove']
  const other = rows.filter(r => !known.includes(r.op)).reduce((s, r) => s + r.n, 0)
  if (other) parts.push(`${n(other, 'other change', 'other changes')}`)
  if (parts.length) out.push({ tone: 'danger', text: `Trakt: ${parts.join(' · ')}` })
  return out
}

const GOOGLE_WORDS: Record<'google_tasks' | 'google_calendar', { one: string; many: string; ops: Record<string, string> }> = {
  google_tasks: { one: 'task', many: 'tasks', ops: { create: 'added', update: 'changed', delete: 'removed' } },
  google_calendar: { one: 'event', many: 'events', ops: { create: 'added', update: 'changed', delete: 'removed' } },
}

function googleLine(s: 'google_tasks' | 'google_calendar', rows: readonly UndoOutbox[]): UndoLine {
  const w = GOOGLE_WORDS[s]
  const order = ['delete', 'create', 'update']
  const parts = [...rows]
    .sort((a, b) => order.indexOf(a.op) - order.indexOf(b.op))
    .map(r => `${n(r.n, w.one, w.many)} ${w.ops[r.op] ?? r.op}`)
  return { tone: 'danger', text: `${SERVICE_NAME[s]}: ${parts.join(' · ')}` }
}

/** An outside link (app_undo_links) Undo leaves as it is: what it links, per column. */
const LINK_WORDS: Record<string, { service: UndoService; what: string }> = {
  google_calendar_event_id: { service: 'google_calendar', what: 'event link' },
  google_task_id: { service: 'google_tasks', what: 'Google task link' },
  google_tasklist_id: { service: 'google_tasks', what: 'Google list' },
  trakt_note_id: { service: 'trakt', what: 'Trakt note link' },
}

function linkLine(l: UndoPlan['links_kept'][number]): UndoLine {
  const w = LINK_WORDS[l.c] ?? { service: SYNCED[l.t] ?? 'google_tasks', what: `${columnLabel(l.c)}` }
  const own = l.n === 1 ? 'its' : 'their'
  return {
    tone: 'warn',
    text: `${SERVICE_NAME[w.service]}: ${n(l.n, tableNoun(l.t, 1), tableNoun(l.t, l.n))} ${l.n === 1 ? 'keeps' : 'keep'} ${own} current ${w.what} — Undo doesn't put the old one back`,
  }
}

/**
 * What goes to Trakt / Google (the trial run's outbox rows and the Calendar
 * events the browser makes or moves right after), the outside links Undo
 * leaves, and — for a sync's save — a service that gets nothing from this
 * undo and may bring the change back.
 */
function outsideLines(plan: UndoPlan): UndoLine[] {
  const out: UndoLine[] = []
  const outbox = plan.outbox ?? []
  for (const s of SERVICE_ORDER) {
    const rows = outbox.filter(r => r.s === s)
    if (!rows.length) continue
    if (s === 'trakt') out.push(...traktLines(rows))
    else out.push(googleLine(s, rows))
  }
  out.push(...(plan.links_kept ?? []).map(linkLine))
  const sent = new Set(outbox.map(o => o.s))
  const quiet = [...new Set((plan.sync_save ?? []).map(t => SYNCED[t]).filter(Boolean))]
    .filter(s => !sent.has(s))
    .sort((a, b) => SERVICE_ORDER.indexOf(a) - SERVICE_ORDER.indexOf(b))
    .map(s => SERVICE_NAME[s])
  if (quiet.length) {
    out.push({ tone: 'warn', text: `This save came from AI / sync. ${joinAnd(quiet)} still ${quiet.length === 1 ? 'has' : 'have'} it — the next sync may bring it back` })
  }
  return out
}

export interface NearbyHint {
  text: string
  /** The save the hint's link opens: the newest after this one, else the newest before it. */
  tx: number
  action: string
}

/** One line: media saves seconds from this one, by the same actor (one Spread makes up to three) — if they belong together. */
export function nearbyHint(nearby: readonly UndoNearby[] | undefined): NearbyHint | null {
  const after = (nearby ?? []).filter(x => x.when === 'after')
  const before = (nearby ?? []).filter(x => x.when === 'before')
  if (!after.length && !before.length) return null
  const newest = (xs: readonly UndoNearby[]) => [...xs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.tx - b.tx)).at(-1)!.tx
  const them = after.length + before.length === 1 ? 'it' : 'them'
  if (after.length) {
    const also = before.length ? ` and ${before.length} earlier` : ''
    return {
      text: `${n(after.length, 'more save', 'more saves')} seconds later${also} (one Spread?) — if they belong together, undo ${them} too, newest first`,
      tx: newest(after),
      action: 'Open the newest',
    }
  }
  return {
    text: `${n(before.length, 'more save', 'more saves')} seconds earlier (one Spread?) — if they belong together, undo ${them} too, after this one`,
    tx: newest(before),
    action: 'Open the one before',
  }
}

/** The fields of a slot its Google Calendar event shows (useUndoSave → followUndo moves the event when one goes back). */
export const CALENDAR_FIELDS = ['date', 'start_time', 'title', 'duration_minutes'] as const

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
  return notes
}

export function describeUndoPlan(plan: UndoPlan): UndoPlanView {
  const who = plan.actors.includes('web') ? (plan.actors.includes('service') ? 'You and AI / sync' : 'You') : 'AI / sync'
  // `?? []`: a plan from before migration 151 lacks these (remove once 151 is live everywhere).
  const notLogged = plan.not_logged ?? []
  const blocked = [...plan.blocked.map(blockedLine), ...notLogged.map(notLoggedLine)]
  const error = plan.error ? `Undo can't run: ${UNDO_ERROR_TEXT[plan.error.code] ?? plan.error.message}` : null
  const nothingToDo = plan.steps === 0 && plan.conflicts.length === 0 && plan.blocked.length === 0 && !notLogged.length
    && !(plan.links_kept ?? []).length
  return {
    subtitle: [n(plan.changes, 'change', 'changes'), formatDateTime(plan.at), who].filter(Boolean).join(' · '),
    hint: nearbyHint(plan.nearby),
    conflicts: plan.conflicts.map(c => conflictLine(c, plan.at)),
    drift: (plan.drift ?? []).map(driftLine),
    outside: outsideLines(plan),
    blocked,
    changes: plan.tables.flatMap(tableLines),
    also: [...alsoLines(plan.collateral), ...sideLines(plan.side_effects ?? [], plan.side_hidden ?? 0)],
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

/** The undo changed media rows: Trakt should hear about it soon (the outbox drains on a sync). */
export function touchesTrakt(plan: UndoPlan): boolean {
  const r = plan.result
  if (!r) return false
  const tables = [...r.reverted_rows.map(x => x.t), ...r.reinserted_rows.map(x => x.t), ...r.deleted_rows.map(g => g.table)]
  return tables.some(t => SYNCED[t] === 'trakt') || (plan.outbox ?? []).some(o => o.s === 'trakt')
}
