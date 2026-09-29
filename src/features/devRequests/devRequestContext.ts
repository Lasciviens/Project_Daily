// Pure: what the request composer captures on the page (an element the user
// picked, a quoted selection, the page itself) and the text blocks the prompt
// for Claude shows for it. The capture is stored as a mark in the description
// (devRequestMarks.ts); these blocks are the technical detail Claude reads.
// The strings quoted here (button labels, card headings) are literals in the
// source, so Claude can grep for them.
// Pure (its only import is the import-free date formatter) so
// scripts/verify-dev-request-context.cjs can require it.

import { formatDateTime } from '../../shared/utils/dateFormat'

export interface PageContext {
  /** Hash route with its query, e.g. `/recipes?tab=today`. */
  route: string
  /** The shell's page name (`routeTitle`), e.g. `Food`. */
  pageTitle: string
  /** The page's own heading when it differs from the name (Daily's date). */
  heading?: string | null
  viewport: { w: number; h: number }
  breakpoint: string
  theme: 'light' | 'dark'
  /** Tabs selected on the page (segmented controls, tab rows). */
  tabs?: string[]
  /** Popups open over the page. */
  popups?: string[]
  /** The deployed bundle name (tells a stale service-worker build apart). */
  build?: string | null
  /** ISO timestamp. */
  at?: string | null
}

export interface PickedElement {
  tag: string
  role?: string | null
  /** Accessible name: aria-label, label, title, alt or the leading text. */
  name?: string | null
  /** Visible text, when it adds something to the name. */
  text?: string | null
  /** Current value of a form control. */
  value?: string | null
  /** Containers around it, outer → inner (card headings, rows, popups). */
  trail?: string[]
  /** Which part of the screen: page content, sidebar, a popup… */
  area?: string | null
  /** Tabs selected next to it. */
  tabs?: string[]
  /** data-* attributes on it and its close ancestors. */
  data?: [string, string][]
  rect?: { x: number; y: number; w: number; h: number }
  /**
   * `data-src` stamps (`src/…/File.tsx#Name`, added at build time) on it and
   * its ancestors, inner → outer: the components it was rendered by.
   */
  sources?: string[]
}

export interface Capture {
  kind: 'element' | 'selection'
  page: PageContext
  element?: PickedElement | null
  /** The quoted selection (kind 'selection'). */
  quote?: string | null
}

// ── Small text helpers ────────────────────────────────────────────────────────

/** Collapses whitespace, trims and cuts at `max` characters with an ellipsis. */
export function cleanText(value: string | null | undefined, max = 120): string {
  const s = (value ?? '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return s.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}

const quoted = (s: string) => `"${s}"`

/** `Food · /recipes?tab=today` */
export function routeLabel(page: Pick<PageContext, 'route' | 'pageTitle'>): string {
  return page.pageTitle ? `${page.pageTitle} · ${page.route}` : page.route
}

/** `1469×680, desktop, light theme` */
export function screenLabel(page: Pick<PageContext, 'viewport' | 'breakpoint' | 'theme'>): string {
  return `${Math.round(page.viewport.w)}×${Math.round(page.viewport.h)}, ${page.breakpoint}, ${page.theme} theme`
}

/** Short label for the pick highlight and the phone pick bar: `button "Log food"`. */
export function elementLabel(el: Pick<PickedElement, 'tag' | 'role' | 'name' | 'text'>): string {
  const kind = el.role && el.role !== el.tag ? el.role : el.tag
  const name = cleanText(el.name || el.text, 60)
  return name ? `${kind} ${quoted(name)}` : kind
}


/** `28.09.2026 14:05` in local time; '' for a missing or bad timestamp. */
export function formatStamp(iso: string | null | undefined): string {
  return formatDateTime(iso)
}

// ── Component sources ─────────────────────────────────────────────────────────

/** Shared primitives say little on their own ("Button"); the feature component around them says where. */
const PRIMITIVE_DIR = 'src/shared/ui/'

export interface SourceSummary {
  /** The component to name: the innermost one outside the shared primitives. */
  name: string
  file: string
  /** The primitive it was picked inside, when that was skipped (`Button`). */
  via: string | null
  /** The next component out (the one using it), if any. */
  inside: string[]
}

const splitStamp = (v: string) => {
  const i = v.lastIndexOf('#')
  return i > 0 && i < v.length - 1 ? { file: v.slice(0, i), name: v.slice(i + 1) } : null
}

/** Reads the stamp chain of a pick (inner → outer) into what the block says. */
export function summarizeSources(stamps: readonly string[] | null | undefined): SourceSummary | null {
  const list: { file: string; name: string }[] = []
  for (const s of stamps ?? []) {
    const p = splitStamp(s)
    if (p && !list.some(x => x.name === p.name && x.file === p.file)) list.push(p)
  }
  if (list.length === 0) return null
  let i = list.findIndex(x => !x.file.startsWith(PRIMITIVE_DIR))
  if (i === -1) i = 0
  const main = list[i]
  const via = i > 0 ? list[i - 1].name : null
  const inside: string[] = []
  for (const x of list.slice(i + 1)) {
    if (x.file.startsWith(PRIMITIVE_DIR) || x.name === main.name || inside.includes(x.name)) continue
    inside.push(x.name)
    if (inside.length >= 1) break
  }
  return { name: main.name, file: main.file, via, inside }
}

/** `NutritionCard (src/…/NutritionCard.tsx) · via Button · inside TodaySummary` */
export function sourceLine(s: SourceSummary): string {
  const parts = [`${s.name} (${s.file})`]
  if (s.via) parts.push(`via ${s.via}`)
  if (s.inside.length) parts.push(`inside ${s.inside.join(' › ')}`)
  return parts.join(' · ')
}

// ── Blocks ────────────────────────────────────────────────────────────────────

/** A context block's first line. Everything from the first one on is context, not prose. */
export const BLOCK_HEADER_RE = /^\[(?:Picked|Page context)\b[^\]\n]*\]\s*$/

/** One block for a picked element or a quoted selection. */
export function formatCapture(c: Capture): string {
  const el = c.element ?? null
  const lines: string[] = []
  const where = routeLabel(c.page)
  if (c.kind === 'selection') {
    lines.push(`[Picked text on ${where}]`)
    const q = cleanText(c.quote, 400)
    if (q) lines.push(`Quote: ${quoted(q)}`)
  } else {
    lines.push(`[Picked on ${where}]`)
    if (el) lines.push(`Element: ${elementLabel(el)}`)
  }
  if (el) {
    const src = summarizeSources(el.sources)
    if (src) lines.splice(1, 0, `Component: ${sourceLine(src)}`)
    const name = cleanText(el.name, 160)
    const text = cleanText(el.text, 80)
    if (c.kind === 'element' && text && text !== name) lines.push(`Text: ${quoted(text)}`)
    const value = cleanText(el.value, 120)
    if (value) lines.push(`Value: ${quoted(value)}`)
    const tabs = (el.tabs ?? []).map(t => cleanText(t, 40)).filter(Boolean)
    if (tabs.length) lines.push(`Selected: ${tabs.join(', ')}`)
    // Without a component name, the surroundings are the next best pointer.
    if (!src) {
      const where = whereParts(cleanText(el.area, 60), (el.trail ?? []).map(t => cleanText(t, 60)).filter(Boolean))
      if (where.length) lines.push(`Where: ${where.join(' › ')}`)
      const data = (el.data ?? []).filter(([k, v]) => k && v)
      if (data.length) lines.push(`Data: ${data.map(([k, v]) => `${k}=${cleanText(v, 40)}`).join(', ')}`)
      if (el.rect) {
        const r = el.rect
        lines.push(`Box: x ${Math.round(r.x)}, y ${Math.round(r.y)}, ${Math.round(r.w)}×${Math.round(r.h)} px on ${screenLabel(c.page)}`)
      }
    }
  } else {
    lines.push(`Screen: ${screenLabel(c.page)}`)
  }
  return lines.join('\n')
}

/**
 * The area and the containers around the element, without saying the same
 * thing twice: an unnamed <aside> is already "sidebar", and "Main navigation"
 * already says it is the navigation ("sidebar › sidebar › Main navigation",
 * "navigation › Main navigation" before).
 */
export function whereParts(area: string, trail: readonly string[]): string[] {
  const parts: string[] = []
  for (const t of trail) if (t && t !== area && !parts.includes(t)) parts.push(t)
  const first = parts[0]
  const named = !!area && !!first && (first === area || first.toLowerCase().endsWith(` ${area.toLowerCase()}`))
  return area && !named ? [area, ...parts] : parts
}

/**
 * The automatic context appended when a new request is saved: where the draft
 * was started (the page it is about) and, when different, where it was saved.
 */
export function formatPageContext(start: PageContext, savedOn?: PageContext | null): string {
  const lines = ['[Page context]', `Page: ${routeLabel(start)}`]
  const heading = cleanText(start.heading, 80)
  if (heading && heading !== start.pageTitle) lines.push(`Heading: ${heading}`)
  const tabs = (start.tabs ?? []).map(t => cleanText(t, 40)).filter(Boolean)
  if (tabs.length) lines.push(`Selected tabs: ${tabs.join(', ')}`)
  const popups = (start.popups ?? []).map(t => cleanText(t, 60)).filter(Boolean)
  if (popups.length) lines.push(`Open popup: ${popups.join(', ')}`)
  lines.push(`Screen: ${screenLabel(start)}`)
  if (savedOn && savedOn.route !== start.route) lines.push(`Saved on: ${routeLabel(savedOn)}`)
  const build = cleanText(start.build ?? savedOn?.build, 80)
  if (build) lines.push(`Build: ${build}`)
  const stamp = formatStamp(start.at)
  if (stamp) lines.push(`Started: ${stamp}`)
  return lines.join('\n')
}
