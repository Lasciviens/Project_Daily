import { useEffect, useRef } from 'react'
import {
  decidePop, hopTarget, isDeadEntry, overlayEntryState, readEntry, sameEntry,
  type Dir, type EntryInfo, type PendingHop, type Resting,
} from './historyEntries'

interface Overlay {
  id: number
  pushed: boolean
  close: () => void
}

// Overlays open right now, bottom to top. Only the TOP one reacts to a Back:
// with a sheet opened over a review, one Back closes the sheet and leaves the
// review alone (before, every open overlay's listener closed on every pop).
const stack: Overlay[] = []
let nextId = 0
// Overlay ids start again at every page load; each entry carries this load's
// mark, so one left from before a reload is never taken for an open overlay's.
const LOAD = Math.random().toString(36).slice(2, 10)
// history.back() calls made to drop our OWN entry when an overlay closes by
// other means (X, Save, unmount). Their popstate must not close anything else.
let ownPops = 0
// A hop over a dead entry that has not landed yet (see historyEntries.ts).
let hop: PendingHop | null = null
let hopTimer = 0
// How long a hop may take. A Forward hop that never lands had nothing beyond.
const HOP_WAIT_MS = 600
// The current entry's position index, as last seen: popstate, our own
// pushes, and the router's pushes and replaces (noteRouterNavigation).
let lastIdx: number | null = null
// Resting on a dead entry, which shows the page beneath it.
let resting: Resting | null = null
// Overlays waiting to push their entry until our own pending pops have landed.
// history.back() is asynchronous: pushing in the same moment (a sheet closing
// as the dialog it launched opens) left the new overlay with no entry of its
// own, so the next Back left the page instead of closing it.
const deferred: (() => void)[] = []
// Address writes waiting for the history to be back on a page's own entry
// (see whenHistorySettled).
const settled: (() => void)[] = []

function busy(): boolean {
  return ownPops > 0 || hop != null
}

function current(): EntryInfo {
  return readEntry(window.history.state)
}

function ownedByOpenOverlay(entry: EntryInfo): boolean {
  return entry.overlay != null && entry.load === LOAD && stack.some(o => o.id === entry.overlay)
}

/** The current entry is a page's own — not an open overlay's throwaway one, no own pop or hop pending. */
function onPageEntry(): boolean {
  return !busy() && !ownedByOpenOverlay(current())
}

function flushSettled() {
  while (settled.length && onPageEntry()) settled.shift()!()
}

function flushDeferred() {
  while (deferred.length && !busy()) deferred.shift()!()
}

// Address writes first, so an overlay pushed now carries the new address.
function settle() {
  if (busy()) return
  flushSettled()
  flushDeferred()
}

function endHop() {
  if (!hop) return
  hop = null
  window.clearTimeout(hopTimer)
}

function restingHere(): Resting | null {
  const here = current()
  return isDeadEntry(here, LOAD, stack) ? { idx: here.idx, href: window.location.href } : null
}

// A popstate of our own making, for the router only (onPopState ignores it).
let replaying = false
function replayPop() {
  replaying = true
  try {
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  } finally {
    replaying = false
  }
}

function startHop(dir: Dir, from: EntryInfo, chain: number, origin: Resting | null) {
  hop = { dir, expect: hopTarget(from.idx, dir), chain, origin }
  // Until the hop lands, this dead entry is where we are: a Back pressed in
  // the meantime (a Forward with nothing beyond) must still pass its page.
  resting = { idx: from.idx, href: window.location.href }
  hopTimer = window.setTimeout(() => {
    hop = null
    // Never landed: a Forward with nothing beyond the dead entries (or a
    // browser that dropped the step). The router never saw this entry —
    // show it the entry we are on, so page and address agree — and let the
    // next Back off it pass the page it shows.
    if (sameEntry(current(), from)) replayPop()
    resting = restingHere()
    settle()
  }, HOP_WAIT_MS)
  window.history.go(dir === 'back' ? -1 : 1)
}

function closeOverlay(id: number) {
  const at = stack.findIndex(o => o.id === id)
  if (at === -1) return
  const [overlay] = stack.splice(at, 1)
  try {
    overlay.close()
  } catch (err) {
    // Report it without dropping the rest of this popstate's handling.
    window.setTimeout(() => { throw err })
  }
}

// Registered once, before the router's own listener (this module loads with
// the app, the router listens once mounted), so it runs first in every
// popstate: it closes the top overlay on a Back, lets whenHistorySettled fix
// the address before the router reads it, and keeps a dead entry from the
// router altogether. (At its target an event's listeners run in the order
// they were added; capture only puts this first where an engine runs capture
// listeners first.)
function onPopState(event: PopStateEvent) {
  if (replaying) return
  const landed = current()
  const d = decidePop({
    landed, href: window.location.href, load: LOAD, live: stack,
    left: lastIdx, ownPops, hop, resting,
  })
  lastIdx = landed.idx
  if (d.ownPop) ownPops--
  endHop()
  if (d.close != null) closeOverlay(d.close)
  if (d.hop) {
    // A dead entry (or a page no different from the one just shown): the
    // router would only show the page beneath it for a moment. Pass over it.
    event.stopImmediatePropagation()
    startHop(d.hop, landed, d.chain, d.origin)
    return
  }
  resting = d.dead ? { idx: landed.idx, href: window.location.href } : null
  settle()
}

if (typeof window !== 'undefined') {
  const here = current()
  lastIdx = here.idx
  // Loaded on an overlay's entry (a reload, the update reload with a popup
  // open): nothing is open any more, so it shows the page beneath it.
  if (here.overlay != null) resting = { idx: here.idx, href: window.location.href }
  window.addEventListener('popstate', onPopState, true)
  import.meta.hot?.dispose(() => window.removeEventListener('popstate', onPopState, true))
}

/**
 * The router has moved to an entry of its own by a push or a replace
 * (popstate landings are seen above). AppShell calls this after every such
 * navigation, so the position known here stays the real one.
 */
export function noteRouterNavigation(): void {
  if (typeof window === 'undefined') return
  const here = current()
  lastIdx = here.idx
  if (here.overlay == null) resting = null
}

/**
 * Runs `fn` once the history is on a page's own entry: straight away when it
 * already is, otherwise inside the popstate that gets back there, before the
 * router reads the address. For a page that mirrors its state into the
 * address (Games' `?section=&platform=`): replacing the address while an
 * overlay's entry is current rewrote that throwaway entry, and the overlay's
 * own Back then landed on the page entry's old address — the address fell out
 * of step with the page, and the page then followed the stale address back.
 * Returns a cancel function (call it on unmount, or before queueing a newer write).
 */
export function whenHistorySettled(fn: () => void): () => void {
  if (typeof window === 'undefined' || onPageEntry()) {
    fn()
    return () => {}
  }
  settled.push(fn)
  // A pending pop that never arrives: run anyway once no open overlay's entry
  // is current. Long enough that a slow Back still lands first.
  const fallback = window.setTimeout(() => {
    if (ownedByOpenOverlay(current())) return
    const i = settled.indexOf(fn)
    if (i !== -1) { settled.splice(i, 1); fn() }
  }, 1000)
  return () => {
    window.clearTimeout(fallback)
    const i = settled.indexOf(fn)
    if (i !== -1) settled.splice(i, 1)
  }
}

/**
 * Native "Back closes the overlay" (#6). While `open`, pushes a throwaway
 * history entry so the hardware / browser Back button — and the iOS edge-swipe
 * back gesture — pops it and fires `onClose` instead of navigating the app away.
 * Closing by any other means (X / backdrop / unmount) rolls our entry back so
 * the history stack stays balanced and a subsequent real Back still works —
 * and that roll-back is never mistaken for a Back by the overlay underneath
 * (or by one that opens in the same moment, e.g. "Open the game" after a save).
 * An entry that can't be rolled back — buried under a newer overlay's entry,
 * or under a page a link inside the popup opened — stays behind dead, and
 * Back and Forward pass over it (onPopState).
 */
export function useHistoryDismiss(open: boolean, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const overlay: Overlay = { id: ++nextId, pushed: false, close: () => close.current() }
    const push = () => {
      // A push cuts off everything ahead: a Forward hop can't land any more.
      endHop()
      window.history.pushState(overlayEntryState(window.history.state, overlay.id, LOAD), '')
      overlay.pushed = true
      lastIdx = current().idx
      resting = null
    }
    stack.push(overlay)
    let fallback = 0
    if (busy()) {
      deferred.push(push)
      // If the pending pop never arrives (nothing to go back to), push anyway.
      fallback = window.setTimeout(() => {
        const at = deferred.indexOf(push)
        if (at !== -1) { deferred.splice(at, 1); push() }
      }, 400)
    } else {
      push()
    }

    return () => {
      window.clearTimeout(fallback)
      const waiting = deferred.indexOf(push)
      if (waiting !== -1) deferred.splice(waiting, 1)
      const at = stack.indexOf(overlay)
      if (at === -1) return // a Back already popped our entry
      stack.splice(at, 1)
      // Closed WITHOUT a Back nav: drop our own entry if it is the current one.
      // (Buried under a newer overlay's entry, or under a page a link inside
      // the popup opened, it stays behind dead and Back passes over it.)
      const here = current()
      if (overlay.pushed && here.overlay === overlay.id && here.load === LOAD) {
        ownPops++
        window.history.back()
      }
    }
  }, [open])
}
