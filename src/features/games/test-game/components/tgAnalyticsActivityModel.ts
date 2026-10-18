// The Activity card's pure pieces (TgAnalyticsActivity*): chart rows, the
// words around the chart and how much room a completion marker gets.

import type { TgaActivity, TgaActivityColumn, TgaLib } from './tgAnalyticsSeries'
import { plural } from './tgAnalyticsFormat'

export const TGA_LIB_LABEL: Record<TgaLib, string> = { retro: 'Retro', steam: 'Steam', playstation: 'PlayStation' }

/** The library's own colour token, set once per theme in testGame.css. */
export const libFill = (lib: TgaLib) => `var(--tg-lib-${lib})`

/** A chart row: the column with each library flattened to its own key, plus which segment is on top. */
export interface TgaActivityRow extends TgaActivityColumn {
  retro: number
  steam: number
  playstation: number
  /** The highest non-empty segment in the stack — the one that gets the rounded data-end. */
  top: TgaLib | null
  /** The completions again, or null in a column without any, so only real ones get a marker. */
  done: number | null
  /** Always 0: an empty segment on top of the stack whose only job is to carry the marker at the stack's top. */
  cap: 0
}

export function activityRows(series: TgaActivity): TgaActivityRow[] {
  return series.columns.map(c => {
    let top: TgaLib | null = null
    for (const lib of series.libraries) if (c.parts[lib] > 0) top = lib
    return { ...c, ...c.parts, top, done: c.completed > 0 ? c.completed : null, cap: 0 }
  })
}

/** "12 games · 3 completions" — the card adds the range (TGA_RANGE) where there's room. */
export const activityMeta = (series: TgaActivity) => `${plural(series.total, 'game')} · ${plural(series.completed, 'completion')}`

/** What the chart leaves out — sessions and completions it has no place for — or null. */
export function activityNote(series: TgaActivity): string | null {
  const u = series.unplaced
  const parts = [
    series.earlier > 0 ? `${plural(series.earlier, 'game')} last played before this chart starts` : null,
    u.undated > 0 ? `${plural(u.undated, 'completion')} with no finish date` : null,
    u.earlier > 0 ? `${plural(u.earlier, 'completion')} finished before it starts` : null,
    u.future > 0 ? `${plural(u.future, 'completion')} dated in the future` : null,
  ].filter(Boolean)
  return parts.length ? `Not shown: ${parts.join(' · ')}.` : null
}

export const isActivityEmpty = (series: TgaActivity) => series.total === 0 && series.completed === 0

/** A numbered completion pill needs this much room per column; narrower columns get a plain dot. */
export const PILL_ROOM = 24

export const markerFits = (plotWidth: number, columns: number) => columns > 0 && plotWidth / columns >= PILL_ROOM

/** The tooltip and table line for one library in one column. */
export const libLine = (lib: TgaLib, n: number) => `${TGA_LIB_LABEL[lib]}: ${plural(n, 'game')}`
