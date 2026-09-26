// Wording and layout constants for the Analytics Play tab's cards (a .tsx file
// may export only components). The figures themselves come from
// tgAnalyticsMore / tgAnalyticsModel — this file only puts them into words.

import { formatDay, platformInfo, playCount, playSeconds, type TgGame } from '../testGameModel'
import type { TgaLibrary } from './tgAnalyticsModel'
import { avgSessionSeconds, type TgaLibraryRow, type TgaPlaytimeBucket } from './tgAnalyticsMore'
import { fmtInt, fmtPct, plural } from './tgAnalyticsFormat'

export type TgaLib = Exclude<TgaLibrary, 'all'>
type Fmt = (seconds: number) => string

export const TGA_LIB_ORDER: TgaLib[] = ['retro', 'steam', 'playstation']

export const TGA_LIB_META: Record<TgaLib, { label: string; color: string }> = {
  retro: { label: 'Retro', color: 'var(--tg-lib-retro)' },
  steam: { label: 'Steam', color: 'var(--tg-lib-steam)' },
  playstation: { label: 'PlayStation', color: 'var(--tg-lib-playstation)' },
}

// Spans for the Play tab's grid (see TgAnalyticsPlayTab for the rows they make).
/** Libraries compared: always a full row — a table reads best across the width. */
export const TGA_SPAN_ROW = 'col-span-full'
/** Play-time spread without a Trophies card: a full row at two columns (the grid then stops at three, see TgAnalyticsPlayTab). */
export const TGA_SPAN_SPREAD_ALONE = '@2xl:col-span-2 @[62rem]:col-span-1'

/** What "no recorded play" can and can't mean for the library in view. */
export function coverageNote(library: TgaLibrary): string {
  switch (library) {
    case 'retro': return 'ES-DE only records games it launched — a game played another way shows here as no recorded play.'
    case 'steam': return 'Steam records every game played on your account.'
    case 'playstation': return 'PlayStation records every game played on your account.'
    default: return 'ES-DE only records games it launched; Steam and PlayStation record every game played.'
  }
}

const perSession = (avg: number, fmt: Fmt) => (avg >= 60 ? `~${fmt(avg)} a session` : 'under a minute a session')

/**
 * Most played's second line: platform, launches (or play time, when the row
 * already ranks by launches), the lifetime average per launch and the last
 * session. A part the provider doesn't report is left out, never zeroed.
 */
export function playedSubline(game: TgGame, last: string | null, fmt: Fmt, mode: 'time' | 'launches'): string {
  const parts = [platformInfo(game.platformKey).short]
  const launches = playCount(game)
  const seconds = playSeconds(game)
  if (mode === 'time' && launches) parts.push(plural(launches, 'launch', 'launches'))
  if (mode === 'launches' && seconds && seconds > 0) parts.push(`${fmt(seconds)} played`)
  const avg = avgSessionSeconds(game)
  if (avg != null) parts.push(perSession(avg, fmt))
  if (last) parts.push(`last played ${formatDay(last)}`)
  return parts.join(' · ')
}

/** "Your top 5 games hold 62% of all play time (120h of 194h)" — null when nothing has play time. */
export function concentrationSentence(
  c: { top: unknown[]; topSeconds: number; totalSeconds: number; share: number },
  fmt: Fmt,
): string | null {
  const n = c.top.length
  if (!n || c.totalSeconds <= 0) return null
  if (c.topSeconds >= c.totalSeconds) {
    return n === 1
      ? `One game holds all of your play time (${fmt(c.totalSeconds)})`
      : `Only ${n} games have play time — ${fmt(c.totalSeconds)} in all`
  }
  // Rounding must never claim "100%" while other games still hold some time.
  const share = c.share >= 0.995 ? '>99%' : fmtPct(c.topSeconds, c.totalSeconds)
  return `Your top ${n} games hold ${share} of all play time (${fmt(c.topSeconds)} of ${fmt(c.totalSeconds)})`
}

/** The libraries that have at least one game in any bucket, in the fixed legend order. */
export function libsPresent(buckets: TgaPlaytimeBucket[]): TgaLib[] {
  return TGA_LIB_ORDER.filter(l => buckets.some(b => b.parts[l] > 0))
}

/** "12 games: 8 Retro, 4 Steam" — a bucket's numbers for a tooltip and screen readers. */
export function bucketText(b: TgaPlaytimeBucket, libs: TgaLib[]): string {
  const split = libs.filter(l => b.parts[l] > 0).map(l => `${fmtInt(b.parts[l])} ${TGA_LIB_META[l].label}`)
  return `${plural(b.count, 'game')}${split.length ? `: ${split.join(', ')}` : ''}`
}

export interface TgaLibraryCell { key: string; label: string; head: string; value: string; title?: string }

/** One library's figures, labelled for both the table (short `head`) and the stacked blocks (`label`). */
export function libraryCells(r: TgaLibraryRow, fmt: Fmt): TgaLibraryCell[] {
  return [
    { key: 'games', label: 'Games', head: 'Games', value: fmtInt(r.games) },
    {
      key: 'played', label: 'Played', head: 'Played', value: `${fmtInt(r.played)} · ${fmtPct(r.played, r.games)}`,
      title: `${fmtInt(r.played)} of ${fmtInt(r.games)} with recorded play`,
    },
    { key: 'time', label: 'Play time', head: 'Play time', value: r.seconds > 0 ? fmt(r.seconds) : '—' },
    {
      key: 'median', label: 'Median per played game', head: 'Median', value: r.medianSeconds != null ? fmt(r.medianSeconds) : '—',
      title: 'Median lifetime play time of the games with any',
    },
    { key: 'completed', label: 'Completed', head: 'Completed', value: fmtInt(r.completed) },
    {
      key: 'launches', label: 'Launches', head: 'Launches', value: r.launches != null ? fmtInt(r.launches) : '—',
      title: r.launches != null ? undefined : r.library === 'steam' ? 'Steam doesn’t report launches' : 'No launches recorded',
    },
    { key: 'last', label: 'Last session', head: 'Last session', value: formatDay(r.lastSession) },
  ]
}

// Header and rows share one template so the columns line up; the minimums
// add up (with the gaps) to the 40rem the table switches on at.
export const TGA_LIB_TABLE = '@[40rem]:grid-cols-[minmax(6.5rem,1.3fr)_minmax(2.75rem,0.7fr)_minmax(5rem,1fr)_minmax(4.75rem,1fr)_minmax(4.25rem,1fr)_minmax(3.5rem,0.8fr)_minmax(3.5rem,0.8fr)_minmax(5.5rem,1.1fr)]'
