// Pure: a request's description as three parts —
//   body         the user's own words: the numbered outline the request
//                window edits (outline.ts — points, sub-points)
//   checkpoints  older "- [ ] …" lines (folded into points on edit/save)
//   marks        where on the app the request points: one line per pick
//                (`[[pick {json}]]`) and one for the page it was written on
//                (`[[page {json}]]`)
//   reviews      after a prompt: Fixed / Not fixed / Moved per point
//                (`[[review {json}]]`, keyed by the point's words — points.ts)
//   recheck      on a re-check request: which request it re-asks
//                (`[[recheck {json}]]`)
// A mark is machine-readable (route + query, tabs, popup, the component and
// file from the data-src stamps, the element's label and text), so the
// prompt for Claude gets every detail while the user sees one friendly line
// ("Training › Program tab › Current program card — “Missed sessions”") with
// a Go there button. Still plain text in `description`: no migration.
// Older requests carry plain-text blocks ("[Picked on …]", "[Page context]");
// they are read as legacy marks and kept verbatim.
// Pure (imports only other pure modules) so the verify script can require it.

import {
  BLOCK_HEADER_RE, cleanText, formatCapture, formatPageContext, summarizeSources, whereParts,
  type Capture, type CapturedPopup, type PageContext, type PickedElement,
} from './devRequestContext'
import { checkpointLine, parseCheckpointLine, type Checkpoint } from './checkpoints'
import { pointKeys, splitPoints, upgradeReviewKeys } from './pointText'
import { insertIntoOutline, parseOutline, serializeOutline, type Caret } from './outline'

/**
 * A picked spot. A pick with an `id` is linked from the text: the body holds
 * `[[@id]]` where the user sees a link named `label` ("Water card"); older
 * picks have no id and show as a row under the text.
 */
export interface PickMark { type: 'pick'; capture: Capture; id?: string; label?: string }
export interface PageMark { type: 'page'; start: PageContext; savedOn: PageContext | null }
/** A plain-text block from before marks; `raw` is kept exactly. */
export interface LegacyMark { type: 'legacy'; raw: string; kind: 'pick' | 'page'; pageTitle: string; route: string | null; what: string | null }
export type Mark = PickMark | PageMark | LegacyMark

/** How a point fared after it was sent to Claude (points.ts owns the keys). */
export type ReviewState = 'fixed' | 'not_fixed' | 'moved'
export interface PointReview {
  /** The point's key: a hash of its words (pointText.ts). */
  key: string
  state: ReviewState
  /** Not fixed: what is still wrong. */
  note?: string
  /** Moved: the re-check request it went to. */
  to?: string
  at?: string
}
/** A re-check request: the request it re-asks, and the points already collected from it. */
export interface RecheckOf { of: string; title: string; keys: string[] }

export interface ParsedDescription {
  body: string
  /** Older "- [ ]" lines (before points were automatic). */
  checkpoints: Checkpoint[]
  marks: Mark[]
  reviews: PointReview[]
  recheck: RecheckOf | null
}
/** What compose takes: reviews and recheck may be left out. */
export type DescriptionParts = Omit<ParsedDescription, 'reviews' | 'recheck'> & Partial<Pick<ParsedDescription, 'reviews' | 'recheck'>>

const MARK_RE = /^\[\[(pick|page) (\{.*\})\]\]$/
const META_RE = /^\[\[(review|recheck) (\{.*\})\]\]$/
const REVIEW_STATES: readonly ReviewState[] = ['fixed', 'not_fixed', 'moved']
const REF_ID_RE = /^[a-z0-9]{2,12}$/
/** A link in the text to a pick mark: `[[@id]]`. */
export const REF_RE = /\[\[@([a-z0-9]{2,12})\]\]/g
export const refToken = (id: string) => `[[@${id}]]`

// ── Encoding ─────────────────────────────────────────────────────────────────

export const encodePick = (capture: Capture, id?: string, label?: string): string =>
  `[[pick ${JSON.stringify(id ? { id, label, ...capture } : capture)}]]`

export const encodePage = (start: PageContext, savedOn?: PageContext | null): string =>
  `[[page ${JSON.stringify(savedOn && savedOn.route !== start.route ? { start, savedOn } : { start })}]]`

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A stored page context, with every field the formatters read made safe. */
function asPage(v: unknown): PageContext | null {
  if (!isObj(v) || typeof v.route !== 'string') return null
  const vp = isObj(v.viewport) ? v.viewport : {}
  return {
    route: v.route,
    pageTitle: typeof v.pageTitle === 'string' ? v.pageTitle : '',
    heading: typeof v.heading === 'string' ? v.heading : null,
    viewport: { w: Number(vp.w) || 0, h: Number(vp.h) || 0 },
    breakpoint: typeof v.breakpoint === 'string' ? v.breakpoint : '',
    theme: v.theme === 'dark' ? 'dark' : 'light',
    tabs: strs(v.tabs),
    popups: strs(v.popups),
    build: typeof v.build === 'string' ? v.build : null,
    at: typeof v.at === 'string' ? v.at : null,
  }
}

function asElement(v: unknown): PickedElement | null {
  if (!isObj(v) || typeof v.tag !== 'string') return null
  const s = (x: unknown) => (typeof x === 'string' ? x : null)
  const rect = isObj(v.rect) ? { x: Number(v.rect.x) || 0, y: Number(v.rect.y) || 0, w: Number(v.rect.w) || 0, h: Number(v.rect.h) || 0 } : undefined
  const data = Array.isArray(v.data)
    ? v.data.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string')
    : []
  return {
    tag: v.tag, role: s(v.role), name: s(v.name), text: s(v.text), value: s(v.value), area: s(v.area),
    trail: strs(v.trail), tabs: strs(v.tabs), data, rect, sources: strs(v.sources),
  }
}

function decodeMark(line: string): PickMark | PageMark | null {
  const m = MARK_RE.exec(line.trim())
  if (!m) return null
  let v: unknown
  try { v = JSON.parse(m[2]) } catch { return null }
  if (!isObj(v)) return null
  if (m[1] === 'page') {
    const start = asPage(v.start)
    return start ? { type: 'page', start, savedOn: asPage(v.savedOn) } : null
  }
  const page = asPage(v.page)
  if (!page) return null
  const id = typeof v.id === 'string' && REF_ID_RE.test(v.id) ? v.id : undefined
  return {
    type: 'pick',
    ...(id ? { id, label: typeof v.label === 'string' && v.label.trim() ? v.label : undefined } : {}),
    capture: {
      kind: v.kind === 'selection' ? 'selection' : 'element',
      page,
      element: asElement(v.element),
      quote: typeof v.quote === 'string' ? v.quote : null,
      ...(Array.isArray(v.popups) ? { popups: v.popups.flatMap(asPopup) } : {}),
    },
  }
}

type Meta = { type: 'review'; review: PointReview } | { type: 'recheck'; recheck: RecheckOf }

function decodeMeta(line: string): Meta | null {
  const m = META_RE.exec(line.trim())
  if (!m) return null
  let v: unknown
  try { v = JSON.parse(m[2]) } catch { return null }
  if (!isObj(v)) return null
  const s = (x: unknown) => (typeof x === 'string' && x ? x : undefined)
  if (m[1] === 'recheck') {
    return typeof v.of === 'string' ? { type: 'recheck', recheck: { of: v.of, title: typeof v.title === 'string' ? v.title : '', keys: strs(v.keys) } } : null
  }
  const state = REVIEW_STATES.find(x => x === v.s)
  if (typeof v.k !== 'string' || !v.k || !state) return null
  const review: PointReview = { key: v.k, state }
  const note = s(v.note), to = s(v.to), at = s(v.at)
  if (note) review.note = note
  if (to) review.to = to
  if (at) review.at = at
  return { type: 'review', review }
}

export const encodeReview = (r: PointReview): string =>
  `[[review ${JSON.stringify({ k: r.key, s: r.state, ...(r.note ? { note: r.note } : {}), ...(r.to ? { to: r.to } : {}), ...(r.at ? { at: r.at } : {}) })}]]`

export const encodeRecheck = (r: RecheckOf): string => `[[recheck ${JSON.stringify({ of: r.of, title: r.title, keys: r.keys })}]]`

function asPopup(v: unknown): CapturedPopup[] {
  if (!isObj(v)) return []
  const request = isObj(v.request) && typeof v.request.kind === 'string' ? v.request as CapturedPopup['request'] : null
  const opener = asElement(v.opener)
  return request || opener ? [{ request, opener }] : []
}

function legacyMark(raw: string): LegacyMark {
  const lines = raw.split('\n')
  const header = lines[0].trim()
  const kind = header.startsWith('[Picked') ? 'pick' : 'page'
  const place = kind === 'pick'
    ? /^\[Picked(?: text)? on (.*)\]$/.exec(header)?.[1] ?? ''
    : lines.find(l => l.startsWith('Page: '))?.slice(6) ?? ''
  const cut = place.lastIndexOf(' · ')
  const tail = cut >= 0 ? place.slice(cut + 3) : place
  const route = tail.startsWith('/') ? tail : null
  const pageTitle = route ? (cut >= 0 ? place.slice(0, cut) : '') : place
  const el = lines.find(l => l.startsWith('Element: ') || l.startsWith('Quote: '))
  const what = el ? cleanText(/"(.*)"/.exec(el)?.[1] ?? el.replace(/^(Element|Quote): /, ''), 60) || null : null
  return { type: 'legacy', raw, kind, pageTitle, route, what }
}

// ── Parse / compose ──────────────────────────────────────────────────────────

/**
 * Splits a description into body, checkpoints and marks. The body keeps its
 * exact text (trailing spaces and newlines included), so typing in the text
 * box never loses a keystroke: composeDescription(parseDescription(x)) is
 * stable, and the blank line compose puts before the sections is the only
 * thing taken off.
 */
export function parseDescription(text: string | null | undefined): ParsedDescription {
  const lines = (text ?? '').split('\n')
  const head: string[] = []
  const tail: string[] = []
  const checkpoints: Checkpoint[] = []
  const marks: Mark[] = []
  const reviews: PointReview[] = []
  let recheck: RecheckOf | null = null
  let sectionsStarted = false
  let legacy: string[] | null = null
  const endLegacy = () => { if (legacy) { marks.push(legacyMark(legacy.join('\n').trim())); legacy = null } }

  for (const line of lines) {
    const meta = decodeMeta(line)
    if (meta) {
      endLegacy()
      sectionsStarted = true
      if (meta.type === 'recheck') recheck = meta.recheck
      else {
        // One review per point: a later line for the same key wins.
        const at = reviews.findIndex(r => r.key === meta.review.key)
        if (at >= 0) reviews[at] = meta.review
        else reviews.push(meta.review)
      }
      continue
    }
    const mark = decodeMark(line)
    if (mark) { endLegacy(); marks.push(mark); sectionsStarted = true; continue }
    if (BLOCK_HEADER_RE.test(line.trim())) { endLegacy(); legacy = [line.trim()]; sectionsStarted = true; continue }
    if (legacy) {
      if (line.trim()) { legacy.push(line); continue }
      endLegacy()
      continue
    }
    const cp = parseCheckpointLine(line)
    if (cp) { checkpoints.push(cp); sectionsStarted = true; continue }
    if (!sectionsStarted) head.push(line)
    else if (line.trim()) tail.push(line)
    else if (tail.length && tail[tail.length - 1] !== '') tail.push('')
  }
  endLegacy()
  // compose adds one blank line between the body and what follows.
  if (sectionsStarted && head.length && head[head.length - 1] === '') head.pop()
  let body = head.join('\n')
  const rest = tail.join('\n').trim()
  if (rest) body = body.trim() ? `${body.replace(/\s+$/, '')}\n\n${rest}` : rest
  // Reviews keyed the older way (words + "Still not fixed" note) move to the words-only key.
  const keyed = reviews.length
    ? upgradeReviewKeys([...parseOutline(body), ...checkpoints.filter(c => c.text.trim()).map(c => ({ text: c.text.trim(), tail: null }))], reviews)
    : reviews
  return { body, checkpoints, marks, reviews: keyed, recheck }
}

export function encodeMark(m: Mark): string {
  if (m.type === 'pick') return encodePick(m.capture, m.id, m.label)
  if (m.type === 'page') return encodePage(m.start, m.savedOn)
  return m.raw
}

export function composeDescription(p: DescriptionParts): string {
  const parts: string[] = []
  const cps = p.checkpoints.map(checkpointLine).join('\n')
  if (cps) parts.push(cps)
  const marks = p.marks.map(encodeMark).join('\n\n')
  if (marks) parts.push(marks)
  const meta = [...(p.recheck ? [encodeRecheck(p.recheck)] : []), ...(p.reviews ?? []).map(encodeReview)].join('\n')
  if (meta) parts.push(meta)
  const rest = parts.join('\n\n')
  if (!rest) return p.body
  return p.body.trim() ? `${p.body}\n\n${rest}` : rest
}

/** Ids the text links to (body and checkpoints). */
export function referencedIds(p: Pick<ParsedDescription, 'body' | 'checkpoints'>): Set<string> {
  const ids = new Set<string>()
  for (const t of [p.body, ...p.checkpoints.map(c => c.text)]) for (const m of t.matchAll(REF_RE)) ids.add(m[1])
  return ids
}

/**
 * The description as saved: the text written as a clean outline (empty
 * points dropped, an old "1- " line or "- [ ]" checkpoint turned into a point
 * of its own, a ticked one into a Fixed review), edges trimmed, and a linked
 * pick whose link was deleted from the text dropped with it. Reviews keep
 * their points: the keys hash the words, never the layout.
 */
export function descriptionForSave(text: string): string {
  const p = foldCheckpoints(parseDescription(text))
  const body = serializeOutline(parseOutline(p.body))
  const has = p.marks.length || p.reviews.length || p.recheck
  if (!has) return body.trim()
  const refs = referencedIds({ body, checkpoints: [] })
  const marks = p.marks.filter(m => m.type !== 'pick' || !m.id || refs.has(m.id))
  // A review whose point was edited away (its text, hence its key, changed) goes too.
  const keys = new Set(pointKeys(pointTexts({ body, checkpoints: [] })))
  const reviews = p.reviews.filter(r => keys.has(r.key))
  return composeDescription({ ...p, marks, reviews, body: body.trim(), checkpoints: [] }).trim()
}

/** Every point's text: the paragraphs of the body, then any older "- [ ]" checkpoints. */
export const pointTexts = (p: Pick<ParsedDescription, 'body' | 'checkpoints'>): string[] =>
  [...splitPoints(p.body), ...p.checkpoints.map(c => c.text.trim()).filter(Boolean)]

/**
 * Older "- [ ]" checkpoints become paragraphs of the body (points are
 * automatic now); a ticked one becomes a Fixed review, unless the point
 * already has one. The keys stay the same: the points keep their order.
 */
export function foldCheckpoints<T extends DescriptionParts>(p: T): T & { reviews: PointReview[] } {
  const cps = p.checkpoints.filter(c => c.text.trim())
  const reviews = [...(p.reviews ?? [])]
  if (cps.length === 0) return { ...p, checkpoints: [], reviews }
  const keys = pointKeys(pointTexts(p))
  const first = keys.length - cps.length
  cps.forEach((c, i) => {
    const key = keys[first + i]
    if (c.done && !reviews.some(r => r.key === key)) reviews.push({ key, state: 'fixed' })
  })
  const head = p.body.replace(/\s+$/, '')
  const body = [head, ...cps.map(c => c.text.trim())].filter(Boolean).join('\n\n')
  return { ...p, body, checkpoints: [], reviews }
}

function newRefId(taken: Set<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 7)
    if (id.length >= 2 && !taken.has(id)) return id
  }
}

/**
 * Puts a link to a new pick into the text at `offset` (a position in the
 * body; null = the end), with a space on either side where needed. Returns
 * the new description and the body position just after the link.
 */
export function insertPickLink(text: string, capture: Capture, offset: number | null): { text: string; caret: number; id: string } {
  // The text box shows older checkpoints as paragraphs (foldCheckpoints), so the offset counts them.
  const p = foldCheckpoints(parseDescription(text))
  const taken = new Set(p.marks.flatMap(m => (m.type === 'pick' && m.id ? [m.id] : [])))
  const id = newRefId(taken)
  const at = offset == null ? p.body.length : Math.max(0, Math.min(offset, p.body.length))
  const before = p.body.slice(0, at)
  const after = p.body.slice(at)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = /^\s/.test(after) ? '' : ' '
  const body = `${before}${lead}${refToken(id)}${trail}${after}`
  const mark: PickMark = { type: 'pick', id, label: linkLabel(capture), capture }
  return {
    text: composeDescription({ ...p, body, marks: [...p.marks, mark] }),
    caret: before.length + lead.length + refToken(id).length + trail.length,
    id,
  }
}

/**
 * Puts a link to a new pick into point `at.index` at `at.offset` (null = the
 * end of the last point) — the request window's editor works in points.
 * The body comes back as a clean outline (empty points the editor holds are
 * kept), with the caret just after the link.
 */
export function insertPickAt(text: string, capture: Capture, at: Caret | null): { text: string; caret: Caret; id: string } {
  const p = foldCheckpoints(parseDescription(text))
  const taken = new Set(p.marks.flatMap(m => (m.type === 'pick' && m.id ? [m.id] : [])))
  const id = newRefId(taken)
  const r = insertIntoOutline(parseOutline(p.body, { keepEmpty: true }), refToken(id), at)
  const mark: PickMark = { type: 'pick', id, label: linkLabel(capture), capture }
  return { text: composeDescription({ ...p, body: serializeOutline(r.points), marks: [...p.marks, mark] }), caret: r.caret, id }
}

export type BodySegment = { type: 'text'; text: string } | { type: 'ref'; id: string; label: string; mark: PickMark | null }

/** The text cut into plain runs and links. */
export function bodySegments(body: string, marks: readonly Mark[]): BodySegment[] {
  const byId = new Map(marks.flatMap(m => (m.type === 'pick' && m.id ? [[m.id, m] as const] : [])))
  const out: BodySegment[] = []
  let last = 0
  for (const m of body.matchAll(REF_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ type: 'text', text: body.slice(last, i) })
    const mark = byId.get(m[1]) ?? null
    out.push({ type: 'ref', id: m[1], label: mark ? pickLabel(mark) : 'missing link', mark })
    last = i + m[0].length
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) })
  return out
}

/** The text as the user reads it: every link replaced by its name. */
export const plainText = (body: string, marks: readonly Mark[]): string =>
  bodySegments(body, marks).map(s => (s.type === 'text' ? s.text : s.label)).join('')

/** The marks shown as rows: older picks, never linked from the text. The
 *  page a request was written on stays out of sight (the prompt has it). */
export const unlinkedPicks = (marks: readonly Mark[]) =>
  marks.filter(m => (m.type === 'pick' && !m.id) || (m.type === 'legacy' && m.kind === 'pick'))

/** Adds a mark after everything else. */
export function appendMark(text: string, mark: Mark): string {
  const p = parseDescription(text)
  return composeDescription({ ...p, marks: [...p.marks, mark] })
}

/** Replaces the checkpoint list (the body and marks stay as they are). */
export const withCheckpoints = (text: string, checkpoints: Checkpoint[]): string =>
  composeDescription({ ...parseDescription(text), checkpoints })

// ── What the user sees ───────────────────────────────────────────────────────

/** `CurrentProgramCard` → `Current program card`. */
export function humanizeComponent(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/\s+/)
  return words.map((w, i) => (i === 0 ? w : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ')
}

/** `"Nutrition" card` → `Nutrition card`, `row "Lunch"` → `Lunch row`. */
function trailWords(t: string): string {
  const row = /^row "(.*)"$/.exec(t)
  return row ? `${row[1]} row` : t.replace(/"/g, '')
}

/** The popup it was in: its title, '' for an untitled one, null for none. */
function popupOf(c: Capture): string | null {
  const area = c.element?.area ?? ''
  const m = /^popup "(.*)"$/.exec(area)
  if (m) return m[1]
  if (area === 'popup') return ''
  if (!c.element) return c.page.popups?.[0] ?? null
  return null
}

function crumbList(): { add: (s: string | null | undefined) => void; list: string[] } {
  const list: string[] = []
  return {
    list,
    add: (s) => {
      const v = cleanText(s, 40)
      if (v && !list.some(x => x.toLowerCase() === v.toLowerCase())) list.push(v)
    },
  }
}

export interface MarkLabel {
  /** Page › tab › popup › card — where it is. */
  crumbs: string[]
  /** The thing pointed at (a label or quoted text), if any. */
  what: string | null
  kind: 'pick' | 'quote' | 'page'
}

export function markLabel(m: Mark): MarkLabel {
  if (m.type === 'legacy') {
    return { crumbs: [m.pageTitle || m.route || 'Page'], what: m.what, kind: m.kind === 'page' ? 'page' : 'pick' }
  }
  const page = m.type === 'pick' ? m.capture.page : m.start
  const c = crumbList()
  c.add(page.pageTitle || page.route)
  const el = m.type === 'pick' ? m.capture.element ?? null : null
  const tab = el?.tabs?.[0] ?? page.tabs?.[0]
  if (tab && tab.toLowerCase() !== page.pageTitle.toLowerCase()) c.add(`${tab} tab`)
  if (m.type === 'page') {
    const popup = page.popups?.[0]
    if (popup) c.add(`${popup} popup`)
    return { crumbs: c.list, what: null, kind: 'page' }
  }
  const cap = m.capture
  const popup = popupOf(cap)
  if (popup !== null) c.add(popup ? `${popup} popup` : 'popup')
  const trail = (el?.trail ?? []).filter(t => !/navigation$|sidebar$/.test(t))
  const inner = trail.length ? trailWords(trail[trail.length - 1]) : null
  const src = summarizeSources(el?.sources)
  const place = inner ?? (src ? humanizeComponent(src.name) : null)
  const what = cleanText(cap.kind === 'selection' ? cap.quote : el?.name || el?.text || el?.value, 60) || null
  if (place && place.toLowerCase() !== what?.toLowerCase()) c.add(place)
  return { crumbs: c.list, what, kind: cap.kind === 'selection' ? 'quote' : 'pick' }
}

/**
 * The short name a link shows: the card or section it sits in when the
 * pointed-at label is that card's own name ("Water" in the Water card →
 * "Water card"), else the label itself ("Log food"), else the component
 * ("Water tracker"), else the page.
 */
export function linkLabel(c: Capture): string {
  if (c.kind === 'selection' && c.quote) return cleanText(c.quote, 40)
  const el = c.element ?? null
  const trail = (el?.trail ?? []).filter(t => !/navigation$|sidebar$/.test(t))
  const place = trail.length ? trailWords(trail[trail.length - 1]) : null
  const what = cleanText(el?.name || el?.text || el?.value, 40) || null
  const src = summarizeSources(el?.sources)
  if (place && (!what || place.toLowerCase().startsWith(what.toLowerCase()))) return cleanText(place, 40)
  if (what) return what
  if (src) return humanizeComponent(src.name)
  return cleanText(c.page.pageTitle || c.page.route, 40) || 'this spot'
}

export const pickLabel = (m: PickMark): string => m.label?.trim() || linkLabel(m.capture)

/** One line: `Training › Program tab › Current program card — “Missed sessions”`. */
export function markText(m: Mark): string {
  const l = markLabel(m)
  const where = l.crumbs.join(' › ')
  if (l.kind === 'page') return `Written on ${where}`
  return l.what ? `${where} — “${l.what}”` : where
}

/** Where Go there navigates (hash route with its query), if known. */
export function markRoute(m: Mark): string | null {
  if (m.type === 'legacy') return m.route
  return m.type === 'pick' ? m.capture.page.route : m.start.route
}

/** The pick marks (what the user pointed at), without the page it was written on. */
export const pickMarks = (marks: readonly Mark[]) => marks.filter(m => m.type === 'pick' || (m.type === 'legacy' && m.kind === 'pick'))

/**
 * A short preview for lists: the user's own words, else what was picked
 * ("Picked: Food › Today tab — “Log food”"), else ''.
 */
export function descriptionPreview(text: string | null | undefined, max = 160): string {
  const p = parseDescription(text)
  if (p.body.trim()) return cleanText(plainText(p.body, p.marks), max)
  const first = p.checkpoints.find(c => c.text.trim())
  if (first) return cleanText(first.text, max)
  const pick = pickMarks(p.marks)[0]
  return pick ? cleanText(`Picked: ${markText(pick)}`, max) : ''
}

// ── What Claude reads ────────────────────────────────────────────────────────

/**
 * Every technical detail of a mark, as text for the prompt: the component
 * and file, the route with its query, the element and its text, popups and
 * surroundings (the Where line even when a component is known), the screen.
 */
export function markPromptText(m: Mark): string {
  if (m.type === 'legacy') return m.raw
  if (m.type === 'page') return formatPageContext(m.start, m.savedOn)
  const c = m.capture
  const lines = formatCapture(c).split('\n')
  const el = c.element
  const popups = (c.page.popups ?? []).map(p => cleanText(p, 60)).filter(Boolean)
  if (popups.length) lines.push(`Open popup: ${popups.join(', ')}`)
  const pageTabs = (c.page.tabs ?? []).map(t => cleanText(t, 40)).filter(Boolean)
  if (pageTabs.length) lines.push(`Page tabs: ${pageTabs.join(', ')}`)
  if (el && !lines.some(l => l.startsWith('Where: '))) {
    const where = whereParts(cleanText(el.area, 60), (el.trail ?? []).map(t => cleanText(t, 60)).filter(Boolean))
    if (where.length) lines.push(`Where: ${where.join(' › ')}`)
  }
  if (el && !lines.some(l => l.startsWith('Screen: '))) lines.push(`Screen: ${Math.round(c.page.viewport.w)}×${Math.round(c.page.viewport.h)}, ${c.page.breakpoint}, ${c.page.theme} theme`)
  return lines.join('\n')
}
