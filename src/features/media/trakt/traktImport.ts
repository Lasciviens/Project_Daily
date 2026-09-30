import { supabase } from '../../../integrations/supabase/client'
import { tmdbFetch } from '../../../integrations/tmdb/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { upsertMovie } from '../api/moviesApi'
import { upsertTVSeries } from '../api/tvApi'
import type { TMDBMovie, TMDBTVSeries } from '../types'
import { fetchLocalLibraryForTrakt, fetchTraktSnapshot, pushToTrakt } from './traktApi'
import { airedEpisodes, buildImportPlan, pushCount, showsNeedingInfo, type ShowInfo } from './traktImportPlan'
import type { TraktItem } from './traktTypes'

// Runs the import the plan describes (docs/trakt/PLAN.md phase 2). Every
// write is an upsert keyed on the table's own unique key, so running it again
// is safe: an interrupted import is finished by pressing Import again.
// Order: the library first, Trakt last — a failed push leaves the app-only
// facts in place, and the next run plans them again.

export interface ImportResult {
  movies: number
  shows: number
  episodes: number
  sent: number
  tally: Record<string, number>
  droppedOnlyHere: number
}

type Progress = (step: string) => void
type ShowDetails = TMDBTVSeries & {
  seasons?: { season_number: number; episode_count: number }[]
  last_episode_to_air?: { season_number: number; episode_number: number } | null
}

const BATCH = 500
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/** Runs `fn` over `items`, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

/** tmdb_id → catalogue row id, creating the rows the library doesn't have yet from TMDB. */
async function catalogIds(table: 'movies' | 'tv_series', tmdbIds: number[], details: Map<number, unknown>): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  for (const part of chunk(tmdbIds, 200)) {
    const { data, error } = await supabase.from(table).select('id, tmdb_id').in('tmdb_id', part)
    if (error) throw error
    for (const r of data ?? []) map.set(r.tmdb_id as number, r.id as string)
  }
  const missing = tmdbIds.filter(id => !map.has(id))
  await pool(missing, 5, async id => {
    const d = details.get(id) ?? await tmdbFetch<unknown>(`/${table === 'movies' ? 'movie' : 'tv'}/${id}`)
    const row = table === 'movies' ? await upsertMovie(d as TMDBMovie) : await upsertTVSeries(d as TMDBTVSeries)
    map.set(id, row.id)
  })
  return map
}

/** Fills trakt/imdb/tvdb ids on the catalogue rows; a clash with another row is skipped, never forced. */
async function backfillIds(items: TraktItem[]) {
  await pool(items, 5, async i => {
    const patch: Record<string, unknown> = { trakt_id: i.ids.trakt || null, trakt_slug: i.ids.slug, imdb_id: i.ids.imdb }
    if (i.type === 'show') patch.tvdb_id = i.ids.tvdb
    const { error } = await supabase.from(i.type === 'movie' ? 'movies' : 'tv_series').update(patch).eq('tmdb_id', i.ids.tmdb!)
    if (error && error.code !== '23505') throw error
  })
}

export async function runTraktImport(progress: Progress): Promise<ImportResult> {
  const user = await requireUser()
  progress('Reading Trakt and your library…')
  const [snap, local] = await Promise.all([fetchTraktSnapshot(), fetchLocalLibraryForTrakt()])

  progress('Checking which shows are finished…')
  const details = new Map<number, ShowDetails>()
  const info = new Map<number, ShowInfo>()
  await pool(showsNeedingInfo(snap, local), 5, async id => {
    try {
      const d = await tmdbFetch<ShowDetails>(`/tv/${id}`)
      details.set(id, d)
      info.set(id, { aired: airedEpisodes(d) })
    } catch { /* no TMDB details: the show stays Watching, never guessed Completed */ }
  })
  const plan = buildImportPlan(snap, local, info)

  progress(`Adding ${plan.movies.length} movies and ${plan.shows.length} shows…`)
  const movieIds = await catalogIds('movies', plan.movies.map(m => m.tmdbId), new Map())
  const showIds = await catalogIds('tv_series', plan.shows.map(s => s.tmdbId), details as Map<number, unknown>)
  const now = new Date().toISOString()

  for (const part of chunk(plan.movies, BATCH)) {
    const { error } = await supabase.from('user_movie_entries').upsert(part.map(m => ({
      user_id: user.id, movie_id: movieIds.get(m.tmdbId), status: m.status, repeat_count: m.repeatCount,
      watched_at: m.watchedAt, rating: m.rating, watchlist_rank: m.watchlistRank, trakt_synced_at: now,
    })), { onConflict: 'user_id,movie_id' })
    if (error) throw error
  }
  const entryBySeries = new Map<string, string>()
  for (const part of chunk(plan.shows, BATCH)) {
    const { data, error } = await supabase.from('user_tv_entries').upsert(part.map(s => ({
      user_id: user.id, tv_series_id: showIds.get(s.tmdbId), status: s.status, rating: s.rating,
      watchlist_rank: s.watchlistRank, trakt_synced_at: now,
    })), { onConflict: 'user_id,tv_series_id' }).select('id, tv_series_id')
    if (error) throw error
    for (const r of data ?? []) entryBySeries.set(r.tv_series_id as string, r.id as string)
  }

  progress(`Saving ${plan.episodes.length} watched episodes…`)
  for (const part of chunk(plan.episodes, BATCH)) {
    const rows = part.flatMap(e => {
      const series = showIds.get(e.tmdbId)
      const entry = series && entryBySeries.get(series)
      return series && entry ? [{
        user_id: user.id, tv_entry_id: entry, tv_series_id: series, season_number: e.season,
        episode_number: e.episode, watched_at: e.watchedAt, repeat_count: e.repeatCount,
      }] : []
    })
    const { error } = await supabase.from('user_tv_episodes').upsert(rows, { onConflict: 'user_id,tv_series_id,season_number,episode_number' })
    if (error) throw error
  }

  progress('Filling in Trakt ids…')
  await backfillIds(plan.ids)

  const sent = pushCount(plan.push)
  progress(sent ? `Sending ${sent} changes to Trakt (one per second)…` : 'Recording the sync…')
  const { tally } = await pushToTrakt(plan.push, true)

  return { movies: plan.movies.length, shows: plan.shows.length, episodes: plan.episodes.length, sent, tally, droppedOnlyHere: plan.droppedOnlyHere }
}
