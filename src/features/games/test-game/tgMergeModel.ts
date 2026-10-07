import type { Game, GamePlatform } from '../types'

// Merging two copies of one retro game into one row: the PREDICTION the
// Compare & merge popup shows before anything is written. Pure and
// import-free at runtime (scripts/verify-tg-merge.cjs).
//
// ⚠ The SAME rules run in the database: supabase/migrations/131_merge_games.sql
// (`merge_games(keep_id, drop_id)`) does the real write in one transaction.
// Change a rule here → change it there too (and the other way round), or the
// preview stops telling the truth about what Merge does.
//
// The rules (owner-approved):
//  - Only retro games merge. A Steam/PlayStation row would come back with the
//    next provider sync, so those are hidden instead.
//  - The kept game's title never changes.
//  - Every platform variant of the removed copy moves to the kept game (the
//    ES-DE sync key lives on the variant, so the handheld keeps matching it).
//    The kept game's primary variant stays primary; moved ones become
//    secondary — unless the kept game has no primary, then the moved primary
//    stays primary.
//  - Text and pictures: only EMPTY fields of the kept game are filled.
//    Genres and modes: the union (case-insensitive, kept game's spelling and
//    order first).
//  - ScreenScraper match (ss_jeu_id, ss_scraped_at, and its stored record) and
//    the IGDB match (every igdb_* / ttb_* column) move as a group, and only
//    when the kept game has no match of its own.
//  - Status, rating: the kept game's. Its status is replaced only when it is
//    Backlog (the default — nothing was chosen) and the other copy has a real
//    choice (Playing, Completed, Dropped, Wishlist).
//  - Notes and game log: the other copy's text is appended below a separator.
//  - Co-op / iconic flags: on when either copy has them.
//  - Play stats: launches and play time are summed; the latest "last played";
//    the earliest start, first play and "added"; the latest finish and sync.
//  - Queue: the better (lower) place when either copy is queued.

/** The fields a merge reads. Everything Game has, with the newer columns optional. */
export type MergeGame = Pick<Game,
  | 'id' | 'title' | 'library' | 'release_year' | 'publisher' | 'developer' | 'description' | 'storyline'
  | 'genres' | 'modes' | 'series_name' | 'play_status' | 'tier' | 'rating' | 'play_order'
  | 'is_coop' | 'coop_notes' | 'is_iconic' | 'play_notes' | 'game_log'
  | 'primary_cover_url' | 'age_rating' | 'players' | 'screenshot_url' | 'fanart_url'
  | 'external_ref' | 'external_source' | 'synced_at' | 'needs_review'
  | 'play_seconds' | 'play_count' | 'last_played_at' | 'started_at' | 'finished_at'
  | 'esde_playcount' | 'esde_last_played' | 'esde_playtime_seconds' | 'created_at'
> & Partial<Pick<Game,
  | 'media' | 'ss_jeu_id' | 'ss_scraped_at' | 'provider_kind' | 'first_played_at'
  | 'igdb_id' | 'igdb_slug' | 'igdb_url' | 'igdb_match' | 'igdb_fetched_at'
  | 'igdb_rating' | 'igdb_rating_count' | 'igdb_critic_rating' | 'igdb_critic_count'
  | 'igdb_total_rating' | 'igdb_total_count' | 'ttb_main_seconds' | 'ttb_extra_seconds' | 'ttb_full_seconds' | 'ttb_count'
>> & { platforms: Pick<GamePlatform, 'id' | 'system' | 'is_primary_variant'>[] }

/** Appended between the kept game's notes and the other copy's. Same text in 131. */
export const MERGE_NOTE_SEPARATOR = '\n\n— From the merged copy —\n'

/** Filled only while empty in the kept game. */
export const FILL_TEXT = [
  'description', 'storyline', 'developer', 'publisher', 'series_name', 'players', 'age_rating',
  'primary_cover_url', 'screenshot_url', 'fanart_url', 'coop_notes', 'tier', 'provider_kind',
] as const

export const IGDB_FIELDS = [
  'igdb_id', 'igdb_slug', 'igdb_url', 'igdb_match', 'igdb_fetched_at', 'igdb_rating', 'igdb_rating_count',
  'igdb_critic_rating', 'igdb_critic_count', 'igdb_total_rating', 'igdb_total_count',
  'ttb_main_seconds', 'ttb_extra_seconds', 'ttb_full_seconds', 'ttb_count',
] as const

const REAL_STATUS = new Set(['playing', 'completed', 'dropped', 'wishlist'])

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')
const fill = <T>(keep: T, other: T): T => (blank(keep) && !blank(other) ? other : keep)
const ms = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null }
function pickTime(a: string | null | undefined, b: string | null | undefined, latest: boolean): string | null {
  const ta = ms(a), tb = ms(b)
  if (ta == null) return tb == null ? null : b ?? null
  if (tb == null) return a ?? null
  return (latest ? tb > ta : tb < ta) ? b ?? null : a ?? null
}
const sum = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
const minOf = (a: number | null | undefined, b: number | null | undefined) => (a == null ? b ?? null : b == null ? a : Math.min(a, b))

/** Union, case-insensitive, first spelling wins; empty → the kept game's own value. */
export function unionList(keep: string[] | null | undefined, other: string[] | null | undefined): string[] | null {
  const seen = new Set<string>(), out: string[] = []
  for (const raw of [...(keep ?? []), ...(other ?? [])]) {
    const v = (raw ?? '').trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase()); out.push(v)
  }
  return out.length ? out : keep ?? null
}

function appendText(keep: string | null, other: string | null): string | null {
  if (blank(other)) return keep
  if (blank(keep)) return other
  return `${keep}${MERGE_NOTE_SEPARATOR}${other}`
}

export type MergedFields = Omit<MergeGame, 'platforms'>

/** The kept row as it will read after the merge (id, title and library unchanged). */
export function mergeFields(keep: MergeGame, other: MergeGame): MergedFields {
  const { platforms: _kp, ...k } = keep
  const { platforms: _op, ...o } = other
  void _kp; void _op
  const out: MergedFields = { ...k }
  const rec = out as unknown as Record<string, unknown>
  for (const f of FILL_TEXT) rec[f] = fill(k[f], o[f])
  out.release_year = k.release_year ?? o.release_year ?? null
  // The provider reference is a pair: never one half from each copy.
  if (blank(k.external_source) && !blank(o.external_source)) { out.external_source = o.external_source; out.external_ref = o.external_ref }
  out.genres = unionList(k.genres, o.genres)
  out.modes = unionList(k.modes, o.modes)
  const emptyMedia = (m: unknown) => m == null || (typeof m === 'object' && Object.keys(m as object).length === 0)
  if (emptyMedia(k.media) && !emptyMedia(o.media)) out.media = o.media

  if (blank(k.ss_jeu_id) && !blank(o.ss_jeu_id)) { out.ss_jeu_id = o.ss_jeu_id; out.ss_scraped_at = o.ss_scraped_at ?? null }
  if (k.igdb_id == null && o.igdb_id != null) for (const f of IGDB_FIELDS) rec[f] = o[f] ?? null

  out.rating = k.rating ?? o.rating ?? null
  out.play_status = k.play_status === 'backlog' && REAL_STATUS.has(o.play_status) ? o.play_status : k.play_status
  out.play_notes = appendText(k.play_notes, o.play_notes)
  out.game_log = appendText(k.game_log, o.game_log)
  out.is_coop = !!(k.is_coop || o.is_coop)
  out.is_iconic = !!(k.is_iconic || o.is_iconic)

  out.esde_playcount = sum(k.esde_playcount, o.esde_playcount)
  out.esde_playtime_seconds = sum(k.esde_playtime_seconds, o.esde_playtime_seconds)
  out.play_count = sum(k.play_count, o.play_count)
  out.play_seconds = sum(k.play_seconds, o.play_seconds)
  out.esde_last_played = pickTime(k.esde_last_played, o.esde_last_played, true)
  out.last_played_at = pickTime(k.last_played_at, o.last_played_at, true)
  out.started_at = pickTime(k.started_at, o.started_at, false)
  out.first_played_at = pickTime(k.first_played_at, o.first_played_at, false)
  out.finished_at = pickTime(k.finished_at, o.finished_at, true)
  out.synced_at = pickTime(k.synced_at, o.synced_at, true)
  out.created_at = pickTime(k.created_at, o.created_at, false) ?? k.created_at
  out.play_order = minOf(k.play_order, o.play_order)
  return out
}

export interface MergeNote { level: 'block' | 'warn' | 'info'; text: string }

export interface MergePlan {
  /** Why Merge is not allowed for this pair; null = allowed. */
  blocked: string | null
  /** Steam/PlayStation in the pair: hiding is the way out. */
  offerHide: boolean
  merged: MergedFields
  /** Variants moving over, and which one is primary afterwards. */
  movedPlatforms: number
  primaryAfter: string | null
  notes: MergeNote[]
}

const LIB: Record<string, string> = { retro: 'Retro', steam: 'Steam', playstation: 'PlayStation' }

/** Everything the popup says about merging `drop` into `keep`. */
export function planMerge(keep: MergeGame, drop: MergeGame): MergePlan {
  const merged = mergeFields(keep, drop)
  const notes: MergeNote[] = []
  let blocked: string | null = null
  const provider = [keep, drop].find(g => g.library !== 'retro')
  if (keep.id === drop.id) blocked = 'Pick two different games.'
  else if (provider) {
    blocked = `${LIB[provider.library] ?? provider.library} games can't be merged: the next ${LIB[provider.library] ?? provider.library} sync would add the removed copy back. Hide the extra copy instead.`
  }
  if (blocked) notes.push({ level: 'block', text: blocked })

  const keepPrimary = keep.platforms.find(p => p.is_primary_variant)
  const dropPrimary = drop.platforms.find(p => p.is_primary_variant)
  const primaryAfter = (keepPrimary ?? dropPrimary)?.system ?? null

  const ss = (g: MergeGame) => (blank(g.ss_jeu_id) ? null : String(g.ss_jeu_id).trim())
  if (ss(keep) && ss(drop) && ss(keep) !== ss(drop)) {
    notes.push({ level: 'warn', text: `Different ScreenScraper matches (#${ss(keep)} and #${ss(drop)}). The kept game's match stays; the other copy's match, its saved record and its scrape history are removed.` })
  } else if (!ss(keep) && ss(drop)) {
    notes.push({ level: 'info', text: `The kept game takes over the other copy's ScreenScraper match (#${ss(drop)}) and its saved record. Its scrape history (Undo of earlier saves) is removed with the copy.` })
  } else if (ss(drop)) {
    notes.push({ level: 'info', text: 'The other copy\'s ScreenScraper record and scrape history are removed with it.' })
  }
  if (keep.igdb_id != null && drop.igdb_id != null && keep.igdb_id !== drop.igdb_id) {
    notes.push({ level: 'warn', text: `Different IGDB matches (${keep.igdb_id} and ${drop.igdb_id}). The kept game's match stays.` })
  } else if (keep.igdb_id == null && drop.igdb_id != null) {
    notes.push({ level: 'info', text: 'The kept game takes over the other copy\'s IGDB match (length and scores).' })
  }
  if (!blank(keep.play_notes) && !blank(drop.play_notes)) {
    notes.push({ level: 'warn', text: 'Both have notes: the other copy\'s notes are added below the kept game\'s, under "From the merged copy".' })
  }
  if (keep.rating != null && drop.rating != null && keep.rating !== drop.rating) {
    notes.push({ level: 'info', text: `Different ratings: the kept game's rating stays.` })
  }
  if (keep.play_status !== drop.play_status && merged.play_status === keep.play_status) {
    notes.push({ level: 'info', text: 'Different statuses: the kept game\'s status stays.' })
  }
  const systems = (g: MergeGame) => new Set(g.platforms.map(p => p.system.trim().toLowerCase()))
  const ks = systems(keep), ds = systems(drop)
  if ([...ds].some(s => !ks.has(s))) {
    notes.push({ level: 'info', text: 'Different platforms: they become one game with every platform listed; the kept game\'s primary platform stays primary.' })
  }
  if (drop.platforms.length) {
    notes.push({ level: 'info', text: `${drop.platforms.length} platform cop${drop.platforms.length === 1 ? 'y moves' : 'ies move'} to the kept game with its handheld pictures and play stats, so the handheld sync keeps finding ${drop.platforms.length === 1 ? 'it' : 'them'}.` })
  }
  if (drop.play_order != null) notes.push({ level: 'info', text: 'Queue: the better of the two places is kept.' })
  return { blocked, offerHide: !!provider && keep.id !== drop.id, merged, movedPlatforms: drop.platforms.length, primaryAfter, notes }
}

/** What changes on the kept row, field by field, for the "Result" column. */
export function changedFields(keep: MergeGame, merged: MergedFields): string[] {
  const k = keep as unknown as Record<string, unknown>, m = merged as unknown as Record<string, unknown>
  return Object.keys(m).filter(f => JSON.stringify(k[f] ?? null) !== JSON.stringify(m[f] ?? null))
}
