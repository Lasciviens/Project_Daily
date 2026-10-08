#!/usr/bin/env node
/*
 * Verification — dead overlay history entries (src/shared/hooks/historyEntries.ts).
 *
 * Every open overlay pushes a throwaway history entry so Back closes it. A
 * link inside a popup used to leave the popup's entries behind the new page:
 * Back from that page landed on one (the page beneath it, nothing changed on
 * screen) and needed a second press. The pure decisions behind the fix are
 * checked here against the REAL module (loaded via sucrase — the repo has no
 * unit-test runner by convention):
 *   1. entry states — reading them, and the state a new overlay entry gets
 *      (the router's own state kept, the next position index);
 *   2. direction and deadness;
 *   3. decidePop, case by case — Back and Forward onto a dead entry, a live
 *      overlay's entry (never passed over), stacked dead entries, our own
 *      Backs, entries from an older page load, unknown positions, the hop cap,
 *      and the "resting on a dead entry" rule;
 *   4. whole sequences on a simulated history driven by decidePop the way
 *      useHistoryDismiss drives it (open, link out of a popup, Back, Forward).
 *
 *   Run:  node scripts/verify-history-dead-entries.cjs
 */
require('sucrase/register')

const {
  readEntry, overlayEntryState, travelDirection, isDeadEntry, hopTarget, sameEntry, decidePop, MAX_HOPS,
} = require('../src/shared/hooks/historyEntries')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const json = v => JSON.stringify(v)

const LOAD = 'load-1'
const HREF_A = 'https://x/#/a'
const HREF_B = 'https://x/#/b'
const page = (idx) => ({ overlay: null, load: null, idx })
const ov = (id, idx, load = LOAD) => ({ overlay: id, load, idx })
const pop = (over) => decidePop({
  landed: page(0), href: HREF_A, load: LOAD, live: [], left: null, ownPops: 0, hop: null, resting: null, ...over,
})

console.log('\n== 1. entry states ==')
{
  check('a router entry reads as a page entry', json(readEntry({ usr: null, key: 'k1', idx: 3 })) === json({ overlay: null, load: null, idx: 3 }))
  check('an overlay entry reads its id, load and index', json(readEntry({ __overlay: 4, __overlayLoad: LOAD, idx: 5 })) === json({ overlay: 4, load: LOAD, idx: 5 }))
  check('an entry from before this fix (no load mark) still reads as an overlay entry', json(readEntry({ __overlay: 2 })) === json({ overlay: 2, load: null, idx: null }))
  check('null state (a fresh tab) reads as a page entry with no index', json(readEntry(null)) === json({ overlay: null, load: null, idx: null }))
  check('a NaN index (a link from an old overlay entry) reads as unknown', readEntry({ idx: NaN }).idx === null)

  const routerState = { usr: { mediaSearch: true }, key: 'abc', idx: 7, masked: undefined }
  const s = overlayEntryState(routerState, 9, LOAD)
  check('a new overlay entry keeps the page\'s location state and key', s.usr && s.usr.mediaSearch === true && s.key === 'abc')
  check('… takes the next position index', s.idx === 8)
  check('… and carries its id and page-load mark', s.__overlay === 9 && s.__overlayLoad === LOAD)
  check('… without touching the state it was built from', routerState.idx === 7 && routerState.__overlay === undefined)
  const nested = overlayEntryState(s, 10, LOAD)
  check('an overlay over an overlay: next index again, its own id', nested.idx === 9 && nested.__overlay === 10 && nested.key === 'abc')
  check('an unknown base index stays unknown (never a made-up number)', readEntry(overlayEntryState({ idx: NaN }, 1, LOAD)).idx === null)
  check('no base state at all: still a marked overlay entry', readEntry(overlayEntryState(null, 1, LOAD)).overlay === 1)
}

console.log('\n== 2. direction and deadness ==')
{
  check('a lower index is a Back', travelDirection(4, 5) === 'back')
  check('a higher index is a Forward', travelDirection(6, 5) === 'forward')
  check('the same index counts as a Back (the router pushed past what we saw)', travelDirection(5, 5) === 'back')
  check('an unknown index: no direction', travelDirection(null, 5) === null && travelDirection(4, null) === null)
  const live = [{ id: 3, pushed: true }]
  check('a page\'s own entry is never dead', isDeadEntry(page(2), LOAD, []) === false)
  check('an open overlay\'s entry is live', isDeadEntry(ov(3, 2), LOAD, live) === false)
  check('a closed overlay\'s entry is dead', isDeadEntry(ov(4, 2), LOAD, live) === true)
  check('the same id from an older page load is dead', isDeadEntry(ov(3, 2, 'older'), LOAD, live) === true)
  check('hopTarget steps one back / forward, unknown stays unknown',
    hopTarget(5, 'back') === 4 && hopTarget(5, 'forward') === 6 && hopTarget(null, 'back') === null)
  check('sameEntry: the same overlay entry', sameEntry(ov(3, 4), ov(3, 4)) === true)
  check('sameEntry: a page entry at that place is another entry', sameEntry(ov(3, 4), page(4)) === false)
  check('sameEntry: another position is another entry', sameEntry(ov(3, 4), ov(3, 5)) === false)
}

console.log('\n== 3. decidePop ==')
{
  // Back from an open popup's entry to the page: closes it, nothing to pass.
  let d = pop({ landed: page(3), left: 4, live: [{ id: 1, pushed: true }] })
  check('Back from a popup: closes the top overlay', d.close === 1 && d.dir === 'back')
  check('… lands on the page, nothing dead, no hop', !d.dead && d.hop === null)

  // Nested: Back from the sheet lands on the review's (live) entry.
  d = pop({ landed: ov(1, 4), left: 5, live: [{ id: 1, pushed: true }, { id: 2, pushed: true }] })
  check('Back from a nested popup closes only the top one', d.close === 2)
  check('… and the live overlay entry it lands on is NOT passed over', !d.dead && d.hop === null)

  // A link inside a popup: [A 3, popup 4, B 5]; the popup closed with the route change.
  d = pop({ landed: ov(1, 4), left: 5, live: [] })
  check('Back from the new page onto the popup\'s dead entry: dead', d.dead === true && d.dir === 'back')
  check('… hops on backwards', d.hop === 'back' && d.chain === 1)
  check('… and closes nothing', d.close === null)

  // Forward from A onto the same dead entry.
  d = pop({ landed: ov(1, 4), left: 3, live: [] })
  check('Forward onto a dead entry: hops on forwards', d.dead && d.dir === 'forward' && d.hop === 'forward')

  // Forward never closes an open overlay, even landing on a dead entry above it.
  d = pop({ landed: ov(2, 5), left: 4, live: [{ id: 1, pushed: true }] })
  check('Forward with a popup open closes nothing', d.close === null && d.hop === 'forward')

  // A dead entry buried under an open popup: [A 3, X(dead) 4, Y 5]; Back from Y.
  d = pop({ landed: ov(1, 4), left: 5, live: [{ id: 2, pushed: true }] })
  check('Back onto a dead entry under an open popup closes that popup', d.close === 2)
  check('… and hops on past the dead entry', d.dead && d.hop === 'back')

  // Stacked dead entries (the Media popup and its title steps): [A 3, s 4, s1 5, s2 6, B 7].
  d = pop({ landed: ov(3, 6), left: 7 })
  check('stacked dead entries: the first landing hops back (chain 1)', d.hop === 'back' && d.chain === 1)
  d = pop({ landed: ov(2, 5), left: 6, hop: { dir: 'back', expect: 5, chain: 1, origin: null } })
  check('… the hop lands on the next dead one: ours, hops on (chain 2)', d.hopLanding && d.hop === 'back' && d.chain === 2)
  d = pop({ landed: ov(1, 4), left: 5, hop: { dir: 'back', expect: 4, chain: 2, origin: null } })
  check('… and the next (chain 3)', d.hopLanding && d.hop === 'back' && d.chain === 3)
  d = pop({ landed: page(3), left: 4, hop: { dir: 'back', expect: 3, chain: 3, origin: null } })
  check('… until the page: the hop lands there and stops', d.hopLanding && !d.dead && d.hop === null)
  check('… and a hop landing never closes an overlay', pop({ landed: page(3), left: 4, live: [{ id: 9, pushed: true }], hop: { dir: 'back', expect: 3, chain: 1, origin: null } }).close === null)

  // A hop that lands on a live overlay's entry stops there.
  d = pop({ landed: ov(1, 3), left: 4, live: [{ id: 1, pushed: true }], hop: { dir: 'back', expect: 3, chain: 1, origin: null } })
  check('a hop landing on an open popup\'s entry stops (never passes a live entry)', !d.dead && d.hop === null && d.close === null)

  // Our own entry-dropping Back.
  d = pop({ landed: ov(1, 4), left: 5, live: [{ id: 1, pushed: true }], ownPops: 1 })
  check('our own Back (X on the top popup) consumes one and closes nothing', d.ownPop && d.close === null && !d.dead)
  d = pop({ landed: ov(7, 4), left: 5, live: [], ownPops: 1 })
  check('our own Back landing on a dead entry hops on backwards', d.ownPop && d.dead && d.hop === 'back')

  // A Back pressed while a Forward hop is still pending is the user's own.
  d = pop({ landed: page(3), left: 4, live: [], hop: { dir: 'forward', expect: 5, chain: 1, origin: null } })
  check('a landing where the hop was not due is a traversal of its own', !d.hopLanding && d.dir === 'back')

  // An older page load's entry with an id that is open now.
  d = pop({ landed: ov(1, 4, 'older'), left: 5, live: [{ id: 1, pushed: true }] })
  check('an entry from before a reload is dead even when its id is open now', d.dead && d.hop === 'back')

  // Unknown positions: no guessing which way to go.
  d = pop({ landed: { overlay: 1, load: LOAD, idx: null }, left: 5, live: [] })
  check('a dead entry with an unknown position is left as it is (no hop)', d.dead && d.hop === null)
  d = pop({ landed: page(null), left: null, live: [{ id: 1, pushed: true }] })
  check('… and a Back with unknown positions still closes the top popup', d.close === 1)

  // A deferred (not yet pushed) top overlay: a Back closes nothing.
  d = pop({ landed: page(3), left: 4, live: [{ id: 1, pushed: true }, { id: 2, pushed: false }] })
  check('a top overlay still waiting to push its entry is not closed by a Back', d.close === null)

  // Back landing on the top popup's own entry (buried under a page): it closes, and its entry is dead.
  d = pop({ landed: ov(1, 4), left: 5, live: [{ id: 1, pushed: true }] })
  check('Back onto the top popup\'s own entry (under a page) closes it', d.close === 1)
  check('… and passes over the entry it no longer owns', d.dead && d.hop === 'back')

  // The hop cap.
  d = pop({ landed: ov(1, 4), left: 5, live: [], hop: { dir: 'back', expect: 4, chain: MAX_HOPS, origin: null } })
  check('the hop run stops at MAX_HOPS', d.dead && d.hop === null)

  // Resting on a dead entry (a reload with a popup open): [A 3, D 4].
  const resting = { idx: 4, href: HREF_A }
  d = pop({ landed: page(3), href: HREF_A, left: 4, resting })
  check('Back off a resting dead entry onto the page it showed: unchanged, hop on', d.unchanged && d.hop === 'back' && d.chain === 1)
  d = pop({ landed: page(3), href: HREF_B, left: 4, resting })
  check('… onto a different address: a real Back, no hop', !d.unchanged && d.hop === null)
  d = pop({ landed: page(2), href: HREF_A, left: 4, resting })
  check('… a jump of two (the history menu): a real Back, no hop', !d.unchanged && d.hop === null)
  d = pop({ landed: page(5), href: HREF_A, left: 4, resting })
  check('… a Forward off it: no hop', !d.unchanged && d.hop === null)
  d = pop({ landed: page(3), href: HREF_A, left: 4, resting })
  check('… the run remembers where it began', d.origin === resting)
  d = pop({ landed: page(3), href: HREF_A, left: 6, resting })
  check('… but not when the Back left another entry (the resting note is stale)', !d.unchanged && d.hop === null)

  // A Back off a resting dead entry that lands on another dead entry first.
  d = pop({ landed: ov(5, 3), href: HREF_A, left: 4, resting })
  check('off a resting entry onto another dead one: hop, keeping where the run began', d.dead && d.hop === 'back' && d.origin === resting)
  d = pop({ landed: page(2), href: HREF_A, left: 3, hop: { dir: 'back', expect: 2, chain: 1, origin: resting } })
  check('… that run does not stop on the address the resting entry showed', d.hopLanding && d.unchanged && d.hop === 'back' && d.chain === 2)
  d = pop({ landed: page(1), href: HREF_B, left: 2, hop: { dir: 'back', expect: 1, chain: 2, origin: resting } })
  check('… and stops on the first page that shows something else', d.hopLanding && !d.unchanged && d.hop === null && d.origin === null)
  d = pop({ landed: page(3), href: HREF_A, left: 4, hop: { dir: 'back', expect: 3, chain: 1, origin: null } })
  check('a run from a page (a link out of a popup) stops on the first page, same address or not', !d.unchanged && d.hop === null)
}

console.log('\n== 4. sequences on a simulated history ==')
// A tiny browser history + router + overlay registry, driven by decidePop
// exactly the way useHistoryDismiss.ts drives it. `shown` is what the router
// renders: it moves with pushes, replaces and every popstate that is not kept
// from it.
function makeWorld() {
  const w = {
    entries: [{ state: { usr: null, key: 'a', idx: 0 }, href: HREF_A }],
    cur: 0,
    shown: HREF_A,
    routerPops: 0,
    stack: [], nextId: 0, ownPops: 0, hop: null, lastIdx: 0, resting: null,
    queue: [],
  }
  const state = () => w.entries[w.cur].state
  const href = () => w.entries[w.cur].href
  w.historyPush = (s, h) => { w.entries.splice(w.cur + 1); w.entries.push({ state: s, href: h ?? href() }); w.cur++ }
  w.go = (n) => { w.queue.push(n) }
  // Drain queued traversals, firing popstate after each. One with nothing
  // there fires nothing (a pending hop then waits for w.timeout()).
  w.settle = () => {
    let guard = 0
    while (w.queue.length && guard++ < 500) {
      const to = w.cur + w.queue.shift()
      if (to < 0 || to >= w.entries.length) continue
      w.cur = to
      w.onPop()
    }
  }
  // HOP_WAIT_MS passing with the hop never landed: the router is shown the
  // entry we are on, and that entry becomes where we rest.
  w.timeout = () => {
    if (!w.hop) return
    w.hop = null
    w.shown = href()
    const here = readEntry(state())
    w.resting = isDeadEntry(here, LOAD, w.stack) ? { idx: here.idx, href: href() } : null
  }
  w.onPop = () => {
    const landed = readEntry(state())
    const d = decidePop({ landed, href: href(), load: LOAD, live: w.stack, left: w.lastIdx, ownPops: w.ownPops, hop: w.hop, resting: w.resting })
    w.lastIdx = landed.idx
    if (d.ownPop) w.ownPops--
    w.hop = null
    if (d.close != null) { const at = w.stack.findIndex(o => o.id === d.close); w.stack.splice(at, 1) }
    if (d.hop) {
      w.hop = { dir: d.hop, expect: hopTarget(landed.idx, d.hop), chain: d.chain, origin: d.origin }
      w.resting = { idx: landed.idx, href: href() }
      w.go(d.hop === 'back' ? -1 : 1)
      return // kept from the router
    }
    w.resting = d.dead ? { idx: landed.idx, href: href() } : null
    w.routerPops++
    w.shown = href()
  }
  // The router: a link (push) from wherever the history is now.
  w.navigate = (h) => {
    const idx = (state() && typeof state().idx === 'number' ? state().idx : NaN) + 1
    w.historyPush({ usr: null, key: 'k' + h, idx }, h)
    w.shown = h
    w.lastIdx = readEntry(state()).idx // noteRouterNavigation
    w.resting = null
  }
  // An overlay opening (useHistoryDismiss with open = true).
  w.open = () => {
    const o = { id: ++w.nextId, pushed: false }
    w.stack.push(o)
    w.historyPush(overlayEntryState(state(), o.id, LOAD))
    o.pushed = true
    w.lastIdx = readEntry(state()).idx
    w.resting = null
    return o.id
  }
  // An overlay closing by other means (X, Save, a route change unmounting it).
  w.closeOther = (id) => {
    const at = w.stack.findIndex(o => o.id === id)
    if (at === -1) return
    w.stack.splice(at, 1)
    const here = readEntry(state())
    if (here.overlay === id && here.load === LOAD) { w.ownPops++; w.go(-1) }
  }
  w.back = () => { w.go(-1); w.settle() }
  w.forward = () => { w.go(1); w.settle() }
  w.isOpen = id => w.stack.some(o => o.id === id)
  return w
}

{
  // The reported bug: a link inside a popup, then Back.
  const w = makeWorld()
  w.navigate('https://x/#/home')                 // [A, H]
  const p = w.open()                             // [A, H, popup]
  w.navigate(HREF_B)                             // "Go to" inside the popup
  w.closeOther(p)                                // the route change closes the popup
  w.settle()
  check('link out of a popup: the popup closed, no Back of ours was spent', !w.isOpen(p) && w.ownPops === 0 && w.shown === HREF_B)
  w.back()
  check('ONE Back from the new page returns to the page the popup was on', w.shown === 'https://x/#/home' && w.entries[w.cur].href === 'https://x/#/home')
  check('… landing on that page\'s own entry, not the popup\'s', readEntry(w.entries[w.cur].state).overlay === null)
  check('… and the router saw only the final landing', w.routerPops === 1)
  w.forward()
  check('ONE Forward goes to the new page again', w.shown === HREF_B && readEntry(w.entries[w.cur].state).overlay === null)
  w.back(); w.back()
  check('two Backs: home, then the first page', w.shown === HREF_A)
}

{
  // The Media popup with two title steps (n + 1 entries), then a link out.
  const w = makeWorld()
  const shell = w.open(); const s1 = w.open(); const s2 = w.open()   // [A, shell, s1, s2]
  w.navigate(HREF_B)
  for (const id of [s2, s1, shell]) w.closeOther(id)
  w.settle()
  check('Media popup + 2 steps, link out: all three entries left behind', w.entries.length === 5 && w.ownPops === 0)
  w.back()
  check('ONE Back passes all three dead entries to the page', w.shown === HREF_A && w.cur === 0)
  w.forward()
  check('ONE Forward passes them again to the new page', w.shown === HREF_B && w.cur === 4)
}

{
  // Media's in-popup trail still steps back title by title.
  const w = makeWorld()
  const shell = w.open(); const s1 = w.open(); const s2 = w.open()
  w.back()
  check('Back inside the Media popup closes only the last title step', !w.isOpen(s2) && w.isOpen(s1) && w.isOpen(shell))
  w.back()
  check('… then the previous one', !w.isOpen(s1) && w.isOpen(shell))
  w.back()
  check('… then the popup itself, on the page', !w.isOpen(shell) && w.cur === 0 && w.shown === HREF_A)
}

{
  // Nested popups closed by X: our own Backs never close what is underneath.
  const w = makeWorld()
  const review = w.open(); const sheet = w.open()
  w.closeOther(sheet); w.settle()
  check('X on a sheet over a review: the review stays open', w.isOpen(review) && !w.isOpen(sheet))
  check('… and the history is back on the review\'s entry', readEntry(w.entries[w.cur].state).overlay === review)
  w.back()
  check('the next Back closes the review', !w.isOpen(review) && w.cur === 0)
}

{
  // A popup closed by other means while buried under a newer one.
  const w = makeWorld()
  const x = w.open(); const y = w.open()   // [A, x, y]
  w.closeOther(x); w.settle()               // x's entry stays, buried
  w.back()
  check('Back from the top popup over a buried dead entry closes it', !w.isOpen(y))
  check('… and lands on the page in the same press', w.cur === 0 && w.shown === HREF_A)
}

{
  // Forward after closing a popup with Back: nothing lies beyond its dead entry.
  const w = makeWorld()
  w.navigate(HREF_B)                        // [A, B]
  const p = w.open()                        // [A, B, popup]
  w.back()                                  // closes it: [A, B*, popup(dead)]
  check('Back closed the popup', !w.isOpen(p) && w.cur === 1)
  w.forward()                               // onto the dead entry; nothing beyond it
  check('Forward onto a trailing dead entry changes nothing on screen', w.shown === HREF_B && w.hop != null)
  w.timeout()
  check('… the hop never lands; the page stays the same', w.shown === HREF_B && w.hop === null)
  w.back()
  check('… and the next Back is a real one (to the page before)', w.shown === HREF_A && w.cur === 0)
}

{
  // The same, with Back pressed before the Forward hop has given up.
  const w = makeWorld()
  w.navigate(HREF_B)
  w.open()
  w.back()
  w.forward()
  w.back()
  check('Back pressed while that Forward hop is still pending is a real one too', w.shown === HREF_A && w.cur === 0)
}

{
  // A Forward across dead entries with nothing beyond them, then Back.
  const w = makeWorld()
  w.navigate(HREF_B)
  const x = w.open(); const y = w.open()   // [A, B, x, y]
  w.back(); w.back()                        // closes y, then x
  check('two Backs closed both popups', !w.isOpen(x) && !w.isOpen(y) && w.cur === 1)
  w.forward(); w.timeout()
  check('Forward runs over both dead entries and stays on the page', w.shown === HREF_B && w.cur === 3)
  w.back()
  check('… one Back from there goes to the page before', w.shown === HREF_A && w.cur === 0)
}

{
  // Reload with a popup open: [A, B, popup] and the page loads on the popup's entry.
  const w = makeWorld()
  w.navigate(HREF_B)
  w.open()
  w.stack = []                              // a reload forgets every overlay…
  w.resting = { idx: readEntry(w.entries[w.cur].state).idx, href: w.entries[w.cur].href }
  w.lastIdx = w.resting.idx
  w.shown = w.entries[w.cur].href
  w.back()
  check('after a reload on a popup\'s entry, ONE Back leaves the page it showed', w.shown === HREF_A && w.cur === 0)
}

{
  // An open popup's entry is never skipped, even right after passing dead ones.
  const w = makeWorld()
  const p = w.open()                        // [A, p]
  w.navigate(HREF_B)                        // a link out, but p stays open (not an entity popup)
  w.back()                                  // lands on p's own entry: it closes and is passed over
  check('Back onto an open drawer\'s own entry (under a page) closes it and returns to the page', !w.isOpen(p) && w.shown === HREF_A && w.cur === 0)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
