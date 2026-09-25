import { useMemo } from 'react'
import { useSteamAppDetails } from '../../hooks/useSteam'
import { useStableValue } from './useStableValue'

// Store metadata that fills the gaps of a Steam row in the detail panel.
//
// Steam rows arrive from the provider import with a title and playtime but
// usually no description, studio or screenshots; the store page has them, and
// `steam-api` caches it in `steam_apps`. Non-Steam rows never make a request.

export interface SteamExtras {
  description?: string
  developer?: string
  publisher?: string
  genre?: string
  /** `path_thumbnail` of every store screenshot (≈600px wide). */
  screenshots: string[]
  /** `path_full` of the same screenshots, index-aligned with `screenshots`. */
  fullScreenshots: string[]
}

const EMPTY: SteamExtras = { screenshots: [], fullScreenshots: [] }

/** `short_description` is HTML ("&quot;", "<br>") — the panel shows text. */
function toPlainText(html: string | undefined): string | undefined {
  if (!html) return undefined
  const text = typeof DOMParser === 'undefined'
    ? html.replace(/<[^>]*>/g, ' ')
    : new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean || undefined
}

const firstText = (list: string[] | undefined) => list?.map(s => s.trim()).find(Boolean)

export function useSteamExtras(steamAppId: number | null): SteamExtras {
  // Debounced so arrowing past ten Steam games does not queue ten store
  // lookups against Steam's ~200-requests / 5-minutes limit.
  const stableId = useStableValue(steamAppId)
  const query = useSteamAppDetails(stableId)
  const details = stableId === steamAppId ? query.data?.details ?? null : null

  return useMemo<SteamExtras>(() => {
    if (steamAppId == null || !details) return EMPTY
    const shots = (details.screenshots ?? []).filter(s => s.path_thumbnail && s.path_full)
    return {
      description: toPlainText(details.short_description),
      developer: firstText(details.developers),
      publisher: firstText(details.publishers),
      genre: details.genres?.map(g => g.description?.trim()).find(Boolean),
      screenshots: shots.map(s => s.path_thumbnail),
      fullScreenshots: shots.map(s => s.path_full),
    }
  }, [steamAppId, details])
}
