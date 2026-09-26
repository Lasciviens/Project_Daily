// What a Steam/PlayStation re-import may write onto a row that already exists.
// Import-free, so scripts/verify-provider-import.cjs can require it directly.

export interface ProviderIncoming {
  title: string
  play_seconds?: number | null
  play_count?: number | null
  last_played_at?: string | null
  primary_cover_url?: string | null
  release_year?: number | null
  genres?: string[] | null
}

export interface ProviderExistingRow {
  title: string | null
  primary_cover_url: string | null
  genres: string[] | null
  release_year: number | null
  play_seconds: number | null
  play_count: number | null
  last_played_at: string | null
}

const blank = (v: unknown) =>
  v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)

/**
 * The provider's play figures always win (it is their record of your play);
 * a figure it no longer reports keeps the stored one instead of turning null.
 * Title, cover, genres and year are only FILLED when the stored value is
 * empty — a corrected title, a chosen cover or genres from ScreenScraper are
 * never reset by "Refresh playtime". (Steam sends no genres or year at all:
 * writing its payload verbatim used to blank them on every refresh.)
 *
 * Returns every column, always, so a batch upsert sends one column set for
 * every row — PostgREST fills a column missing from one row with NULL.
 */
export function providerUpdateFields(existing: ProviderExistingRow, incoming: ProviderIncoming) {
  const fill = <T>(stored: T | null, next: T | null | undefined): T | null => (blank(stored) ? (next ?? stored ?? null) : stored)
  return {
    title: blank(existing.title) ? incoming.title : (existing.title as string),
    primary_cover_url: fill(existing.primary_cover_url, incoming.primary_cover_url),
    genres: fill(existing.genres, incoming.genres),
    release_year: fill(existing.release_year, incoming.release_year),
    play_seconds: incoming.play_seconds ?? existing.play_seconds ?? null,
    play_count: incoming.play_count ?? existing.play_count ?? null,
    last_played_at: incoming.last_played_at ?? existing.last_played_at ?? null,
  }
}
