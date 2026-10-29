// THE project rules — templates, a table block's columns and cells, the order
// of a block's entries, and what a project's numbers are (phases, tasks, open
// questions, what's next). Pure, checked by scripts/verify-project-model.cjs.
//
// A project is a header, a plan (phases with their tasks — real tasks, the
// one task table) and a few general blocks (migration 162; owner 18.10.2026:
// "the project page should be able to work with every kind of project"). A
// template only decides which phases and blocks a new project starts with;
// every one can be renamed, moved or removed later.

import { formatDate } from '../../shared/utils/dateFormat'
import { formatMoney } from '../settings/subscriptionRules'
import { isOpenTask } from '../todo/taskRules'
import type { TaskStatus } from '../todo/types'
import type {
  BlockKind, ColumnType, EntryState, ProjectArea, ProjectEntry, ProjectKind, ProjectPhase, ProjectStatus,
  TableColumn, TableSettings,
} from './types'

// ── Labels ──────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<ProjectKind, string> = {
  hardware: 'Hardware', software: 'Software', home: 'Home', learning: 'Learning', trip: 'Trip', blank: 'Other',
}
export const AREA_LABEL: Record<ProjectArea, string> = { personal: 'Personal', work: 'Work' }
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active', on_hold: 'On hold', completed: 'Done', archived: 'Archived',
}
export const STATUS_ORDER: readonly ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived']
export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  table: 'Table', log: 'Log', decisions: 'Questions and decisions', pages: 'Text pages', links: 'Links',
}
/** What each kind of block holds — the Add block menu's second line. */
export const BLOCK_KIND_HINT: Record<BlockKind, string> = {
  table: 'Rows with your own columns: parts, materials, a budget, a reading list',
  log: 'Dated entries, newest first',
  decisions: 'Open questions, and what you decided and why',
  pages: 'Guides and notes with headings, lists and code',
  links: 'Sources, documents and photo albums',
}
export const BLOCK_KINDS: readonly BlockKind[] = ['table', 'log', 'decisions', 'pages', 'links']
export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: 'Text', number: 'Number', money: 'Money', date: 'Date', link: 'Link', status: 'Choice', check: 'Tick box',
}
export const COLUMN_TYPES: readonly ColumnType[] = ['text', 'number', 'money', 'date', 'link', 'status', 'check']

// ── Templates ───────────────────────────────────────────────────────────────

export interface BlockSpec {
  kind:      BlockKind
  title:     string
  settings?: TableSettings
}

export interface ProjectTemplate {
  kind:    ProjectKind
  label:   string
  /** The blocks it starts with, as the New project sheet lists them. */
  summary: string
  phases:  readonly string[]
  blocks:  readonly BlockSpec[]
}

const col = (key: string, label: string, type: ColumnType, options?: string[]): TableColumn =>
  (options ? { key, label, type, options } : { key, label, type })
const LOG: BlockSpec = { kind: 'log', title: 'Log' }
const DECISIONS: BlockSpec = { kind: 'decisions', title: 'Questions and decisions' }
const LINKS: BlockSpec = { kind: 'links', title: 'Links' }

export const TEMPLATES: readonly ProjectTemplate[] = [
  {
    kind: 'hardware', label: 'Hardware', summary: 'Plan · Parts · Log · Decisions · Guides · Links',
    phases: ['Parts and plan', 'Bench test', 'Build', 'Use and improve'],
    blocks: [
      { kind: 'table', title: 'Parts', settings: {
        columns: [col('part', 'Part', 'text'), col('qty', 'Qty', 'number'), col('role', 'Role', 'text'),
          col('state', 'Status', 'status', ['In hand', 'To buy', 'Ordered']), col('price', 'Price', 'money'), col('group', 'Group', 'text')],
        groupBy: 'group', currency: 'NOK' } },
      LOG, DECISIONS, { kind: 'pages', title: 'Guides' }, LINKS,
    ],
  },
  {
    kind: 'software', label: 'Software', summary: 'Plan · Bugs · Log · Decisions · Docs · Links',
    phases: ['Design', 'Build', 'Test', 'Release'],
    blocks: [
      { kind: 'table', title: 'Bugs', settings: {
        columns: [col('bug', 'Bug', 'text'), col('severity', 'Severity', 'status', ['Low', 'Medium', 'High']),
          col('state', 'Status', 'status', ['Open', 'Fixed'])] } },
      LOG, DECISIONS, { kind: 'pages', title: 'Docs' }, LINKS,
    ],
  },
  {
    kind: 'home', label: 'Home', summary: 'Plan · Materials and budget · Log · Links and photos',
    phases: ['Plan', 'Buy materials', 'Do the work', 'Finish'],
    blocks: [
      { kind: 'table', title: 'Materials and budget', settings: {
        columns: [col('item', 'Item', 'text'), col('qty', 'Qty', 'number'), col('price', 'Price', 'money'),
          col('state', 'Status', 'status', ['To buy', 'Bought']), col('shop', 'Shop link', 'link')],
        currency: 'NOK' } },
      LOG, { kind: 'links', title: 'Links and photos' },
    ],
  },
  {
    kind: 'learning', label: 'Learning', summary: 'Plan · Resources · Notes · Log',
    phases: ['Start', 'Practice', 'Finish'],
    blocks: [
      { kind: 'table', title: 'Resources', settings: {
        columns: [col('title', 'Title', 'text'), col('type', 'Type', 'status', ['Book', 'Course', 'Video', 'Article']),
          col('link', 'Link', 'link'), col('state', 'Status', 'status', ['To do', 'Doing', 'Done'])] } },
      { kind: 'pages', title: 'Notes' }, LOG,
    ],
  },
  {
    kind: 'trip', label: 'Trip', summary: 'Plan · Checklist · Budget · Bookings · Links',
    phases: ['Plan', 'Book', 'Pack', 'Travel'],
    blocks: [
      { kind: 'table', title: 'Checklist', settings: { columns: [col('item', 'Item', 'text'), col('packed', 'Packed', 'check')] } },
      { kind: 'table', title: 'Budget', settings: {
        columns: [col('item', 'Item', 'text'), col('cost', 'Cost', 'money'), col('paid', 'Paid', 'check')], currency: 'NOK' } },
      { kind: 'table', title: 'Bookings', settings: {
        columns: [col('what', 'What', 'text'), col('date', 'Date', 'date'), col('ref', 'Confirmation', 'text'), col('link', 'Link', 'link')] } },
      LINKS,
    ],
  },
  { kind: 'blank', label: 'Blank', summary: 'Add the phases and blocks yourself', phases: [], blocks: [] },
]

export function templateFor(kind: ProjectKind): ProjectTemplate {
  return TEMPLATES.find(t => t.kind === kind) ?? TEMPLATES[TEMPLATES.length - 1]
}

/** A new table block's start: one text column. */
export function defaultTableSettings(): TableSettings {
  return { columns: [col('name', 'Name', 'text')] }
}

// ── A table block's settings (from the database: checked here) ─────────────

const KEY_RE = /^[a-z0-9_]{1,40}$/

/** A block's settings as a table, whatever the database holds: unknown types,
 *  blank labels, repeated keys and a groupBy that names no column are dropped. */
export function tableSettings(raw: unknown): TableSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const seen = new Set<string>()
  const columns: TableColumn[] = []
  for (const c of Array.isArray(obj.columns) ? obj.columns : []) {
    if (!c || typeof c !== 'object') continue
    const { key, label, type, options } = c as Record<string, unknown>
    if (typeof key !== 'string' || !KEY_RE.test(key) || seen.has(key)) continue
    if (typeof type !== 'string' || !(COLUMN_TYPES as readonly string[]).includes(type)) continue
    const name = typeof label === 'string' ? label.trim().slice(0, 40) : ''
    if (!name) continue
    seen.add(key)
    const column: TableColumn = { key, label: name, type: type as ColumnType }
    if (type === 'status') column.options = cleanOptions(options)
    columns.push(column)
  }
  const groupBy = typeof obj.groupBy === 'string' && columns.some(c => c.key === obj.groupBy) ? obj.groupBy : null
  const currency = typeof obj.currency === 'string' && /^[A-Z]{3}$/.test(obj.currency) ? obj.currency : 'NOK'
  return { columns, groupBy, currency }
}

/** A status column's choices: trimmed, unique, at most 20 of 40 characters. */
export function cleanOptions(raw: unknown): string[] {
  const out: string[] = []
  for (const o of Array.isArray(raw) ? raw : []) {
    const s = typeof o === 'string' ? o.trim().slice(0, 40) : ''
    if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length === 20) break
  }
  return out
}

/** A key for a new column from its label, unique among `columns`. */
export function newColumnKey(columns: readonly Pick<TableColumn, 'key'>[], label: string): string {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'col'
  let key = base
  for (let i = 2; columns.some(c => c.key === key); i++) key = `${base}_${i}`
  return key
}

/** The column that names a row: the first text column (else the first). */
export function titleColumn(settings: TableSettings): TableColumn | null {
  return settings.columns.find(c => c.type === 'text') ?? settings.columns[0] ?? null
}

/** The first choice column — its choices split the table ("In hand · To buy"). */
export function statusColumn(settings: TableSettings): TableColumn | null {
  return settings.columns.find(c => c.type === 'status' && (c.options?.length ?? 0) > 0) ?? null
}

// ── Cells ───────────────────────────────────────────────────────────────────

/** "github.com/x/kitchen-scale" for a link: no scheme, no www, no trailing slash. */
export function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

/** A cell as text ('' for empty). */
export function cellText(column: Pick<TableColumn, 'type'>, value: unknown, currency = 'NOK'): string {
  if (value == null || value === '') return ''
  switch (column.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
    case 'money':  return typeof value === 'number' && Number.isFinite(value) ? formatMoney(value, currency) : ''
    case 'date':   return typeof value === 'string' ? formatDate(value) : ''
    case 'link':   return typeof value === 'string' ? linkLabel(value) : ''
    case 'check':  return value === true ? 'Yes' : ''
    default:       return typeof value === 'string' ? value : String(value)
  }
}

export type CellResult = { ok: true; value: string | number | boolean | null } | { ok: false; error: string }

/** What a typed cell stores. Numbers take a comma or a point and spaces ("1 234,50"). */
export function parseCell(column: TableColumn, input: string | boolean): CellResult {
  if (column.type === 'check') return { ok: true, value: input === true || input === 'true' }
  const s = typeof input === 'string' ? input.trim() : ''
  if (!s) return { ok: true, value: null }
  switch (column.type) {
    case 'number':
    case 'money': {
      const n = Number(s.replace(/\s/g, '').replace(',', '.'))
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { ok: false, error: `${column.label} must be a number` }
      return { ok: true, value: Math.round(n * 100) / 100 }
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { ok: true, value: s } : { ok: false, error: `${column.label} must be a date` }
    case 'link': {
      const url = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) ? `https://${s}` : null
      if (!url || /\s/.test(url) || url.length > 2000) return { ok: false, error: `${column.label} must be a web address` }
      return { ok: true, value: url }
    }
    case 'status':
      return column.options?.includes(s) ? { ok: true, value: s } : { ok: false, error: `${column.label}: pick one of the choices` }
    default:
      return { ok: true, value: s.slice(0, 500) }
  }
}

/** A row's name: its title column's text, else "Untitled". */
export function rowTitle(settings: TableSettings, data: Record<string, unknown>): string {
  const c = titleColumn(settings)
  const text = c ? cellText(c, data[c.key], settings.currency) : ''
  return text || 'Untitled'
}

export interface RowGroup<T> { group: string | null; rows: T[] }

/** Rows grouped by the settings' groupBy column, groups in the order they first appear; no groupBy → one group. */
export function groupRows<T extends { data: Record<string, unknown> }>(rows: readonly T[], settings: TableSettings): RowGroup<T>[] {
  const key = settings.groupBy
  if (!key) return [{ group: null, rows: [...rows] }]
  const groups: RowGroup<T>[] = []
  for (const row of rows) {
    const raw = row.data[key]
    const name = typeof raw === 'string' && raw.trim() ? raw.trim() : null
    let g = groups.find(x => x.group === name)
    if (!g) { g = { group: name, rows: [] }; groups.push(g) }
    g.rows.push(row)
  }
  // Rows with no group go last.
  return [...groups.filter(g => g.group !== null), ...groups.filter(g => g.group === null)]
}

/** How many rows hold each choice of a status column, in the column's order (empty choices kept). */
export function statusCounts(rows: readonly { data: Record<string, unknown> }[], column: TableColumn): Array<{ option: string; count: number }> {
  return (column.options ?? []).map(option => ({ option, count: rows.filter(r => r.data[column.key] === option).length }))
}

/** Each money column's sum over the rows (columns with no amount left out). */
export function moneyTotals(rows: readonly { data: Record<string, unknown> }[], settings: TableSettings): Array<{ column: TableColumn; total: number }> {
  return settings.columns
    .filter(c => c.type === 'money')
    .map(column => ({
      column,
      total: rows.reduce((sum, r) => {
        const v = r.data[column.key]
        return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      }, 0),
      any: rows.some(r => typeof r.data[column.key] === 'number'),
    }))
    .filter(t => t.any)
    .map(({ column, total }) => ({ column, total: Math.round(total * 100) / 100 }))
}

// ── Entries ─────────────────────────────────────────────────────────────────

type EntryOrder = Pick<ProjectEntry, 'entry_date' | 'state' | 'sort_order' | 'created_at' | 'id'>

const bySortThenCreated = (a: EntryOrder, b: EntryOrder) =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
const byDateDesc = (a: EntryOrder, b: EntryOrder) =>
  (b.entry_date ?? '').localeCompare(a.entry_date ?? '') || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)

/** A block's entries in the order it shows them: a log newest first;
 *  questions before decisions, decisions newest first; the rest in their own order. */
export function orderEntries<T extends EntryOrder>(kind: BlockKind, entries: readonly T[]): T[] {
  const list = [...entries]
  if (kind === 'log') return list.sort(byDateDesc)
  if (kind === 'decisions') {
    return [
      ...list.filter(e => e.state !== 'decided').sort(bySortThenCreated),
      ...list.filter(e => e.state === 'decided').sort(byDateDesc),
    ]
  }
  return list.sort(bySortThenCreated)
}

export function isOpenQuestion(e: Pick<ProjectEntry, 'state'>): boolean {
  return e.state === 'open'
}

/** The sort order for something added at the end. */
export function nextSortOrder(items: readonly { sort_order: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1
}

type SortKeys = { id: string; sort_order: number; created_at: string }

const bySortOrder = (a: SortKeys, b: SortKeys) =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/** Phases and blocks in the order they show: their sort order, then the older first. */
export function inSortOrder<T extends SortKeys>(items: readonly T[]): T[] {
  return [...items].sort(bySortOrder)
}

export interface MovePlan<T> {
  moved: T
  writes: Array<{ id: string; sort_order: number }>
}

/** What moving `id` one place up or down in the order shown writes (null at an end).
 *  Two different sort orders swap. When two items share one (a row added with the
 *  default 0), the list is numbered 0, 1, 2… in its new order, writing only what changes. */
export function movePlan<T extends SortKeys>(items: readonly T[], id: string, dir: -1 | 1): MovePlan<T> | null {
  const shown = inSortOrder(items)
  const i = shown.findIndex(x => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= shown.length) return null
  const [a, b] = [shown[i], shown[j]]
  if (new Set(shown.map(x => x.sort_order)).size === shown.length) {
    return { moved: a, writes: [{ id: a.id, sort_order: b.sort_order }, { id: b.id, sort_order: a.sort_order }] }
  }
  const next = [...shown]
  next[i] = b
  next[j] = a
  return {
    moved: a,
    writes: next.flatMap((x, k) => (x.sort_order === k ? [] : [{ id: x.id, sort_order: k }])),
  }
}

/** A new decision from a question: answered today unless it already has a day. */
export function decide(entry: Pick<ProjectEntry, 'entry_date'>, today: string): { state: EntryState; entry_date: string } {
  return { state: 'decided', entry_date: entry.entry_date ?? today }
}

// ── A project's numbers ─────────────────────────────────────────────────────

export interface TaskLike {
  id:                string
  title:             string
  status:            TaskStatus
  sort_order:        number
  created_at:        string
  project_id?:       string | null
  project_phase_id?: string | null
}

const taskOrder = (a: TaskLike, b: TaskLike) =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/** Phases in their order. */
export function orderPhases<T extends Pick<ProjectPhase, 'sort_order' | 'created_at' | 'id'>>(phases: readonly T[]): T[] {
  return inSortOrder(phases)
}

/** A phase's tasks (null = the tasks in no phase) in their order. */
export function phaseTasks<T extends TaskLike>(tasks: readonly T[], phaseId: string | null): T[] {
  return tasks.filter(t => (t.project_phase_id ?? null) === phaseId).sort(taskOrder)
}

export interface ProjectSummary<T extends TaskLike = TaskLike> {
  phasesDone:    number
  phasesTotal:   number
  /** The first phase not done (null when there are none, or all are done). */
  current:       Pick<ProjectPhase, 'id' | 'name'> | null
  /** 1-based place of `current` among the phases (0 when none). */
  currentIndex:  number
  tasksDone:     number
  /** Tasks that count: every task but a cancelled one. */
  tasksTotal:    number
  /** The first open task of the current phase, else of the earliest phase that has one, else one in no phase. */
  nextTask:      T | null
  openQuestions: number
}

export function projectSummary<T extends TaskLike>(
  phases: readonly Pick<ProjectPhase, 'id' | 'name' | 'status' | 'sort_order' | 'created_at'>[],
  tasks: readonly T[],
  openQuestions = 0,
): ProjectSummary<T> {
  const ordered = orderPhases(phases)
  const currentAt = ordered.findIndex(p => p.status !== 'done')
  const current = currentAt >= 0 ? ordered[currentAt] : null
  const counted = tasks.filter(t => t.status !== 'cancelled')
  const open = tasks.filter(t => isOpenTask(t))
  const firstOpenIn = (phaseId: string | null) => phaseTasks(open, phaseId)[0] ?? null
  let nextTask: T | null = current ? firstOpenIn(current.id) : null
  for (const p of ordered) {
    if (nextTask) break
    nextTask = firstOpenIn(p.id)
  }
  if (!nextTask) nextTask = firstOpenIn(null) ?? open.sort(taskOrder)[0] ?? null
  return {
    phasesDone: ordered.filter(p => p.status === 'done').length,
    phasesTotal: ordered.length,
    current: current ? { id: current.id, name: current.name } : null,
    currentIndex: current ? currentAt + 1 : 0,
    tasksDone: counted.filter(t => t.status === 'done').length,
    tasksTotal: counted.length,
    nextTask,
    openQuestions,
  }
}

/** The project card's progress line: "Phase 2 of 4 · Build", "All 4 phases done", "3 of 8 tasks done". */
export function progressLine(s: ProjectSummary): string {
  if (s.phasesTotal > 0) {
    if (!s.current) return `All ${s.phasesTotal} phase${s.phasesTotal === 1 ? '' : 's'} done`
    return `Phase ${s.currentIndex} of ${s.phasesTotal} · ${s.current.name}`
  }
  if (s.tasksTotal > 0) return `${s.tasksDone} of ${s.tasksTotal} tasks done`
  return 'No phases yet'
}

/** 0–1: phases done when there are phases, else tasks done. */
export function progressValue(s: ProjectSummary): number {
  if (s.phasesTotal > 0) return s.phasesDone / s.phasesTotal
  return s.tasksTotal > 0 ? s.tasksDone / s.tasksTotal : 0
}

// ── The projects list ──────────────────────────────────────────────────────

export type AreaFilter = 'all' | ProjectArea

/** The list: one status, one area (or all), in the owner's order. */
export function filterProjects<T extends { status: ProjectStatus; area?: ProjectArea; sort_order: number; created_at: string; id: string }>(
  projects: readonly T[], status: ProjectStatus, area: AreaFilter,
): T[] {
  return projects
    .filter(p => p.status === status && (area === 'all' || (p.area ?? 'personal') === area))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

/** How many projects each status holds (for the tabs' counts), within an area. */
export function statusTally(projects: readonly { status: ProjectStatus; area?: ProjectArea }[], area: AreaFilter): Record<ProjectStatus, number> {
  const out: Record<ProjectStatus, number> = { active: 0, on_hold: 0, completed: 0, archived: 0 }
  for (const p of projects) if (area === 'all' || (p.area ?? 'personal') === area) out[p.status]++
  return out
}
