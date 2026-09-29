// Pure: a request's description as three parts —
//   body         the user's own words (what the text box edits)
//   checkpoints  "- [ ] …" lines, shown as checkboxes
//   marks        where on the app the request points: one line per pick
//                (`[[pick {json}]]`) and one for the page it was written on
//                (`[[page {json}]]`)
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
  type Capture, type PageContext, type PickedElement,
} from './devRequestContext'
import { checkpointLine, parseCheckpointLine, type Checkpoint } from './checkpoints'

export interface PickMark { type: 'pick'; capture: Capture }
export interface PageMark { type: 'page'; start: PageContext; savedOn: PageContext | null }
/** A plain-text block from before marks; `raw` is kept exactly. */
export interface LegacyMark { type: 'legacy'; raw: string; kind: 'pick' | 'page'; pageTitle: string; route: string | null; what: string | null }
export type Mark = PickMark | PageMark | LegacyMark

export interface ParsedDescription {
  body: string
  checkpoints: Checkpoint[]
  marks: Mark[]
}

const MARK_RE = /^\[\[(pick|page) (\{.*\})\]\]$/

// ── Encoding ─────────────────────────────────────────────────────────────────

export const encodePick = (capture: Capture): string => `[[pick ${JSON.stringify(capture)}]]`

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
  return {
    type: 'pick',
    capture: {
      kind: v.kind === 'selection' ? 'selection' : 'element',
      page,
      element: asElement(v.element),
      quote: typeof v.quote === 'string' ? v.quote : null,
    },
  }
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
  let sectionsStarted = false
  let legacy: string[] | null = null
  const endLegacy = () => { if (legacy) { marks.push(legacyMark(legacy.join('\n').trim())); legacy = null } }

  for (const line of lines) {
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
  return { body, checkpoints, marks }
}

export function encodeMark(m: Mark): string {
  if (m.type === 'pick') return encodePick(m.capture)
  if (m.type === 'page') return encodePage(m.start, m.savedOn)
  return m.raw
}

export function composeDescription(p: ParsedDescription): string {
  const parts: string[] = []
  const cps = p.checkpoints.map(checkpointLine).join('\n')
  if (cps) parts.push(cps)
  const marks = p.marks.map(encodeMark).join('\n\n')
  if (marks) parts.push(marks)
  const rest = parts.join('\n\n')
  if (!rest) return p.body
  return p.body.trim() ? `${p.body}\n\n${rest}` : rest
}

/** The description as saved: empty checkpoints dropped, edges trimmed. */
export function descriptionForSave(text: string): string {
  const p = parseDescription(text)
  const has = p.checkpoints.length || p.marks.length
  if (!has) return text.trim()
  return composeDescription({ ...p, body: p.body.trim(), checkpoints: p.checkpoints.filter(c => c.text.trim()) }).trim()
}

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
  if (p.body.trim()) return cleanText(p.body, max)
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
