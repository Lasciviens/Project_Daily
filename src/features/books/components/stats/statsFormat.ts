// Small formatting helpers and constants shared by the Stats cards.
import type { Book } from '../../types'

export const WINDOWS = [
  { value: '7', label: '7 d' },
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: '365', label: '1 y' },
] as const
export type WindowValue = typeof WINDOWS[number]['value']

/** A duration as a tile value: "1:50" h from an hour up, else minutes. */
export function tileDuration(sec: number): { value: string | number; unit: string } {
  const m = Math.round(sec / 60)
  return m >= 60 ? { value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, unit: 'h' } : { value: m, unit: 'min' }
}

/** A book's display title; a news issue is labelled as news. */
export const bookTitle = (b: Book | undefined) => b ? (b.kind === 'news' ? `News · ${b.title}` : b.title) : 'Unknown book'

/** The note under page figures: page numbers follow the Kobo's font and layout. */
export const PAGES_NOTE = 'Pages follow the Kobo’s current font and layout, so time is the steadier measure.'
