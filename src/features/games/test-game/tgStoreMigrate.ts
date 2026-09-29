// The Games page store's persisted-state upgrades, kept import-free (type
// imports only) so scripts/verify-test-game-model.cjs can run them through
// sucrase without zustand or a browser.

export const TG_STORE_VERSION = 4

const ADVANCED_KEYS = ['review', 'steam', 'playstation']

/** The persisted fields a migration may touch. */
export interface TgPersisted {
  section?: string
  platform?: string
  sort?: string
  advancedTab?: string
  [key: string]: unknown
}

/**
 * v1: Last played became the default sort. A saved "Title" was only ever the
 * old default, so it moves over once; any other choice stays.
 * v2: Classic library, Tiers, Queue editor and Add & random left Advanced; a
 * saved one of those lands on Needs review.
 * v3: ScreenScraper left Advanced for its own Scrape page.
 * v4: the "Others" platform row is gone (every platform is listed), so a saved
 * Others shelf opens All Games.
 */
export function migrateTgPersisted(persisted: unknown, version: number): TgPersisted {
  const p = { ...((persisted ?? {}) as TgPersisted) }
  if (version < 1 && (p.sort == null || p.sort === 'title')) p.sort = 'recent'
  if (version < 3 && !ADVANCED_KEYS.includes(p.advancedTab as string)) {
    // A saved ScreenScraper tab opens the page that replaced it.
    if (p.advancedTab === 'scraper' && p.section === 'advanced') p.section = 'scrape'
    p.advancedTab = 'review'
  }
  if (version < 4 && p.platform === 'others') p.platform = 'all'
  return p
}
