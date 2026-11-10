// What "Needs a look" remembers (shop_signal_states, migration 190): the signal keys, the rule that keeps a row
// away, the signature Got it stores, and the check of a row read back from the database. Pure —
// scripts/verify-shop-signals.cjs (it also compares SHOP_SIGNALS and SIGNATURE_RE with 190's CHECKs).
import type { ShopSignal, ShopSignalState, ShopSignalStateFields, ShopSignalWrite } from './types'

// Every signal once — a missing or an unknown key is a type error here, so the list and ShopSignal can't drift.
const ALL: Record<ShopSignal, true> = {
  at_target: true, lowest_seen: true, back_in_stock: true, fake_before: true, deal_day: true, cheaper_returnable: true,
  return_closing: true, complaint_ending: true, old_value: true, old_wish: true, tidy_up: true, price_match: true,
}

/** The database's allow-list (190's CHECK on shop_signal_states.signal, with 191's price_match), in its order. */
export const SHOP_SIGNALS = Object.keys(ALL) as ShopSignal[]

export function isShopSignal(x: unknown): x is ShopSignal {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(ALL, x)
}

/** What a signature may be — 1–120 ASCII characters of these, no spaces (190's CHECK, the same text). */
export const SIGNATURE_RE = /^[A-Za-z0-9._:,;=|@#+/-]{1,120}$/
const SIGNATURE_MAX = 120
/** Everything a part can't hold: what the signature refuses, and its own separator. */
const NOT_IN_PART = /[^A-Za-z0-9._:,;=@#+/-]/g

/** A 53-bit string hash as hex (cyrb53): a signature too long for the column folds into one, the same every time. */
function hashHex(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

function partText(p: string | number | boolean | null | undefined): string {
  if (p == null) return '-'
  if (typeof p === 'number') return Number.isFinite(p) ? String(Math.round(p * 100) / 100) : '-'
  if (typeof p === 'boolean') return p ? '1' : '0'
  return p.normalize('NFKD').replace(NOT_IN_PART, '') || '-'
}

/**
 * The signature of what a row says now, from its facts ("at_target|NOK|6990", "return_closing|2026-11-15"): Got it
 * stores it, and the row stays away while it is the same. Each part keeps only what the database takes (a
 * number to two decimals; nothing = "-"), joined with "|"; a longer one folds into a hash. Always valid for 190.
 */
export function signalSignature(...parts: (string | number | boolean | null | undefined)[]): string {
  const text = parts.map(partText).join('|')
  return text.length <= SIGNATURE_MAX && SIGNATURE_RE.test(text) ? text : `h:${hashHex(text)}`
}

/** A row's place in the states list: one per thing (or the page), signal and subject (a deal day's slug, or none). */
export function signalStateKey(itemId: string | null, signal: ShopSignal, subject: string | null = null): string {
  return `${signal}:${itemId ?? 'page'}${subject ? `:${subject}` : ''}`
}

/** The states by signalStateKey. */
export function signalStateMap(states: readonly ShopSignalState[]): Map<string, ShopSignalState> {
  return new Map(states.map(s => [signalStateKey(s.item_id, s.signal, s.subject), s]))
}

/** What a subject may be: a deal day's slug (190's CHECK, the same text). */
export const SUBJECT_RE = /^[a-z][a-z0-9_]{0,39}$/

/**
 * Whether a row stays away on `today` (yyyy-mm-dd, the app's day): snoozed until a later day — it comes back on
 * that day — or Got it was said to this very signature (a new price or deadline makes a new one).
 */
export function isSignalHidden(
  state: Pick<ShopSignalState, 'snoozed_until' | 'signature'> | null | undefined, signature: string | null, today: string,
): boolean {
  if (!state) return false
  if (state.snoozed_until && today < state.snoozed_until) return true
  return state.signature != null && signature != null && state.signature === signature
}

/** The fields an Undo writes back: the row's own state, its id and first time. */
export function stateFields(s: ShopSignalState): ShopSignalStateFields {
  return { id: s.id, created_at: s.created_at, signature: s.signature, snoozed_until: s.snoozed_until, dismissed_at: s.dismissed_at }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const time = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID_RE.test(x)
}

/**
 * A row read back from the database, checked where it enters: null for one this app can't use — an unknown
 * signal (a newer database), a malformed id, day or time, or a Got it without its time.
 */
export function parseSignalState(row: unknown): ShopSignalState | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (!isUuid(r.id) || !isUuid(r.user_id) || !isShopSignal(r.signal)) return null
  if (r.item_id != null && !isUuid(r.item_id)) return null
  const subject = r.subject == null ? null : str(r.subject)
  if (subject !== null && !SUBJECT_RE.test(subject)) return null
  const snoozed = r.snoozed_until == null ? null : str(r.snoozed_until)
  if (snoozed !== null && !DAY_RE.test(snoozed)) return null
  const signature = r.signature == null ? null : str(r.signature)
  const dismissed = r.dismissed_at == null ? null : time(r.dismissed_at)
  if ((signature === null) !== (dismissed === null) || (signature !== null && !SIGNATURE_RE.test(signature))) return null
  const created = time(r.created_at), updated = time(r.updated_at)
  if (!created || !updated) return null
  return {
    id: r.id, user_id: r.user_id, item_id: (r.item_id as string | null) ?? null, signal: r.signal, subject,
    signature, snoozed_until: snoozed, dismissed_at: dismissed, created_at: created, updated_at: updated,
  }
}

/**
 * A write's answer ({"before", "after"}); a side that isn't a usable row is null — and `beforeUnknown` says
 * there was a row before that this app can't read back, so an Undo can't put it back (it must not delete it).
 */
export function parseSignalWrite(data: unknown): ShopSignalWrite {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const before = parseSignalState(d.before)
  return { before, after: parseSignalState(d.after), beforeUnknown: before === null && d.before != null }
}
