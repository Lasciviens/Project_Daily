// Pure rules for the requests backlog: draft shapes and their validation when
// read back from localStorage, and the drag-reorder plan. Import-free (type
// imports only) so scripts/verify-dev-request-context.cjs can require it.
import type { PageContext } from './devRequestContext'
import type { DevRequest, DevRequestCategory, DevRequestEffort, DevRequestPriority } from './types'
import { formatDateTime } from '../../shared/utils/dateFormat'

export const CATEGORIES: readonly DevRequestCategory[] = ['bug', 'feature', 'improvement', 'integration', 'longterm', 'question', 'other']
export const PRIORITIES: readonly DevRequestPriority[] = ['low', 'medium', 'high', 'urgent']
export const EFFORTS: readonly DevRequestEffort[] = ['small', 'medium', 'large']

/** The editable fields of one request, as a form holds them. */
export interface DraftFields {
  title: string
  description: string
  page: string
  category: DevRequestCategory
  priority: DevRequestPriority
  effort: DevRequestEffort | ''
}

export interface NewDraft extends DraftFields {
  /** The page the draft was started on — what the request is about. */
  start: PageContext | null
  /** Append the automatic page context on save. */
  attachContext: boolean
  /** Date.now() of the last change the user made (0 = never). Decides which tab's copy wins. */
  touchedAt: number
}

export interface EditDraft extends DraftFields {
  /** The row's updated_at when editing began (the draft was made against it). */
  baseUpdatedAt: string
  /** Date.now() of the last change (0 for a seed built from the saved row). */
  touchedAt: number
}

export type ComposerTarget = { kind: 'new' } | { kind: 'edit'; id: string }
export type ComposerTab = 'request' | 'prompt'
export type SortMode = 'manual' | 'priority'

export interface ComposerState {
  open: boolean
  minimized: boolean
  tab: ComposerTab
  target: ComposerTarget
  /** Window position on tablet/desktop; null = the default corner. */
  pos: { x: number; y: number } | null
}

export interface DrawerPrefs {
  categories: DevRequestCategory[]
  sortMode: SortMode
  showDone: boolean
  /** Requests ticked in the list (their status circles): the action bar acts on them. */
  picked: string[]
}

export interface PromptState {
  ids: string[]
  text: string
  edited: boolean
  touchedAt: number
}

export interface PersistedDraftState {
  newDraft: NewDraft
  editDrafts: Record<string, EditDraft>
  /** When an edit draft was saved, discarded or pruned (id → Date.now()), so another tab's older copy can't bring it back. */
  clearedEdits: Record<string, number>
  composer: ComposerState
  drawer: DrawerPrefs
  prompt: PromptState
}

export const EMPTY_FIELDS: DraftFields = { title: '', description: '', page: 'other', category: 'feature', priority: 'medium', effort: '' }

export const DEFAULT_STATE: PersistedDraftState = {
  newDraft: { ...EMPTY_FIELDS, start: null, attachContext: true, touchedAt: 0 },
  editDrafts: {},
  clearedEdits: {},
  composer: { open: false, minimized: false, tab: 'request', target: { kind: 'new' }, pos: null },
  drawer: { categories: [], sortMode: 'manual', showDone: false, picked: [] },
  prompt: { ids: [], text: '', edited: false, touchedAt: 0 },
}

/** How many unsaved edits are kept (the most recently touched win). */
export const MAX_EDIT_DRAFTS = 50
const MAX_CLEARED = 200

/** The saved row as an edit draft's starting point. */
export function draftFromRow(row: Pick<DevRequest, 'title' | 'description' | 'page' | 'category' | 'priority' | 'effort' | 'updated_at'>): EditDraft {
  return {
    title: row.title,
    description: row.description ?? '',
    page: row.page || 'other',
    category: row.category,
    priority: row.priority,
    effort: row.effort ?? '',
    baseUpdatedAt: row.updated_at,
    touchedAt: 0,
  }
}

/** True when a draft holds nothing the user typed. */
export function isDraftEmpty(d: Pick<DraftFields, 'title' | 'description'>): boolean {
  return !d.title.trim() && !d.description.trim()
}

/** True when two field sets would save the same row (whitespace at the ends ignored). */
export function sameFields(a: DraftFields, b: DraftFields): boolean {
  return a.title.trim() === b.title.trim()
    && a.description.trim() === b.description.trim()
    && a.page === b.page && a.category === b.category && a.priority === b.priority && a.effort === b.effort
}

// ── Reading localStorage back ─────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback: string, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : fallback)
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function fields(v: Record<string, unknown>): DraftFields {
  return {
    title: str(v.title, ''),
    description: str(v.description, ''),
    page: str(v.page, 'other', 200) || 'other',
    category: oneOf(v.category, CATEGORIES, 'feature'),
    priority: oneOf(v.priority, PRIORITIES, 'medium'),
    effort: EFFORTS.includes(v.effort as DevRequestEffort) ? (v.effort as DevRequestEffort) : '',
  }
}

function pageContext(v: unknown): PageContext | null {
  if (!isObj(v) || typeof v.route !== 'string') return null
  const vp = isObj(v.viewport) ? v.viewport : {}
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((t): t is string => typeof t === 'string').slice(0, 8) : [])
  return {
    route: v.route.slice(0, 400),
    pageTitle: str(v.pageTitle, '', 80),
    heading: typeof v.heading === 'string' ? v.heading.slice(0, 200) : null,
    viewport: { w: finite(vp.w) ? vp.w : 0, h: finite(vp.h) ? vp.h : 0 },
    breakpoint: str(v.breakpoint, '', 20),
    theme: v.theme === 'dark' ? 'dark' : 'light',
    tabs: list(v.tabs),
    popups: list(v.popups),
    build: typeof v.build === 'string' ? v.build.slice(0, 120) : null,
    at: typeof v.at === 'string' ? v.at : null,
  }
}

const ids = (v: unknown, max = 200) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 100))].slice(0, max) : [])

/**
 * Rebuilds a valid state from whatever localStorage held (an older shape, a
 * hand edit, a truncated write). Anything unusable falls back to the default,
 * field by field — one bad value never costs the rest of a draft.
 */
export function sanitizeDraftState(raw: unknown): PersistedDraftState {
  const d = DEFAULT_STATE
  if (!isObj(raw)) return structuredCopy(d)
  const nd = isObj(raw.newDraft) ? raw.newDraft : {}
  const edits: Record<string, EditDraft> = {}
  if (isObj(raw.editDrafts)) {
    // The most recently touched ones when there are too many (entry order is
    // the order they were first created, not how fresh they are).
    const valid = Object.entries(raw.editDrafts)
      .filter((e): e is [string, Record<string, unknown>] => !!e[0] && isObj(e[1]))
      .map(([id, v]) => [id, { ...fields(v), baseUpdatedAt: str(v.baseUpdatedAt, '', 60), touchedAt: stamp(v.touchedAt) }] as const)
    for (const [id, d] of newest(valid, MAX_EDIT_DRAFTS, ([, d]) => d.touchedAt)) edits[id] = d
  }
  const cleared: Record<string, number> = {}
  if (isObj(raw.clearedEdits)) {
    const valid = Object.entries(raw.clearedEdits).filter((e): e is [string, number] => !!e[0] && e[0].length < 100 && finite(e[1]) && e[1] > 0)
    for (const [id, t] of newest(valid, MAX_CLEARED, ([, t]) => t)) cleared[id] = t
  }
  const c = isObj(raw.composer) ? raw.composer : {}
  const target = isObj(c.target) && c.target.kind === 'edit' && typeof c.target.id === 'string' && c.target.id
    ? { kind: 'edit' as const, id: c.target.id }
    : { kind: 'new' as const }
  const pos = isObj(c.pos) && finite(c.pos.x) && finite(c.pos.y) ? { x: c.pos.x, y: c.pos.y } : null
  const dr = isObj(raw.drawer) ? raw.drawer : {}
  const p = isObj(raw.prompt) ? raw.prompt : {}
  const categories = Array.isArray(dr.categories) ? [...new Set(dr.categories.filter((x): x is DevRequestCategory => CATEGORIES.includes(x as DevRequestCategory)))] : []
  return {
    newDraft: { ...fields(nd), start: pageContext(nd.start), attachContext: bool(nd.attachContext, true), touchedAt: stamp(nd.touchedAt) },
    editDrafts: edits,
    clearedEdits: cleared,
    composer: {
      open: bool(c.open, false),
      minimized: bool(c.minimized, false),
      tab: oneOf(c.tab, ['request', 'prompt'] as const, 'request'),
      target,
      pos,
    },
    drawer: {
      categories,
      sortMode: oneOf(dr.sortMode, ['manual', 'priority'] as const, 'manual'),
      showDone: bool(dr.showDone, false),
      picked: ids(dr.picked),
    },
    prompt: { ids: ids(p.ids), text: str(p.text, '', 100000), edited: bool(p.edited, false), touchedAt: stamp(p.touchedAt) },
  }
}

const stamp = (v: unknown) => (finite(v) && v > 0 ? v : 0)

/** The `max` entries with the largest `key`, in their original order. */
function newest<T>(list: readonly T[], max: number, key: (x: T) => number): T[] {
  if (list.length <= max) return [...list]
  const keep = new Set([...list].sort((a, b) => key(b) - key(a)).slice(0, max))
  return list.filter(x => keep.has(x))
}

// ── Two tabs, one draft ───────────────────────────────────────────────────────

/** The parts of the state that hold what the user typed (the rest is per-tab UI). */
export type DraftContent = Pick<PersistedDraftState, 'newDraft' | 'editDrafts' | 'clearedEdits' | 'prompt'>

/**
 * Combines this tab's drafts with what another tab just wrote. Per draft the
 * later change wins — typing, a reset after a save, or a clear — so a tab that
 * was loaded earlier can never write its older copy over newer text. Ties keep
 * `local`. Returns `local` itself (same reference) when nothing changes.
 */
export function mergeDraftContent(local: DraftContent, incoming: DraftContent): DraftContent {
  const newDraft = incoming.newDraft.touchedAt > local.newDraft.touchedAt ? incoming.newDraft : local.newDraft
  const prompt = incoming.prompt.touchedAt > local.prompt.touchedAt ? incoming.prompt : local.prompt
  const editDrafts: Record<string, EditDraft> = {}
  const clearedEdits: Record<string, number> = {}
  const allIds = new Set([
    ...Object.keys(local.editDrafts), ...Object.keys(incoming.editDrafts),
    ...Object.keys(local.clearedEdits), ...Object.keys(incoming.clearedEdits),
  ])
  for (const id of allIds) {
    const a = local.editDrafts[id]
    const b = incoming.editDrafts[id]
    const draft = a && b ? (b.touchedAt > a.touchedAt ? b : a) : a ?? b
    const cleared = Math.max(local.clearedEdits[id] ?? 0, incoming.clearedEdits[id] ?? 0)
    // A draft from before the change stamps (touchedAt 0) survives unless cleared.
    if (draft && (cleared === 0 || draft.touchedAt > cleared)) editDrafts[id] = draft
    else if (cleared > 0) clearedEdits[id] = cleared
  }
  const merged = { newDraft, prompt, editDrafts, clearedEdits }
  return sameDraftContent(merged, local) ? local : merged
}

/** True when two states hold the same drafts (compared by their change stamps). */
export function sameDraftContent(a: DraftContent, b: DraftContent): boolean {
  const sameMap = <T>(x: Record<string, T>, y: Record<string, T>, v: (t: T) => unknown) => {
    const kx = Object.keys(x)
    return kx.length === Object.keys(y).length && kx.every(k => k in y && v(x[k]) === v(y[k]))
  }
  return a.newDraft.touchedAt === b.newDraft.touchedAt
    && a.prompt.touchedAt === b.prompt.touchedAt
    && sameMap(a.editDrafts, b.editDrafts, d => d.touchedAt)
    && sameMap(a.clearedEdits, b.clearedEdits, t => t)
}

/**
 * Edit drafts whose request is gone (deleted here or on another device).
 * Only drafts last touched before the list was fetched count: a newer draft
 * may belong to a request created after that fetch.
 */
export function orphanEditDrafts(editDrafts: Record<string, EditDraft>, existingIds: readonly string[], listFetchedAt: number): string[] {
  const exists = new Set(existingIds)
  return Object.entries(editDrafts).filter(([id, d]) => !exists.has(id) && d.touchedAt < listFetchedAt).map(([id]) => id)
}

function structuredCopy(s: PersistedDraftState): PersistedDraftState {
  return JSON.parse(JSON.stringify(s)) as PersistedDraftState
}

// ── Drag reorder ──────────────────────────────────────────────────────────────

/**
 * A drag reorders only the rows on screen (open, filtered), but sort_order is
 * one sequence over every row. The moved rows keep the slots they held in the
 * full list, filled in their new order; every other row keeps its place. The
 * whole list is then numbered 0..n-1 and only rows whose number changed are
 * returned, so hidden rows neither vanish from the cache nor collide.
 *
 * `all` is the full list in its current display order.
 */
export function planReorder(all: readonly { id: string; sort_order: number }[], visibleNewOrder: readonly string[]): { id: string; sort_order: number }[] {
  const moved = new Set(visibleNewOrder)
  const queue = visibleNewOrder.filter(id => all.some(r => r.id === id))
  const order = all.map(r => (moved.has(r.id) ? queue.shift() ?? r.id : r.id))
  const changes: { id: string; sort_order: number }[] = []
  order.forEach((id, i) => {
    const row = all.find(r => r.id === id)
    if (row && row.sort_order !== i) changes.push({ id, sort_order: i })
  })
  return changes
}

/** Applies sort_order changes and returns the list in its new order (ties keep their order). */
export function applyReorder<T extends { id: string; sort_order: number }>(all: readonly T[], changes: readonly { id: string; sort_order: number }[]): T[] {
  const next = new Map(changes.map(c => [c.id, c.sort_order]))
  return all
    .map((r, i) => ({ r: next.has(r.id) ? { ...r, sort_order: next.get(r.id)! } : r, i }))
    .sort((a, b) => a.r.sort_order - b.r.sort_order || a.i - b.i)
    .map(x => x.r)
}

/** A new request goes on top: one below the smallest sort_order in use. */
export function topSortOrder(all: readonly { sort_order: number }[]): number {
  return all.length ? Math.min(...all.map(r => r.sort_order)) - 1 : 0
}

// ── Cards ─────────────────────────────────────────────────────────────────────


/** `29.09.2026 14:05` in local time; '' for a missing/bad value. */
export function cardStamp(iso: string | null | undefined): string {
  return formatDateTime(iso)
}

/** `Added 29.09.2026 14:05 · Done 30.09.2026 09:12` (Done only for a done request that has its stamp). */
export function cardTimeline(row: Pick<DevRequest, 'created_at' | 'status' | 'completed_at'>): string {
  const parts: string[] = []
  const added = cardStamp(row.created_at)
  if (added) parts.push(`Added ${added}`)
  const done = row.status === 'done' ? cardStamp(row.completed_at) : ''
  if (done) parts.push(`Done ${done}`)
  return parts.join(' · ')
}

/** A prompt was built for it and it is still open: check the work and close it. */
export function awaitingCheck(row: Pick<DevRequest, 'status' | 'prompted_at'>): boolean {
  return !!row.prompted_at && (row.status === 'open' || row.status === 'in_progress')
}
