import { formatPlaytime } from '../../api/playtimeFormat'
import { playSeconds, starsFromRating, type TgGame } from '../testGameModel'
import type { TgaKpis, TgaTile } from './tgAnalyticsModel'
import { fmtInt, fmtPct, plural } from './tgAnalyticsFormat'

// Words for the Overview tab: the KPI tiles' second lines, the KPI drill-down
// (TgAnalyticsDrill) — its title, the figure it adds up to, one plain line
// saying what the list is and, for Playtime, what the data cannot say — and
// the idle and hidden notes.

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

// ─── KPI tiles ───────────────────────────────────────────────────────────────

/** Playing: idle games first, since they are the part of the figure that isn't true today. */
export function playingSub(k: TgaKpis, windowed = false): string {
  if (k.stalePlaying > 0) {
    return windowed
      ? `${fmtInt(k.stalePlaying)} Playing in the library idle 60+ days`
      : `${fmtInt(k.stalePlaying)} with no session in 60+ days`
  }
  return k.queued ? `${fmtInt(k.queued)} in your play queue` : 'Nothing queued next'
}

/**
 * The Completed ring's share. All time: of the games you've started — a
 * completion rate of owned games mostly measures how big the backlog is. In a
 * window: of the games played in it.
 */
export function completedShare(k: TgaKpis, windowed: boolean): number | null {
  const base = windowed ? k.completionBase : k.started
  return base > 0 ? Math.min(1, k.completed / base) : null
}

export function completedSub(k: TgaKpis, windowed: boolean): string {
  if (windowed) return k.completionBase ? `${fmtPct(k.completed, k.completionBase)} of games played` : 'Nothing to complete yet'
  if (!k.started) return 'Nothing started yet'
  return `${fmtPct(k.completed, k.started)} of games you’ve started · ${fmtPct(k.completed, k.completionBase)} of owned`
}

/** Backlog: in a window these games were played in it, so "no play time" would always read 0. */
export function backlogSub(k: TgaKpis, windowed: boolean): string {
  if (windowed) return k.backlog ? 'played here, still marked Backlog' : 'Nothing in Backlog was played'
  return k.backlog ? `${fmtInt(k.backlogUnplayed)} with no play time` : 'Backlog is clear'
}

/** Played: the share with no recorded play — ES-DE only counts what it launched, so never "never played". */
export function playedSub(k: TgaKpis): string {
  const none = k.games - k.played
  if (!k.games) return 'Nothing in view'
  return none ? `${fmtPct(none, k.games)} with no recorded play` : 'Every game has recorded play'
}

// ─── Idle and hidden notes ───────────────────────────────────────────────────

/** "idle 94 days" — or, with no session date at all, says so. */
export const idleLabel = (idleDays: number | null) => (idleDays == null ? 'no session recorded' : `idle ${plural(idleDays, 'day')}`)

/**
 * What the data can say about who set Playing: a start date means the status
 * pills did. No date covers an importer's promotion, but also the edit form
 * and anything set before start dates were kept — so it says "no start date".
 */
export function idleSplit(b: { chosen: number; auto: number }): string {
  return `${fmtInt(b.chosen)} with a start date · ${fmtInt(b.auto)} with none (often an import)`
}

/** "3 hidden titles aren't counted here (2 hidden by you, 1 app or non-game)". */
export function hiddenNote(h: { total: number; explicit: number; auto: number }): string {
  const why = [
    h.explicit ? `${fmtInt(h.explicit)} hidden by you` : null,
    h.auto ? `${fmtInt(h.auto)} ${h.auto === 1 ? 'app or non-game' : 'apps and non-games'}` : null,
  ].filter(Boolean).join(', ')
  const verb = h.total === 1 ? 'hidden title isn’t' : 'hidden titles aren’t'
  return `${fmtInt(h.total)} ${verb} counted here${why ? ` (${why})` : ''}`
}
