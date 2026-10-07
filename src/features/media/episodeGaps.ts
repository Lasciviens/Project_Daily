// Pure (scripts/verify-media-episode-gaps.cjs): what an episode list shows
// about Trakt's paused playbacks and episodes skipped in a season.
import type { TraktPlaybackItem } from './trakt/traktApi'

/** Episode → paused percent (rounded) for one show's season, from Trakt's playback list. */
export function pausedEpisodes(items: TraktPlaybackItem[] | undefined, showTmdbId: number, season: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const i of items ?? []) {
    if (i.type !== 'episode' || i.tmdb !== showTmdbId || i.season !== season || i.episode == null) continue
    const pct = Math.round(Math.min(100, Math.max(0, i.progress)))
    // Two playbacks of one episode: the furthest one.
    out.set(i.episode, Math.max(out.get(i.episode) ?? 0, pct))
  }
  return out
}

/** Aired, unwatched episodes numbered before the season's last watched one, in order. */
export function seasonGaps(episodes: { episode_number: number; air_date?: string | null }[], watched: Set<number>, today: string): number[] {
  const last = Math.max(0, ...watched)
  return episodes
    .filter(e => e.episode_number < last && !watched.has(e.episode_number) && !!e.air_date && e.air_date <= today)
    .map(e => e.episode_number)
    .sort((a, b) => a - b)
}
