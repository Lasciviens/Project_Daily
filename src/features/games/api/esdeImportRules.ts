// The pure half of the ES-DE import, kept OUT of the edge function so it can
// actually be verified.
//
// `supabase/functions/esde-sync/index.ts` is a Deno function and, per this
// repo's deploy convention, is self-contained — it cannot import from `src/`.
// So this module is hand-mirrored INTO it, exactly the arrangement
// `googleTasksOutboxRules.ts` already established for the Google Tasks outbox:
// one file that a throwaway sucrase script can require and assert against, and
// one hand-kept copy in the function. **Change both together.**
//
// Deliberately import-free (no supabase client, no React) for that reason — a
// single live-client import anywhere in the graph is what makes a module
// unrequirable from a plain node script.
//
// What is here is what is easy to get silently wrong and impossible to notice
// from a green deploy: the local-wall-clock timestamp conversion, the 0-1 to
// 0-100 rating rescale, and the difference between an absent number and a zero.
//
// Contract: docs/games/screenscraper-integration.md §10.

export type Naive = { y: number; mo: number; d: number; h: number; mi: number; se: number }

/**
 * ES-DE writes "YYYYMMDDTHHMMSS". Its own "no value" is a string of zeros,
 * which `Date` would happily read as year 0 — treated as absent instead.
 */
export function parseEsdeTimestamp(raw: unknown): Naive | null {
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null
  return { y, mo, d, h, mi, se }
}

/**
 * Resolves a local wall-clock time to a real instant in `timeZone`.
 *
 * ES-DE records no offset, so there is nothing to read off the string itself —
 * a hardcoded +01:00 would be wrong for half the year. Two-pass: guess the
 * instant assuming UTC, read what wall-clock time that instant maps to in the
 * target zone, correct by the difference, repeat once (the offset at the
 * corrected instant can differ from the offset at the guess on either side of
 * a DST transition). The true edge cases — a wall-clock time inside the hour
 * skipped forward, or repeated on fall-back — have no single correct answer by
 * construction and are out of scope, same as `phone-gateway`'s own copy.
 */
export function zonedWallTimeToUtcMs(y: number, mo: number, d: number, h: number, mi: number, se: number, timeZone: string): number {
  const offsetMsAt = (utcMs: number): number => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts: Record<string, string> = {}
    for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== 'literal') parts[p.type] = p.value
    let hour = Number(parts.hour); if (hour === 24) hour = 0
    const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
    return asIfUTC - utcMs
  }
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, se)
  const utc1 = guessUtc - offsetMsAt(guessUtc)
  return guessUtc - offsetMsAt(utc1)
}

export function esdeIso(raw: unknown, tz: string): string | null {
  const p = parseEsdeTimestamp(raw)
  return p ? new Date(zonedWallTimeToUtcMs(p.y, p.mo, p.d, p.h, p.mi, p.se, tz)).toISOString() : null
}

export function esdeDate(raw: unknown): string | null {
  const p = parseEsdeTimestamp(raw)
  if (!p) return null
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`
}

/**
 * Absent and zero are different facts (§10): a missing `<playcount>` means
 * ES-DE wrote nothing, not that the game was launched zero times. Only a real,
 * finite, non-negative number survives.
 */
export function esdeInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export function esdeText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export const isTrue = (v: unknown): boolean => v === true || v === 'true'

/**
 * ES-DE's `<rating>` is a 0-1 decimal; `game_platforms.rating` is 0-100 and
 * CHECKed to that range, so an out-of-range value is DROPPED rather than
 * clamped — clamping would invent a number nobody measured, and the CHECK
 * would reject the row anyway.
 */
export function esdeRating(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 1000) / 10
}

/** ES-DE packs every genre into ONE comma-separated string (§9). */
export function esdeGenres(v: unknown): string[] | null {
  const raw = esdeText(v)
  if (!raw) return null
  const parts = raw.split(',').map(x => x.trim()).filter(Boolean)
  return parts.length > 0 ? parts : null
}

/**
 * The batch-local identity of an ES-DE entry. JSON, not a delimiter-joined
 * string: a ROM path is arbitrary user text and any separator picked by hand
 * is one filename away from colliding.
 */
export const esdeKey = (system: string, path: string): string => JSON.stringify([system, path])

export type EsdeStatRow = {
  esde_playcount?: number | null
  esde_playtime_seconds?: number | null
  esde_last_played?: string | null
}

/**
 * The roll-up that 089's `games.esde_*` columns hold: sum play counts and
 * seconds across a game's variants, take the latest `last_played`.
 *
 * Summing is the only rule that cannot silently discard a real play session.
 * The result stays null when no variant reported anything — "never launched"
 * is not the same claim as "ES-DE recorded 0 launches", and only the second
 * would be a fact we were actually told.
 */
export function rollUpEsdeStats(rows: EsdeStatRow[]): Required<EsdeStatRow> {
  let esde_playcount: number | null = null
  let esde_playtime_seconds: number | null = null
  let esde_last_played: string | null = null
  for (const r of rows) {
    if (r.esde_playcount != null) esde_playcount = (esde_playcount ?? 0) + Number(r.esde_playcount)
    if (r.esde_playtime_seconds != null) esde_playtime_seconds = (esde_playtime_seconds ?? 0) + Number(r.esde_playtime_seconds)
    if (r.esde_last_played && (!esde_last_played || r.esde_last_played > esde_last_played)) esde_last_played = r.esde_last_played
  }
  return { esde_playcount, esde_playtime_seconds, esde_last_played }
}
