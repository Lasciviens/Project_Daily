import type { Book, BookPatch } from '../types'

export interface DetailsDraft {
  series_index: string; language: string; isbn: string; publisher: string
  published_year: string; page_count: string; description: string
}

export const detailsDraft = (b: Book): DetailsDraft => ({
  series_index: b.series_index ?? '', language: b.language ?? '', isbn: b.isbn ?? '', publisher: b.publisher ?? '',
  published_year: b.published_year ? String(b.published_year) : '', page_count: b.page_count ? String(b.page_count) : '',
  description: (b.description ?? '').replace(/<[^>]+>/g, ''),
})

const whole = (v: string, min: number, max: number): number | null => {
  const n = Number(v.trim())
  return v.trim() && Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** Why a typed year or page count cannot be saved, or null. */
export function detailsProblem(d: DetailsDraft): string | null {
  if (d.published_year.trim() && whole(d.published_year, 1000, 2100) === null) return 'Year must be a whole year, like 2019.'
  if (d.page_count.trim() && whole(d.page_count, 1, 100000) === null) return 'Pages must be a whole number.'
  return null
}

/**
 * The details as a patch (empty = cleared). The description is sent only when
 * it was edited, so opening and saving a book never rewrites it.
 */
export function detailsPatch(d: DetailsDraft, original: DetailsDraft): BookPatch {
  const t = (v: string) => v.trim() || null
  const patch: BookPatch = {
    series_index: t(d.series_index), language: t(d.language), isbn: t(d.isbn)?.replace(/[\s-]/g, '') ?? null,
    publisher: t(d.publisher),
  }
  if (d.description !== original.description) patch.description = t(d.description)
  if (!d.published_year.trim()) patch.published_year = null
  else { const y = whole(d.published_year, 1000, 2100); if (y !== null) patch.published_year = y }
  if (!d.page_count.trim()) patch.page_count = null
  else { const p = whole(d.page_count, 1, 100000); if (p !== null) patch.page_count = p }
  return patch
}
