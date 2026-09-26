import type { PlayStatus } from '../../types'
import { ALL_PLATFORMS } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import type { ScrapeBatchState } from '../testGameStore'
import type { TgaLibrary } from './tgAnalyticsModel'

// Where an Analytics row takes you. Every hand-off starts from a clean Library
// (no search, no leftover filter) so the list you land on is exactly the one
// the number described. Setters are read at click time, never subscribed to.

const act = useTestGameStore.getState

/**
 * The tapped row unmounts with Analytics, which drops focus on the page body.
 * Two frames later (the Library has rendered) focus moves to the visible page
 * heading, so a keyboard or screen-reader user lands at the top of the list
 * with its "N of M games" line right below.
 */
export function focusPageHeading(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const hs = document.querySelectorAll<HTMLElement>('.tg-root [data-tg-heading]')
    const h = [...hs].find(el => el.offsetParent !== null)
    h?.focus({ preventScroll: true })
  }))
}

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
  focusPageHeading()
}

/** Opens the Scrape page's batch mode on a filter ("no cover", "no description", …). */
export function openScrapeBatch(filter: ScrapeBatchState['filter']): void {
  const s = act()
  s.updateScrapeBatch({ filter, system: '' })
  s.setSection('scrape')
  s.setScrapeMode('batch')
  focusPageHeading()
}

/** Opens Advanced → Needs review. */
export function openNeedsReview(): void {
  act().setAdvancedTab('review')
  focusPageHeading()
}

/**
 * Opens the Library on EXACTLY these games — the ones behind an Analytics
 * number — with a removable "from Analytics" note in the header. The window
 * and a Retro-only view have no Library filter of their own, so a plain
 * status/genre/studio filter opened a longer list than the number said.
 * `platform` (a single-platform row) also lights that shelf; `status: 'hidden'`
 * is needed for hidden games, which no other status shows.
 */
export function openLibraryWith(o: { ids: readonly string[]; label: string; platform?: string; status?: PlayStatus }): void {
  const s = act()
  s.setSearch('')
  s.setSection('library')
  if (o.platform && o.platform !== ALL_PLATFORMS) s.setPlatform(o.platform)
  if (o.status) s.setStatus(o.status)
  // Last: navigation clears it.
  s.setLibraryScope({ ids: [...o.ids], label: o.label })
  focusPageHeading()
}
