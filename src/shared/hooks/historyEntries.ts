// Pure decisions for the throwaway history entries overlays push
// (useHistoryDismiss.ts). Import-free on purpose: scripts/verify-history-dead-
// entries.cjs loads it with sucrase.
//
// Every open overlay — a popup, a drawer, a Games sheet, each title step of
// the Media popup — pushes one entry with the page's own address, so Back
// closes the overlay instead of leaving the page. An entry that no open
// overlay owns any more is DEAD: its overlay went away without the entry
// being popped. A link inside a popup buries the popup's entries under the
// new page (the route change closes the popup, but its entries stay between
// the two pages), and a reload forgets every overlay. Landing on a dead entry
// shows the page beneath it, so that Back — or Forward — seemed to do
// nothing. Such a landing is kept from the router and passed over in the
// direction it came from.

export type Dir = 'back' | 'forward'

/** What a history entry's state says about it. */
export interface EntryInfo {
  /** The overlay that pushed the entry; null for a page's own entry. */
  overlay: number | null
  /** The page load that pushed it (overlay ids start again at every load). */
  load: string | null
  /** react-router's position index (`idx`), when it is a finite number. */
  idx: number | null
}

/** An open overlay, as far as these decisions need to know. */
export interface LiveOverlay {
  id: number
  /** False while its push waits for one of our own Backs to land. */
  pushed: boolean
}

/** A hop over a dead entry that has not landed yet. */
export interface PendingHop {
  dir: Dir
  /** The position it should land on, when known. */
  expect: number | null
  /** Entries passed over so far in this run of hops. */
  chain: number
  /**
   * Set when the run began with a Back off a resting dead entry: the run may
   * not stop on the address that entry was showing (nothing would change).
   */
  origin: Resting | null
}

/**
 * Resting on a dead entry — loaded on one (a reload with a popup open), or
 * a Forward with nothing beyond it. It shows the page beneath it.
 */
export interface Resting {
  idx: number | null
  href: string
}

/** No run of hops goes on longer than this, so a broken position index can never loop. */
export const MAX_HOPS = 64

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function readEntry(state: unknown): EntryInfo {
  if (!isRecord(state)) return { overlay: null, load: null, idx: null }
  return {
    overlay: finite(state.__overlay),
    load: typeof state.__overlayLoad === 'string' ? state.__overlayLoad : null,
    idx: finite(state.idx),
  }
}

/**
 * The state for a new overlay entry pushed over `current`. It keeps the
 * page's own router state (location state and key, so the router reads the
 * same location there) and takes the next position index: react-router
 * numbers a page pushed from here `idx + 1`, so every entry's index stays
 * true to its place — that is what tells a Back from a Forward. (Without an
 * index of its own, a link inside a popup gave the new page `NaN`.)
 */
export function overlayEntryState(current: unknown, id: number, load: string): Record<string, unknown> {
  const base = isRecord(current) ? current : {}
  const idx = finite(base.idx)
  return { ...base, ...(idx == null ? {} : { idx: idx + 1 }), __overlay: id, __overlayLoad: load }
}

/**
 * Which way a traversal went. An equal index counts as Back: the position we
 * knew can be one the router has pushed past since (a link from the entry we
 * last saw), and a Forward never lands where it started.
 */
export function travelDirection(landed: number | null, left: number | null): Dir | null {
  if (landed == null || left == null) return null
  return landed <= left ? 'back' : 'forward'
}

/** An overlay entry that no open overlay of this page load owns. A page's own entry is never dead. */
export function isDeadEntry(entry: EntryInfo, load: string, live: readonly LiveOverlay[]): boolean {
  if (entry.overlay == null) return false
  return entry.load !== load || !live.some(o => o.id === entry.overlay)
}

/** Where a one-step hop from `from` lands. */
export function hopTarget(from: number | null, dir: Dir): number | null {
  return from == null ? null : from + (dir === 'back' ? -1 : 1)
}

/** Still the same entry (a hop that never left it). */
export function sameEntry(a: EntryInfo, b: EntryInfo): boolean {
  return a.overlay === b.overlay && a.load === b.load && a.idx === b.idx
}

export interface PopInput {
  landed: EntryInfo
  /** The address landed on. */
  href: string
  load: string
  /** Open overlays, bottom to top. */
  live: readonly LiveOverlay[]
  /** The position index of the entry just left, as last seen. */
  left: number | null
  /** Backs of our own (dropping a closed overlay's entry) still to land. */
  ownPops: number
  hop: PendingHop | null
  resting: Resting | null
}

export interface PopDecision {
  /** The landing of a hop we made. */
  hopLanding: boolean
  /** One of our own entry-dropping Backs (consumes one). */
  ownPop: boolean
  dir: Dir | null
  /** The overlay this Back closes — the top one — or null. */
  close: number | null
  /** Landed on an entry no open overlay owns. */
  dead: boolean
  /** A Back off a resting dead entry reached the very address that entry was showing. */
  unchanged: boolean
  /** Hop on this way, keeping this landing from the router and everything else. */
  hop: Dir | null
  /** Entries passed over in this run, this one included. */
  chain: number
  /** Carry into the next hop of this run (see PendingHop.origin). */
  origin: Resting | null
}

/** What one popstate means and what to do about it. */
export function decidePop(p: PopInput): PopDecision {
  const pending = p.hop
  // A landing where our hop was due is that hop. Anything else while one is
  // pending — a Back pressed meanwhile — is a traversal of its own.
  const hopLanding = pending != null
    && (pending.expect == null || p.landed.idx == null || p.landed.idx === pending.expect)
  const ownPop = !hopLanding && p.ownPops > 0
  const own = hopLanding || ownPop
  const dir = hopLanding && pending ? pending.dir : travelDirection(p.landed.idx, p.left)
  // Only someone else's Back (the user's, or a page's own history.back())
  // closes an overlay, and only the top one. Forward never closes anything.
  const top = p.live[p.live.length - 1]
  const close = !own && dir !== 'forward' && top != null && top.pushed ? top.id : null
  const open = close == null ? p.live : p.live.filter(o => o.id !== close)
  const dead = isDeadEntry(p.landed, p.load, open)
  // One step back off a resting dead entry: whatever this run of hops lands
  // on must show something else than the address that entry was showing.
  const rest = p.resting
  const stepOff = !own && rest != null && dir === 'back' && rest.idx != null && p.left === rest.idx
    && p.landed.idx === rest.idx - 1
  const origin = hopLanding && pending ? pending.origin : stepOff ? rest : null
  const unchanged = !dead && dir === 'back' && origin != null && p.href === origin.href
  const chain = (hopLanding && pending ? pending.chain : 0) + (dead || unchanged ? 1 : 0)
  const hop = (dead || unchanged) && dir != null && chain <= MAX_HOPS ? dir : null
  return { hopLanding, ownPop, dir, close, dead, unchanged, hop, chain, origin: hop ? origin : null }
}
