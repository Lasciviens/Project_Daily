import type { PlayStatus } from '../../types'
import { ALL_PLATFORMS } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import type { ScrapeBatchState } from '../testGameStore'
import type { TgaLibrary } from './tgAnalyticsModel'

// Where an Analytics row takes you. Every hand-off starts from a clean Library
// (no search, no leftover filter) so the list you land on is exactly the one
// the number described. Setters are read at click time, never subscribed to.

const act = useTestGameStore.getState

/** The shelf a library maps to: Steam and PlayStation have their own; retro spans many, so All. */
export function libraryPlatform(library: TgaLibrary): string {
  return library === 'steam' || library === 'playstation' ? library : ALL_PLATFORMS
}

/**
 * Opens the Library narrowed to one thing: a platform shelf, a status, a
 * genre or a studio — on the analytics library's shelf when it has one.
 */
export function openLibrary(o: { library?: TgaLibrary; platform?: string; status?: PlayStatus; genre?: string; studio?: string }): void {
  const s = act()
  s.setSearch('')
  s.setSection('library')
  const platform = o.platform ?? libraryPlatform(o.library ?? 'all')
  if (platform !== ALL_PLATFORMS) s.setPlatform(platform)
  if (o.status) s.setStatus(o.status)
  if (o.genre) s.setGenre(o.genre)
  if (o.studio) s.setStudios([o.studio])
}

/** Opens the Scrape page's batch mode on a filter ("no cover", "no description", …). */
export function openScrapeBatch(filter: ScrapeBatchState['filter']): void {
  const s = act()
  s.updateScrapeBatch({ filter, system: '' })
  s.setSection('scrape')
  s.setScrapeMode('batch')
}

/** Opens Advanced → Needs review. */
export function openNeedsReview(): void {
  act().setAdvancedTab('review')
}
