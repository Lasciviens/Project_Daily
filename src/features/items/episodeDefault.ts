// A show's plan gets its next episode by default (owner, 28.11.2026: "when I select the tv serie it should by default
// bring next episode"). The next episode is the app's one rule (media/hooks/useNextEpisode, Daily's Watch next and the
// Media page's); this file only says when its answer is one to fill in. Only a pick in the item screen's Show search
// fills it (DetailsSection.ShowEpisode) — never opening an item with a show and no episode (a whole-show plan).

import type { NextEpisodeInfo } from '../media/hooks/useNextEpisode'

/** The episode to fill in, or none: all watched, nothing aired yet, or TMDB's season data not loaded (no air date). */
export function episodeDefault(next: NextEpisodeInfo | null | undefined): { season: number; episode: number } | null {
  if (!next || next.caughtUp || next.season == null || next.episode == null) return null
  if (!next.released || !next.airDate) return null
  return { season: next.season, episode: next.episode }
}
