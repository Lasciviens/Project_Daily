import { formatPlaytime } from '../../api/playtimeFormat'
import { playSeconds, starsFromRating, type TgGame } from '../testGameModel'
import type { TgaTile } from './tgAnalyticsModel'
import { fmtInt, plural } from './tgAnalyticsFormat'

// Words for the KPI drill-down (TgAnalyticsDrill): its title, the figure it
// adds up to, and one plain line saying what the list is — and, for Playtime,
// what the data cannot say.

export function drillTitle(kind: TgaTile, windowed: boolean): string {
  switch (kind) {
    case 'games': return windowed ? 'Games played' : 'Games'
    case 'playing': return 'Playing now'
    case 'completed': return windowed ? 'Finished' : 'Completed'
    case 'playtime': return 'Playtime'
    case 'rating': return 'Rated games'
    case 'backlog': return 'Backlog'
    case 'played': return 'Played'
  }
}

/** The tile's own figure, recomputed from the list it opened — so the two can't disagree. */
export function drillFigure(kind: TgaTile, games: TgGame[]): string {
  const count = plural(games.length, 'game')
  if (kind === 'playtime') {
    const secs = games.reduce((n, g) => n + (playSeconds(g) ?? 0), 0)
    return secs > 0 ? `${formatPlaytime(secs / 60)} · ${count}` : count
  }
  if (kind === 'rating' && games.length) {
    const avg = games.reduce((n, g) => n + (starsFromRating(g.rating) ?? 0), 0) / games.length
    return `${(Math.round(avg * 100) / 100).toFixed(1)} average · ${count}`
  }
  return count
}

export function drillNote(kind: TgaTile, windowed: boolean): string {
  switch (kind) {
    case 'games': return windowed
      ? 'Games you played, started or finished in this period, latest session first.'
      : 'Every visible game in this library, latest session first.'
    case 'playing': return 'Games with the status Playing, latest session first.'
    case 'completed': return windowed
      ? 'Games with a finish date in this period, newest first.'
      : 'Games with the status Completed, newest finish first.'
    case 'playtime': return windowed
      ? 'Lifetime play time of games you played in this period — per-period hours aren’t recorded.'
      : 'Lifetime play time, as ES-DE, Steam and PlayStation report it. Most played first.'
    case 'rating': return 'Your own ratings, highest first.'
    case 'backlog': return 'Backlog games (and games with no status yet), latest session first.'
    case 'played': return windowed
      ? 'Games with recorded play that you played in this period, latest session first.'
      : 'Games with recorded play — play time, launches or a session date — latest session first. ES-DE only counts games it launched.'
  }
}

export const hoursOf = (g: TgGame) => {
  const s = playSeconds(g)
  return s && s > 0 ? formatPlaytime(s / 60) : null
}

export const shownOf = (shown: number, total: number) => `Showing ${fmtInt(shown)} of ${fmtInt(total)}`
