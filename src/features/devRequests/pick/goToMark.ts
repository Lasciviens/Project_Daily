import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cleanText, type CapturedPopup, type PickedElement } from '../devRequestContext'
import { markLabel, markRoute, type Mark } from '../devRequestMarks'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { accessibleName, DEV_REQUEST_UI_ATTR, isRequestUi } from './pickDom'
import { SOURCE_ATTR } from './componentSourceTransform'
import { toast, useUIStore } from '../../../app/store'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { openPopups } from '../../../shared/modals/popupTrail'
import { useModalStore } from '../../../shared/modals/modalStore'
import type { EntityModalRequest } from '../../../shared/modals/types'

// "Go there" on a picked spot: open its page (route + query), reopen the
// popups it was inside (an entity popup from its saved request, a local one
// by clicking what opened it), then find the element again — by the
// component stamps (data-src) it was rendered inside and its label or text —
// scroll it into view and give it a blinking red border. A popup that can't
// be reopened is named in a toast; nothing behind it is outlined.

const LOOK_FOR_MS = 3000
const OUTLINE_MS = 2400

const visible = (el: Element) => el.getClientRects().length > 0 && !isRequestUi(el)

function nameMatches(el: Element, needle: string): boolean {
  const n = needle.toLowerCase()
  const name = accessibleName(el).toLowerCase()
  if (name === n || name.startsWith(n)) return true
  return cleanText(el.textContent, 400).toLowerCase().includes(n)
}

const CONTROLS = 'button, a, [role], h1, h2, h3, h4, label, input, select, textarea'

/**
 * Finds a picked element again inside `scope` (the top popup, or the page
 * with popups left out), by the component stamps it was rendered in and its
 * label or text. Null when it isn't there.
 */
function find(el: PickedElement | null | undefined, quote: string | null, scope: Element, inPopup: boolean): Element | null {
  const needle = cleanText(quote ?? el?.name ?? el?.text, 60).replace(/…$/, '')
  const stamps = el?.sources ?? []
  const here = (n: Element) => visible(n) && (inPopup || !n.closest('[role="dialog"]'))
  const nodesFor = (stamp: string) => [...scope.querySelectorAll(`[${SOURCE_ATTR}="${CSS.escape(stamp)}"]`)].filter(here)

  // Innermost stamp first: the smallest element that carries the label.
  if (needle) {
    for (const s of stamps) {
      const hit = nodesFor(s).find(n => nameMatches(n, needle))
      if (hit) return narrowTo(hit, needle)
    }
    const exact = [...scope.querySelectorAll(CONTROLS)]
      .find(n => here(n) && accessibleName(n).toLowerCase() === needle.toLowerCase())
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
  for (const child of el.querySelectorAll('button, a, [role], h1, h2, h3, h4, label, p, span, td, li')) {
    if (visible(child) && accessibleName(child).toLowerCase() === needle.toLowerCase()) return child
  }
  return el
}

function outline(el: Element) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  const box = document.createElement('div')
  box.setAttribute(DEV_REQUEST_UI_ATTR, '')
  box.setAttribute('aria-hidden', 'true')
  // Above every popup layer, so a spot inside a popup is outlined over it.
  box.className = 'goto-blink pointer-events-none fixed rounded-control transition-opacity duration-300'
  box.style.zIndex = '2147483000'
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Polls until `get` returns something, or gives up after `ms`. */
async function waitFor<T>(get: () => T | null, ms = LOOK_FOR_MS): Promise<T | null> {
  const until = performance.now() + ms
  for (;;) {
    const v = get()
    if (v) return v
    if (performance.now() > until) return null
    await sleep(120)
  }
}

const topPanel = () => { const s = openPopups(); return s.length ? s[s.length - 1].panel() : null }
const pageScope = () => document.querySelector('main, [data-app-scroller]') ?? document.body

/**
 * Reopens the popups a pick sat in, outer → inner: an entity popup from its
 * saved request, a local one by clicking what opened it. True once the
 * innermost is open.
 */
async function reopen(popups: readonly CapturedPopup[]): Promise<boolean> {
  for (const p of popups) {
    const before = openPopups().length
    if (p.request) {
      useModalStore.getState().open(p.request as unknown as EntityModalRequest)
    } else {
      const scope = topPanel() ?? pageScope()
      const opener = await waitFor(() => find(p.opener, null, scope, before > 0))
      if (!(opener instanceof HTMLElement)) return false
      opener.scrollIntoView({ block: 'center' })
      opener.click()
    }
    const opened = await waitFor(() => (openPopups().length > before ? topPanel() : null))
    if (!opened) return false
  }
  return true
}

async function lookFor(mark: Mark) {
  // The route change renders first.
  await sleep(60)
  if (mark.type !== 'pick') return
  const c = mark.capture
  const popups = c.popups ?? []
  const wasInPopup = c.element?.area?.startsWith('popup') ?? false
  const popupName = wasInPopup ? /^popup "(.*)"$/.exec(c.element!.area!)?.[1] ?? 'a popup' : null
  // Start from a clean stack, so the same popups aren't opened twice.
  if (popups.length && useModalStore.getState().stack.length) { useModalStore.getState().closeAll(); await sleep(250) }
  if (popups.length && !(await reopen(popups))) {
    toast.info(`It was inside the "${popupName ?? 'popup'}" popup — couldn't open it by itself; open it to see the spot`)
    return
  }
  if (wasInPopup && !popups.length) {
    // Picked before popups were remembered: never outline a look-alike behind it.
    toast.info(`It was inside the "${popupName}" popup — open it to see the spot`)
    return
  }
  const scope = popups.length ? topPanel() ?? document.body : pageScope()
  const el = await waitFor(() => find(c.element, c.kind === 'selection' ? c.quote ?? null : null, scope, popups.length > 0))
  if (el) outline(el)
  else toast.info("Opened the page — couldn't find that exact spot any more")
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
    if (mark.type === 'pick') void lookFor(mark)
    else if (route === `${pathname}${search}`) toast.info(`Already on ${markLabel(mark).crumbs[0] ?? 'this page'}`)
  }, [navigate, pathname, search, phone])
}
