import { cleanText, elementLabel, type PageContext, type PickedElement } from '../devRequestContext'

// Reads what the request composer needs from the live page: the element the
// user pointed at (its name, visible text, the card and popup it sits in,
// selected tabs, data-* attributes, its box) and the page as a whole. The
// visible strings are the reliable pointer back to the source — they are
// literals there; class names are not (Tailwind), so none are recorded.

/** Marks the composer, its pill and the pick highlight: never picked, never reported. */
export const DEV_REQUEST_UI_ATTR = 'data-dev-request-ui'

export const isRequestUi = (node: EventTarget | Node | null): boolean =>
  node instanceof Element ? node.closest(`[${DEV_REQUEST_UI_ATTR}]`) != null
    : node instanceof Node ? node.parentElement?.closest(`[${DEV_REQUEST_UI_ATTR}]`) != null
      : false

const INTERACTIVE = 'button, a[href], input, select, textarea, summary, label, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"]'
const CONTAINER = 'section, article, form, fieldset, li, aside, nav, [role="dialog"], [role="region"], [role="tabpanel"], [role="group"], [role="listitem"], [role="row"], [role="tablist"]'
const HEADING = 'h1, h2, h3, h4, h5, [role="heading"], legend'
// Transient state or plumbing, not meaning.
const DATA_SKIP = /^data-(headlessui|focus|hover|active|open|closed|enter|leave|transition|selected|checked|disabled|autofocus|app-scroller|vt|dev-request)/

/**
 * What a click on `raw` should capture: the control it belongs to (an icon
 * inside a button → the button), else the element itself. SVG innards never.
 */
export function pickTarget(raw: Element): Element {
  let el: Element = raw
  const svg = el.closest('svg')
  if (svg?.parentElement) el = svg.parentElement
  const control = el.closest(INTERACTIVE)
  if (control && depthBetween(el, control) <= 4) return control
  return el
}

function depthBetween(inner: Element, outer: Element): number {
  let d = 0
  for (let e: Element | null = inner; e && e !== outer; e = e.parentElement) d++
  return d
}

/** One level out, skipping wrappers that add no box of their own. */
export function widerTarget(el: Element): Element | null {
  let p = el.parentElement
  const r = el.getBoundingClientRect()
  while (p && p !== document.body) {
    const pr = p.getBoundingClientRect()
    if (Math.abs(pr.width - r.width) > 2 || Math.abs(pr.height - r.height) > 2) return p
    p = p.parentElement
  }
  return null
}

// innerText keeps the spacing between blocks, but also applies CSS
// text-transform ("TASKS"); an uppercased label reads its source text instead,
// since the source spelling is what Claude will search for.
function textOf(el: Element | null | undefined, max = 120): string {
  if (!el) return ''
  const transformed = el instanceof HTMLElement && getComputedStyle(el).textTransform !== 'none'
  const t = el instanceof HTMLElement && !transformed ? el.innerText : el.textContent
  return cleanText(t, max)
}

const visibleHeading = (h: Element) => !h.closest('.sr-only') && (h as HTMLElement).offsetParent !== null

/** The last visible heading before `el` inside `scope` (a card's sub-section title). */
function headingBefore(el: Element, scope: Element): Element | null {
  let found: Element | null = null
  for (const h of scope.querySelectorAll(HEADING)) {
    if (h === el || h.contains(el)) break
    if (!(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break
    if (visibleHeading(h)) found = h
  }
  return found
}

function labelledBy(el: Element): string {
  const ids = el.getAttribute('aria-labelledby')
  if (!ids) return ''
  return cleanText(ids.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' '), 120)
}

function controlLabel(el: Element): string {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return ''
  const own = el.labels?.[0]
  if (own) return textOf(own, 80)
  return cleanText(el.getAttribute('placeholder'), 80)
}

export function accessibleName(el: Element): string {
  return cleanText(el.getAttribute('aria-label'), 120)
    || labelledBy(el)
    || controlLabel(el)
    || cleanText(el.getAttribute('title'), 120)
    || cleanText(el.getAttribute('alt'), 120)
    || textOf(el, 80)
}

function implicitRole(el: Element): string | null {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'a' && el.hasAttribute('href')) return 'link'
  if (tag === 'select') return 'dropdown'
  if (tag === 'textarea') return 'text box'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'img') return 'image'
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type
    if (type === 'checkbox' || type === 'radio' || type === 'range') return type
    if (type === 'button' || type === 'submit') return 'button'
    return 'text box'
  }
  return null
}

function dialogTitle(dialog: Element): string {
  return cleanText(dialog.getAttribute('aria-label'), 80) || labelledBy(dialog) || textOf(dialog.querySelector(HEADING), 80)
}

function containerLabel(c: Element): string {
  const aria = cleanText(c.getAttribute('aria-label'), 60) || labelledBy(c)
  const tag = c.tagName.toLowerCase()
  const role = c.getAttribute('role')
  if (role === 'dialog') return ''
  if (tag === 'nav') return aria ? `${aria} navigation` : 'navigation'
  if (tag === 'aside') return aria ? `${aria} sidebar` : 'sidebar'
  if (role === 'tablist') return aria ? `${aria} tabs` : ''
  if (aria) return aria
  if (tag === 'li' || role === 'listitem' || role === 'row') {
    const first = c.querySelector(HEADING) ?? c
    const t = textOf(first, 50)
    return t ? `row "${t}"` : ''
  }
  const heading = [...c.querySelectorAll(HEADING)].find(visibleHeading)
  const t = heading ? textOf(heading, 60) : ''
  if (!t) return ''
  return tag === 'section' || tag === 'article' ? `"${t}" card` : `"${t}"`
}

function areaOf(el: Element): string {
  const dialog = el.closest('[role="dialog"]')
  if (dialog) {
    const t = dialogTitle(dialog)
    return t ? `popup "${t}"` : 'popup'
  }
  if (el.closest('aside')) return 'sidebar'
  if (el.closest('main, [data-app-scroller]')) return 'page'
  if (el.closest('header')) return 'header'
  if (el.closest('nav')) return 'navigation'
  return ''
}

// Tabs selected in the same card (or popup, or page), plus toggles pressed
// among its own siblings (filter chips) — not every pressed toggle on the page.
function selectedNear(el: Element): string[] {
  const scope = el.closest('section, article, [role="dialog"], main') ?? document.body
  const found = [
    ...scope.querySelectorAll('[role="tab"][aria-selected="true"]'),
    ...(el.parentElement?.querySelectorAll(':scope > [aria-pressed="true"]') ?? []),
  ]
  const out: string[] = []
  for (const t of found) {
    if (isRequestUi(t)) continue
    const label = accessibleName(t)
    if (label && !out.includes(label)) out.push(label)
    if (out.length >= 4) break
  }
  return out
}

function dataAttrs(el: Element): [string, string][] {
  const out: [string, string][] = []
  const seen = new Set<string>()
  let e: Element | null = el
  for (let depth = 0; e && e !== document.body && depth < 5; depth++, e = e.parentElement) {
    for (const a of e.attributes) {
      if (!a.name.startsWith('data-') || DATA_SKIP.test(a.name) || seen.has(a.name)) continue
      const v = cleanText(a.value, 40)
      if (!v) continue
      seen.add(a.name)
      out.push([a.name.slice(5), v])
      if (out.length >= 6) return out
    }
    if (e.matches(CONTAINER)) break
  }
  return out
}

// Plumbing, not a screen part: contexts, providers, the router, boundaries.
const WRAPPER_COMPONENT = /(Context|Provider|Consumer)$|^(Route|Routes|Outlet|ErrorBoundary|Suspense|Fragment|StrictMode|Portal|ForwardRef|Memo)$/

// Development builds only (owner decision: no component names in production
// captures — production minifies them anyway). React keeps the fiber on the
// DOM node under a random-suffixed key; walk it up to the nearest components.
function componentNames(el: Element): string[] {
  if (!import.meta.env.DEV) return []
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
  if (!key) return []
  type Fiber = { type?: unknown; return?: Fiber | null }
  const out: string[] = []
  let f: Fiber | null | undefined = (el as unknown as Record<string, Fiber>)[key]
  for (; f && out.length < 4; f = f.return) {
    const t = f.type as { displayName?: string; name?: string } | string | null | undefined
    const name = t && typeof t !== 'string' ? t.displayName || t.name : ''
    if (name && /^[A-Z]/.test(name) && !WRAPPER_COMPONENT.test(name) && !out.includes(name)) out.push(name)
  }
  return out
}

/** The short label shown while hovering: `button "Log food"`. */
export function labelFor(el: Element): string {
  return elementLabel({ tag: el.tagName.toLowerCase(), role: implicitRole(el), name: accessibleName(el) })
}

/** Everything worth writing down about one element. */
export function readElement(el: Element): PickedElement {
  const tag = el.tagName.toLowerCase()
  const name = accessibleName(el)
  const full = textOf(el, 160)
  const text = full && full !== name && !name.startsWith(full) ? full : ''
  let value = ''
  if (el instanceof HTMLSelectElement) value = el.selectedOptions[0]?.text ?? ''
  else if (el instanceof HTMLTextAreaElement) value = el.value
  else if (el instanceof HTMLInputElement && el.type !== 'password') {
    value = el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 'checked' : 'not checked') : el.value
  }
  const trail: string[] = []
  const inner = el.parentElement?.closest(CONTAINER) ?? null
  for (let c = inner; c && trail.length < 4; c = c.parentElement?.closest(CONTAINER) ?? null) {
    const label = containerLabel(c)
    if (label && label !== name && !trail.includes(label)) trail.unshift(label)
  }
  // The sub-section it sits under inside its card ("Tasks" in the brief).
  const sub = inner ? headingBefore(el, inner) : null
  const subText = sub ? textOf(sub, 60) : ''
  if (subText && subText !== name && !trail.some(t => t.includes(`"${subText}"`))) trail.push(`"${subText}"`)
  // The popup's own title already names the area.
  const dialog = el.closest('[role="dialog"]')
  const popupTitle = dialog ? dialogTitle(dialog) : ''
  const trailShown = popupTitle ? trail.filter(t => t !== `"${popupTitle}"` && t !== `"${popupTitle}" card`) : trail
  const r = el.getBoundingClientRect()
  return {
    tag,
    role: implicitRole(el),
    name: name || null,
    text: text || null,
    value: cleanText(value, 120) || null,
    trail: trailShown,
    area: areaOf(el) || null,
    tabs: selectedNear(el),
    data: dataAttrs(el),
    rect: { x: r.left, y: r.top, w: r.width, h: r.height },
    components: componentNames(el),
  }
}

/** The deployed entry bundle's file name (absent in development). */
function buildName(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
  return s ? s.src.split('/').pop() ?? null : null
}

/** The page as a whole: tabs selected, popups open, screen and theme. */
export function readPageContext(route: string, pageTitle: string, breakpoint: string): PageContext {
  const scope = document.querySelector('main, [data-app-scroller], .tg-root') ?? document.body
  const tabs: string[] = []
  for (const t of scope.querySelectorAll('[role="tab"][aria-selected="true"]')) {
    const label = accessibleName(t)
    if (label && !tabs.includes(label)) tabs.push(label)
    if (tabs.length >= 5) break
  }
  const popups: string[] = []
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    if (isRequestUi(d) || d.querySelector(`[${DEV_REQUEST_UI_ATTR}]`)) continue
    const t = dialogTitle(d)
    if (t && !popups.includes(t)) popups.push(t)
  }
  const h1 = document.querySelector('main h1, .tg-root h1')
  return {
    route,
    pageTitle,
    heading: h1 ? textOf(h1, 80) || null : null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    breakpoint,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    tabs,
    popups,
    build: buildName(),
    at: new Date().toISOString(),
  }
}

/** The current text selection on the page (outside the composer), if any. */
export function readSelection(): { text: string; element: Element } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const text = cleanText(sel.toString(), 400)
  if (!text) return null
  const node = sel.getRangeAt(0).commonAncestorContainer
  const element = node instanceof Element ? node : node.parentElement
  if (!element || isRequestUi(element)) return null
  return { text, element }
}
