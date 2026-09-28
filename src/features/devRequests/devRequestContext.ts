// Pure: turns what the request composer captured on the page (an element the
// user picked, a quoted selection, the page itself) into plain text blocks
// appended to a request's description. Plain text on purpose: it stays
// editable, needs no schema change, and the Claude prompt already carries
// the description verbatim. The strings quoted here (button labels, card
// headings) are literals in the source, so Claude can grep for them.
// Import-free so scripts/verify-dev-request-context.cjs can require it.

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
  /** Development builds only: the components rendering it, inner → outer. */
  components?: string[]
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

const pad = (n: number) => String(n).padStart(2, '0')

/** en-GB `28/09/2026 14:05` in local time; '' for a missing or bad timestamp. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
    const trail = (el.trail ?? []).map(t => cleanText(t, 60)).filter(Boolean)
    const area = cleanText(el.area, 60)
    if (trail.length || area) lines.push(`Where: ${[area, ...trail].filter(Boolean).join(' › ')}`)
    const name = cleanText(el.name, 160)
    const text = cleanText(el.text, 160)
    if (c.kind === 'element' && text && text !== name) lines.push(`Text: ${quoted(text)}`)
    const value = cleanText(el.value, 120)
    if (value) lines.push(`Value: ${quoted(value)}`)
    const tabs = (el.tabs ?? []).map(t => cleanText(t, 40)).filter(Boolean)
    if (tabs.length) lines.push(`Selected: ${tabs.join(', ')}`)
    const data = (el.data ?? []).filter(([k, v]) => k && v)
    if (data.length) lines.push(`Data: ${data.map(([k, v]) => `${k}=${cleanText(v, 40)}`).join(', ')}`)
    if (el.rect) {
      const r = el.rect
      lines.push(`Box: x ${Math.round(r.x)}, y ${Math.round(r.y)}, ${Math.round(r.w)}×${Math.round(r.h)} px on ${screenLabel(c.page)}`)
    }
    if (el.components && el.components.length) lines.push(`Components (dev build): ${el.components.join(' ‹ ')}`)
  } else {
    lines.push(`Screen: ${screenLabel(c.page)}`)
  }
  return lines.join('\n')
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

/** Appends a block after a blank line (none when the description is empty). */
export function appendBlock(description: string, block: string): string {
  const body = description.replace(/\s+$/, '')
  const add = block.trim()
  if (!add) return description
  return body ? `${body}\n\n${add}` : add
}

/** Splits a description into the prose the user wrote and the context blocks after it. */
export function splitDescription(text: string | null | undefined): { body: string; blocks: string[] } {
  const lines = (text ?? '').split('\n')
  const first = lines.findIndex(l => BLOCK_HEADER_RE.test(l.trim()))
  if (first === -1) return { body: (text ?? '').trim(), blocks: [] }
  const body = lines.slice(0, first).join('\n').trim()
  const blocks: string[] = []
  let current: string[] = []
  for (const line of lines.slice(first)) {
    if (BLOCK_HEADER_RE.test(line.trim()) && current.length) {
      blocks.push(current.join('\n').trim())
      current = []
    }
    current.push(line)
  }
  if (current.length) blocks.push(current.join('\n').trim())
  return { body, blocks: blocks.filter(Boolean) }
}

/**
 * A short preview for lists: the user's own words, else a summary of what was
 * picked ("Picked: button "Log food""), else ''.
 */
export function descriptionPreview(text: string | null | undefined, max = 160): string {
  const { body, blocks } = splitDescription(text)
  if (body) return cleanText(body, max)
  for (const b of blocks) {
    const el = b.split('\n').find(l => l.startsWith('Element: ') || l.startsWith('Quote: '))
    if (el) return cleanText(`Picked: ${el.replace(/^(Element|Quote): /, '')}`, max)
  }
  return ''
}

/** How many context blocks a description carries (for the composer's summary line). */
export function countBlocks(text: string | null | undefined): number {
  return splitDescription(text).blocks.length
}
