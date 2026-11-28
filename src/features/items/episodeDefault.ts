// A show's plan gets its next episode by default (owner, 28.11.2026: "when I select the tv serie it should by default
// bring next episode"). The next episode is the app's one rule (media/hooks/useNextEpisode, Daily's Watch next and the
// Media page's); this file only says when its answer is one to fill in, and remembers where the owner cleared it.

import type { NextEpisodeInfo } from '../media/hooks/useNextEpisode'

/** The episode to fill in, or none: all watched, nothing aired yet, or TMDB's season data not loaded (no air date). */
export function episodeDefault(next: NextEpisodeInfo | null | undefined): { season: number; episode: number } | null {
  if (!next || next.caughtUp || next.season == null || next.episode == null) return null
  if (!next.released || !next.airDate) return null
  return { season: next.season, episode: next.episode }
}

/** The items whose episode the owner cleared on the item screen: never filled again when they open (this account's —
 *  cleared at sign-out, security/accountState.ts). */
export const EPISODE_CLEARED_KEY = 'lasci.items.episodeCleared'
const MAX_KEPT = 200

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(EPISODE_CLEARED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-MAX_KEPT) : []
  } catch { return [] }
}

export function episodeCleared(taskId: string): boolean {
  return read().includes(taskId)
}

/** The owner cleared (true) or set (false) the episode of a saved item. */
export function rememberEpisodeCleared(taskId: string, cleared: boolean): void {
  try {
    const rest = read().filter(id => id !== taskId)
    localStorage.setItem(EPISODE_CLEARED_KEY, JSON.stringify(cleared ? [...rest, taskId].slice(-MAX_KEPT) : rest))
  } catch { /* storage full or off: the screen's own memory still holds for this visit */ }
}
