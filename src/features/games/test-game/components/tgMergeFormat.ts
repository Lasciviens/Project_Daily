import { formatPlaytime } from '../../api/playtimeFormat'
import { formatLength } from '../../igdb/igdbMatch'
import {
  formatDay, gameLengthSeconds, lastPlayedIso, platformInfo, playCount, playSeconds, resolveSystemKey, type TgGame,
} from '../testGameModel'
import type { MergedFields } from '../tgMergeModel'
import { cardStatus, statusLabel } from './TgStatusMeta'

// Display helpers for Duplicates and the Compare & merge popup (a .tsx file
// may export only components).

export const LIBRARY_LABEL: Record<string, string> = { retro: 'Retro', steam: 'Steam', playstation: 'PlayStation' }

/** "PlayStation 2 · Retro · 2004 · Completed · 12 h" — the facts that tell two copies apart. */
export function dupMeta(g: TgGame): string {
  const s = playSeconds(g)
  return [
    platformInfo(g.platformKey).name, LIBRARY_LABEL[g.library] ?? g.library, g.release_year,
    cardStatus(g).label, s != null && s > 0 ? formatPlaytime(s / 60) : null,
  ].filter(Boolean).join(' · ')
}

export interface CompareRow { label: string; keep: string; drop: string; result: string; changed: boolean }

const DASH = '—'
const text = (v: string | null | undefined, max = 90) => {
  const t = (v ?? '').trim().replace(/\s+/g, ' ')
  return !t ? DASH : t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const yes = (v: string | null | undefined) => ((v ?? '').trim() ? 'Yes' : DASH)

/** The kept row as it will read after the merge, in a shape every display helper takes. */
export function mergedGame(keep: TgGame, drop: TgGame, merged: MergedFields): TgGame {
  const platforms = [
    ...keep.platforms,
    ...drop.platforms.map(p => (keep.platforms.some(k => k.is_primary_variant) ? { ...p, is_primary_variant: false } : p)),
  ]
  return { ...keep, ...merged, platforms } as TgGame
}

function cells(g: TgGame) {
  const seconds = playSeconds(g), launches = playCount(g), length = formatLength(gameLengthSeconds(g))
  const systems = [...g.platforms]
    .sort((a, b) => Number(b.is_primary_variant) - Number(a.is_primary_variant))
    .map(p => platformInfo(resolveSystemKey(p.system)).name || p.system)
  return {
    Platforms: systems.length ? systems.join(', ') : DASH,
    Library: LIBRARY_LABEL[g.library] ?? g.library,
    Year: g.release_year ? String(g.release_year) : DASH,
    Status: statusLabel(g.play_status),
    Rating: g.rating != null ? `${g.rating}/10` : DASH,
    'Play time': seconds != null && seconds > 0 ? formatPlaytime(seconds / 60) : DASH,
    Launches: launches != null && launches > 0 ? launches.toLocaleString('en-GB') : DASH,
    'Last played': lastPlayedIso(g) ? formatDay(lastPlayedIso(g)) : DASH,
    Started: g.started_at ? formatDay(g.started_at) : DASH,
    Finished: g.finished_at ? formatDay(g.finished_at) : DASH,
    Queue: g.play_order != null ? `#${g.play_order}` : DASH,
    Developer: text(g.developer),
    Publisher: text(g.publisher),
    Series: text(g.series_name),
    Genres: g.genres?.length ? g.genres.join(', ') : DASH,
    Players: text(g.players),
    Description: text(g.description),
    Cover: yes(g.primary_cover_url),
    Screenshot: yes(g.screenshot_url),
    'Fan art': yes(g.fanart_url),
    ScreenScraper: g.ss_jeu_id ? `#${g.ss_jeu_id}` : DASH,
    IGDB: g.igdb_id != null ? `${g.igdb_id}${length ? ` · ${length}` : ''}` : DASH,
    Notes: text(g.play_notes, 140),
    'Added': formatDay(g.created_at),
  }
}

/** Every compared field: kept copy · removed copy · result. A field empty in all three is left out. */
export function compareRows(keep: TgGame, drop: TgGame, after: TgGame): CompareRow[] {
  const k = cells(keep), d = cells(drop), r = cells(after)
  return (Object.keys(k) as (keyof typeof k)[])
    .filter(label => !(k[label] === DASH && d[label] === DASH && r[label] === DASH))
    .map(label => ({ label, keep: k[label], drop: d[label], result: r[label], changed: r[label] !== k[label] }))
}
