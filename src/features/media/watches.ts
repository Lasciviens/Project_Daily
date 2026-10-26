// Every watch keeps its own date (migration 149, docs/features/media.md):
// the watches of one episode or movie as the screens show and pick them, and
// rewatch rounds. Pure (scripts/verify-media-watches.cjs).

import { formatDate, toLocalDate, type DateValue } from '../../shared/utils/dateFormat'
import { isUnknownWatchedAt } from './trakt/traktDates'

export interface Watch {
  id: string
  watched_at: string | null
  /** Linked to its Trakt play (set by the sync). */
  trakt_history_id?: number | null
  source?: 'app' | 'trakt' | 'backfill'
  created_at?: string
}

/** Oldest first; a watch on an unknown date (the epoch, or NULL on a movie) comes first. */
export function sortWatches<W extends Watch>(watches: readonly W[]): W[] {
  const t = (w: Watch) => (!w.watched_at || isUnknownWatchedAt(w.watched_at) ? -1 : Date.parse(w.watched_at))
  return [...watches].sort((a, b) => t(a) - t(b) || a.id.localeCompare(b.id))
}

/** "12.10.2018", or "date unknown". */
export const watchDate = (w: Watch) => (!w.watched_at || isUnknownWatchedAt(w.watched_at) ? 'date unknown' : formatDate(w.watched_at))

/**
 * A placeholder: the one date the app kept before 149, copied once per play,
 * not linked to Trakt's real play yet. While Trakt is connected and its whole
 * history hasn't been read (`traktWaits`, useWatchesWaitForTrakt) it waits for
 * Trakt's dates and can't be changed or removed — which Trakt play it stands
 * for isn't known; the database refuses it too (149's lock).
 */
export const isPlaceholder = (w: Watch, traktWaits: boolean) =>
  traktWaits && w.source === 'backfill' && w.trakt_history_id == null

/** The watches a date change or a removal may act on. */
export const editableWatches = <W extends Watch>(watches: readonly W[], traktWaits: boolean): W[] =>
  watches.filter(w => !isPlaceholder(w, traktWaits))

/**
 * The dates a movie shows: every one up to three, else the first and the two
 * latest around "…" — "12.10.2018 · 01.12.2024 · 08.01.2026".
 */
export function watchDates(watches: readonly Watch[]): string {
  const all = sortWatches(watches).map(watchDate)
  if (all.length <= 3) return all.join(' · ')
  return [all[0], '…', ...all.slice(-2)].join(' · ')
}

/** One watch: "Watched 08.01.2026", or "Watched · date unknown". */
export const watchedOnce = (w: Watch) => (watchDate(w) === 'date unknown' ? 'Watched · date unknown' : `Watched ${watchDate(w)}`)

/** What an episode row (or a movie) shows of its watches — `watchMark`. */
export interface WatchMark {
  /** Reads as watched (✓, tint): it has a watch — during a rewatch round, a watch of the round. */
  done: boolean
  /** The ×N counter from 2 watches — every watch ever, as many as its watch list holds; null below 2. */
  counter: number | null
  /** One watch: "Watched 12.10.2018" (2+ show the counter instead). */
  line: string
  /** The line reads as done (the success tone): outside a round only — during one, a watch is history, not status. */
  lineDone: boolean
}

/**
 * What a row shows of its watches (owner, 26.10.2026: "When re-watching, don't
 * show everything green. Show a counter instead"). Outside a round: watched =
 * done, one watch says its date, 2+ show ×N. During a round (`roundStartedAt`):
 * done only with a watch of the round (`inRound`, the database's rule), the
 * count stays every watch ever, and nothing reads green but the round's ✓.
 */
export function watchMark(watches: readonly Watch[], roundStartedAt?: string | null): WatchMark {
  const n = watches.length
  return {
    done: n > 0 && (!roundStartedAt || watchedInRound(watches, roundStartedAt)),
    counter: n >= 2 ? n : null,
    line: n === 1 ? watchedOnce(watches[0]) : '',
    lineDone: n === 1 && !roundStartedAt,
  }
}

/**
 * Watches in a time range, split by what was watched — "this week: 5 episodes
 * · 1 film". Every watch counts on its own date; one on an unknown date (NULL,
 * or the epoch) is in no range. `from` is in the range, `to` is the first
 * moment after it (this week = Monday to next Monday); a bare 'yyyy-MM-dd' is
 * local midnight.
 */
export function watchTally(
  watches: readonly { kind: 'episode' | 'movie'; watched_at: string | null }[],
  from: DateValue,
  to: DateValue,
): { total: number; episodes: number; movies: number } {
  const start = toLocalDate(from)?.getTime() ?? NaN
  const end = toLocalDate(to)?.getTime() ?? NaN
  const out = { total: 0, episodes: 0, movies: 0 }
  for (const w of watches) {
    if (!w.watched_at || isUnknownWatchedAt(w.watched_at)) continue
    const t = Date.parse(w.watched_at)
    if (!(t >= start && t < end)) continue
    out.total++
    if (w.kind === 'movie') out.movies++
    else out.episodes++
  }
  return out
}

export type WatchPick = 'latest' | 'first'

/** The watch a date change acts on: the latest (the default) or the first. */
export function pickWatch<W extends Watch>(watches: readonly W[], which: WatchPick = 'latest'): W | null {
  const s = sortWatches(watches)
  return (which === 'first' ? s[0] : s[s.length - 1]) ?? null
}

/** The watch a "which one?" answer names: one by id (when it is still there), else the latest or first. */
export function watchFor<W extends Watch>(watches: readonly W[], answer: WatchPick | { id: string }): W | null {
  if (typeof answer === 'object') return watches.find(w => w.id === answer.id) ?? pickWatch(watches, 'latest')
  return pickWatch(watches, answer)
}

/**
 * The watches of a row read before migration 149 (no watch list came back):
 * one per play, all at the kept date, with no ids — shown only, never written.
 */
export function cacheWatches(row: { id: string; watched_at: string | null; repeat_count?: number | null }): Watch[] {
  if (row.watched_at == null && row.repeat_count == null) return []
  return Array.from({ length: 1 + Math.max(0, row.repeat_count ?? 0) }, (_, i) => ({ id: `${row.id}#${i}`, watched_at: row.watched_at }))
}

// ── Rewatching (migration 149's rewatch_round + rewatch_started_at) ──────────

export interface RoundEpisode { season: number; episode: number }
const key = (e: RoundEpisode) => `${e.season}x${e.episode}`
const sec = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : NaN)

/**
 * The round a rewatch starts (its number on screen): one more than the fewest
 * watches of the regular episodes watched so far — all watched once → 2.
 */
export function rewatchStartRound(counts: number[]): number {
  const regular = counts.filter(n => n > 0)
  return (regular.length ? Math.min(...regular) : 1) + 1
}

/**
 * A watch of the round: dated since it started, or added in the app since then
 * (a rewatch logged on an unknown or earlier date) — the database's rule.
 */
export function inRound(w: Watch, startedAt: string): boolean {
  const start = sec(startedAt)
  return sec(w.watched_at) >= start || (w.source === 'app' && sec(w.created_at) >= start)
}

/** Watched in a round: at least one watch of the round. */
export function watchedInRound(watches: readonly Watch[], startedAt: string): boolean {
  return watches.some(w => inRound(w, startedAt))
}

/** The episodes done in a round ("SxE"): those with a watch of the round. */
export function doneInRound(rows: { season_number: number; episode_number: number; watches?: readonly Watch[] }[], startedAt: string): Set<string> {
  const out = new Set<string>()
  for (const r of rows) if (r.watches && watchedInRound(r.watches, startedAt)) out.add(`${r.season_number}x${r.episode_number}`)
  return out
}

/**
 * The next episode of a rewatch round: the first aired regular episode, in
 * watching order, not done in the round (a pilot watched three times before
 * doesn't count; one never watched counts the same). null = round finished.
 */
export function nextInRound(aired: RoundEpisode[], done: Set<string>): RoundEpisode | null {
  const order = aired.filter(e => e.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode)
  return order.find(e => !done.has(key(e))) ?? null
}

/** How far a round is: aired regular episodes done in it, of all of them. */
export function roundProgress(aired: RoundEpisode[], done: Set<string>): { done: number; total: number } {
  const regular = aired.filter(e => e.season > 0)
  return { done: regular.filter(e => done.has(key(e))).length, total: regular.length }
}

/**
 * Every aired regular episode in watching order, from TMDB's seasons and last
 * aired episode (specials left out). Without a last aired episode, every
 * episode TMDB lists.
 */
export function airedRegularEpisodes(details: {
  seasons?: { season_number: number; episode_count: number }[] | null
  last_episode_to_air?: { season_number: number; episode_number: number } | null
}): RoundEpisode[] {
  const last = details.last_episode_to_air ?? null
  const out: RoundEpisode[] = []
  for (const s of [...(details.seasons ?? [])].sort((a, b) => a.season_number - b.season_number)) {
    if (s.season_number <= 0) continue
    if (last && s.season_number > last.season_number) continue
    const n = last && s.season_number === last.season_number ? Math.min(s.episode_count, last.episode_number) : s.episode_count
    for (let e = 1; e <= n; e++) out.push({ season: s.season_number, episode: e })
  }
  return out
}

type CountedRow = { season_number: number; episode_number: number; watched_at: string | null; repeat_count?: number | null; watches?: readonly Watch[] }

/** Watches per episode ("SxE" → count). */
export function watchCounts(rows: readonly CountedRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.watched_at == null) continue
    out.set(`${r.season_number}x${r.episode_number}`, r.watches?.length || 1 + Math.max(0, r.repeat_count ?? 0))
  }
  return out
}

/** A show's rewatches (its "N episodes rewatched" pill): episodes watched more than once, and their watches past the first. */
export function rewatchTotals(rows: readonly CountedRow[]): { episodes: number; extraWatches: number } {
  const out = { episodes: 0, extraWatches: 0 }
  for (const n of watchCounts(rows).values()) {
    if (n < 2) continue
    out.episodes++
    out.extraWatches += n - 1
  }
  return out
}
