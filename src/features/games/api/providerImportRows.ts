// A provider's own list → the rows importProviderGames writes. ONE mapping
// per provider, shared by the Steam/PlayStation tabs and the library's Sync.

import { steamGameHeaderUrl, type SteamGame } from './steamApi'
import { parsePlayDurationMinutes, type PsnPlayedGame } from './psnApi'
import type { ProviderGameInput } from './gamesApi'

/**
 * Steam reports playtime in MINUTES and last-played as a unix timestamp; both
 * are converted so `games.play_seconds` has one unit whatever the provider.
 * The header image is a public CDN URL with no credentials in it (unlike
 * ScreenScraper's), so it can be stored as-is.
 */
export function steamImportRows(games: SteamGame[]): ProviderGameInput[] {
  return games.map(g => ({
    external_ref: String(g.appid),
    title: g.name,
    play_seconds: g.playtime_forever * 60,
    last_played_at: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null,
    primary_cover_url: steamGameHeaderUrl(g.appid),
  }))
}

/** Sony's played-games list, incl. its category (a game or an app) and first launch. */
export function psnImportRows(played: PsnPlayedGame[]): ProviderGameInput[] {
  return played.map(g => ({
    external_ref: g.titleId,
    title: g.localizedName || g.name,
    play_seconds: parsePlayDurationMinutes(g.playDuration) * 60,
    play_count: g.playCount ?? null,
    last_played_at: g.lastPlayedDateTime ?? null,
    primary_cover_url: g.imageUrl ?? null,
    genres: g.concept?.genres ? String(g.concept.genres).split(',').map(x => x.trim()).filter(Boolean) : null,
    provider_kind: g.category ?? null,
    first_played_at: g.firstPlayedDateTime ?? null,
  }))
}
