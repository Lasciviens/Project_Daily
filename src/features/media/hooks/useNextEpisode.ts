import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchWatchedEpisodes } from '../api/watchedEpisodesApi'
import { fetchRewatchRound } from '../api/tvApi'
import { getSeasonDetails, getTVSeasons } from '../api/tmdbApi'
import { airedRegularEpisodes, nextInRound, roundProgress, watchCounts } from '../watches'

// "What should I watch next?" computed from ACTUAL watched-episode rows
// (user_tv_episodes), not from the entry's cached counters — the cache was
// stale for months (see migration 050) and this hook must stay correct even
// if it goes stale again. TMDB season data supplies the episode title/air
// date and the season boundary (when the next episode rolls into S+1).
//
// Watching it again (migration 149's rewatch_round): next is the first aired
// regular episode watched fewer times than the round (all watched once,
// round 2 → S01E01; after its second watch → S01E02), and `rewatch` says how
// far the round is. Marking it adds a watch (`again`), never moves a date.
export interface NextEpisodeInfo {
  caughtUp:      boolean
  season:        number | null   // null when caught up
  episode:       number | null
  episodeTitle:  string | null
  airDate:       string | null   // ISO date; future = not yet released
  released:      boolean
  watchedCount:  number
  totalEpisodes: number | null   // series-wide, from tv_series when known
  lastWatched:   { season: number; episode: number } | null
  /** A rewatch under way: its round and how far it is (episodes at the round, of the aired ones). */
  rewatch?:      { round: number; done: number; total: number } | null
}

async function withEpisode(tmdbId: number, season: number, episode: number) {
  try {
    const ep = (await getSeasonDetails(tmdbId, season)).episodes?.find(e => e.episode_number === episode)
    const airDate = ep?.air_date ?? null
    return { episodeTitle: ep?.name ?? null, airDate, released: airDate != null ? airDate <= new Date().toISOString().slice(0, 10) : false }
  } catch {
    return { episodeTitle: null, airDate: null, released: true }
  }
}

async function computeNextEpisode(
  tvEntryId: string,
  tmdbId: number,
  totalEpisodes: number | null,
): Promise<NextEpisodeInfo> {
  const [watched, round] = await Promise.all([fetchWatchedEpisodes(tvEntryId), fetchRewatchRound(tvEntryId)])
  const watchedCount = watched.length

  // Max watched (season, episode) — rows arrive sorted asc by season, episode.
  const last = watched.length > 0 ? watched[watched.length - 1] : null
  const lastWatched = last ? { season: last.season_number, episode: last.episode_number } : null

  const base = { watchedCount, totalEpisodes, lastWatched }

  if (round) {
    try {
      const aired = airedRegularEpisodes(await getTVSeasons(tmdbId))
      const counts = watchCounts(watched)
      const rewatch = { round, ...roundProgress(aired, counts, round) }
      const next = nextInRound(aired, counts, round)
      if (!next) return { ...base, rewatch, caughtUp: true, season: null, episode: null, episodeTitle: null, airDate: null, released: false }
      return { ...base, rewatch, caughtUp: false, season: next.season, episode: next.episode, ...(await withEpisode(tmdbId, next.season, next.episode)) }
    } catch {
      // TMDB unreachable: the round's place can't be known — fall through to the plain next episode.
    }
  }

  // Nothing watched yet → next is simply S1E1.
  let candSeason  = last ? last.season_number : 1
  let candEpisode = last ? last.episode_number + 1 : 1

  // Does the candidate exist in its season? If past the season's end, roll
  // into the next season's E1; if THAT season doesn't exist either → caught up.
  try {
    let seasonData = await getSeasonDetails(tmdbId, candSeason)
    if (candEpisode > (seasonData.episodes?.length ?? 0)) {
      candSeason += 1
      candEpisode = 1
      try {
        seasonData = await getSeasonDetails(tmdbId, candSeason)
      } catch {
        return { ...base, caughtUp: true, season: null, episode: null, episodeTitle: null, airDate: null, released: false }
      }
      if ((seasonData.episodes?.length ?? 0) === 0) {
        return { ...base, caughtUp: true, season: null, episode: null, episodeTitle: null, airDate: null, released: false }
      }
    }
    const ep = seasonData.episodes?.find(e => e.episode_number === candEpisode)
    const airDate = ep?.air_date ?? null
    return {
      ...base,
      caughtUp:     false,
      season:       candSeason,
      episode:      candEpisode,
      episodeTitle: ep?.name ?? null,
      airDate,
      released:     airDate != null ? airDate <= new Date().toISOString().slice(0, 10) : false,
    }
  } catch {
    // TMDB unreachable — still return the computed position, just without
    // title/air-date enrichment (better than an empty card).
    return { ...base, caughtUp: false, season: candSeason, episode: candEpisode, episodeTitle: null, airDate: null, released: true }
  }
}

export function useNextEpisode(
  tvEntryId: string | null,
  tmdbId: number | null,
  totalEpisodes: number | null,
) {
  return useQuery({
    queryKey: qk.media.nextEpisode(tvEntryId ?? ''),
    queryFn:  () => computeNextEpisode(tvEntryId!, tmdbId!, totalEpisodes ?? null),
    enabled:  !!tvEntryId && !!tmdbId,
    staleTime: STALE.short,
  })
}
