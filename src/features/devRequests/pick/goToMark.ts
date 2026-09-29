import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cleanText } from '../devRequestContext'
import { markLabel, markRoute, type Mark } from '../devRequestMarks'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { accessibleName, DEV_REQUEST_UI_ATTR, isRequestUi } from './pickDom'
import { SOURCE_ATTR } from './componentSourceTransform'
import { toast, useUIStore } from '../../../app/store'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'

// "Go there" on a picked spot: open its page (route + query) and, once the
// page has rendered, find the element again — by the component stamps
// (data-src) it was rendered inside and its label or text — scroll it into
// view and outline it for a moment. A popup it was in cannot be reopened;
// then the page opens and a toast says which popup to open.

const LOOK_FOR_MS = 3000
const OUTLINE_MS = 2400

const visible = (el: Element) => el.getClientRects().length > 0 && !isRequestUi(el)

function nameMatches(el: Element, needle: string): boolean {
  const n = needle.toLowerCase()
  const name = accessibleName(el).toLowerCase()
  if (name === n || name.startsWith(n)) return true
  return cleanText(el.textContent, 400).toLowerCase().includes(n)
}

/** Finds the picked element on the current page, or null. */
function locate(mark: Mark): Element | null {
  if (mark.type !== 'pick') return null
  const c = mark.capture
  const el = c.element
  const needle = cleanText(c.kind === 'selection' ? c.quote : el?.name || el?.text, 60).replace(/…$/, '')
  const stamps = el?.sources ?? []
  const nodesFor = (stamp: string) =>
    [...document.querySelectorAll(`[${SOURCE_ATTR}="${CSS.escape(stamp)}"]`)].filter(visible)

  // Innermost stamp first: the smallest element that carries the label.
  if (needle) {
    for (const s of stamps) {
      const hit = nodesFor(s).find(n => nameMatches(n, needle))
      if (hit) return narrowTo(hit, needle)
    }
    const scope = document.querySelector('main, [data-app-scroller]') ?? document.body
    const exact = [...scope.querySelectorAll('button, a, [role], h1, h2, h3, h4, label, input, select, textarea')]
      .find(n => visible(n) && accessibleName(n).toLowerCase() === needle.toLowerCase())
    if (exact) return exact
  }
  for (const s of stamps) {
    const nodes = nodesFor(s)
    if (nodes.length === 1) return nodes[0]
  }
  return null
}

/** The innermost descendant of `el` that still carries the label (a card → its button). */
function narrowTo(el: Element, needle: string): Element {
  let best = el
  for (const child of el.querySelectorAll('button, a, [role], h1, h2, h3, h4, label, p, span, td, li')) {
    if (visible(child) && accessibleName(child).toLowerCase() === needle.toLowerCase()) { best = child; break }
  }
  return best
}

function outline(el: Element) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  const box = document.createElement('div')
  box.setAttribute(DEV_REQUEST_UI_ATTR, '')
  box.setAttribute('aria-hidden', 'true')
  box.className = 'pointer-events-none fixed z-float rounded-control border-2 border-accent-500 bg-accent-500/10 transition-opacity duration-300'
  document.body.appendChild(box)
  const until = performance.now() + OUTLINE_MS
  const follow = () => {
    if (!el.isConnected || performance.now() > until) {
      box.style.opacity = '0'
      setTimeout(() => box.remove(), 320)
      return
    }
    const r = el.getBoundingClientRect()
    Object.assign(box.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` })
    requestAnimationFrame(follow)
  }
  follow()
}

function lookFor(mark: Mark) {
  const started = performance.now()
  const tick = () => {
    const el = locate(mark)
    if (el) { outline(el); return }
    if (performance.now() - started < LOOK_FOR_MS) { setTimeout(tick, 150); return }
    if (mark.type !== 'pick') return
    const popup = mark.capture.element?.area?.startsWith('popup') ? /^popup "(.*)"$/.exec(mark.capture.element.area)?.[1] ?? 'a popup' : null
    toast.info(popup
      ? `It was inside the "${popup}" popup — open it to see the spot`
      : "Opened the page — couldn't find that exact spot any more")
  }
  // Two frames: the route change renders first.
  requestAnimationFrame(() => requestAnimationFrame(tick))
}

/** Returns Go there for a mark: navigate to its page, then outline the spot. */
export function useGoToMark() {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const phone = useBreakpoint() === 'phone'
  return useCallback((mark: Mark) => {
    const route = markRoute(mark)
    if (!route) { toast.warning('This one has no page address saved'); return }
    useUIStore.getState().closeDevRequests()
    // The docked composer covers the lower half of a phone screen.
    const s = useDevRequestDrafts.getState()
    if (phone && s.composer.open && !s.composer.minimized) s.setMinimized(true)
    if (route !== `${pathname}${search}`) navigate(route)
    if (mark.type === 'pick') lookFor(mark)
    else if (route === `${pathname}${search}`) toast.info(`Already on ${markLabel(mark).crumbs[0] ?? 'this page'}`)
  }, [navigate, pathname, search, phone])
}
