// The favourite teams at a glance, for the Personal page's Football card
// (owner, 26.10.2026: "how they're doing and the next match"). Only the
// Football page's own reads, through the same cache entries and stale times
// (espnQueries) — no ESPN call of its own; a match being played is read again
// every minute, as on the page. What each team shows is footballGlance.teamGlance's.
import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { isLeagueSlug } from '../api/espnApi'
import { favouritesOf, teamGlance, type FavouriteTeamGlance } from '../footballGlance'
import type { FbMatch } from '../footballModel'
import { LIVE_EVERY, needsLive, standingsQuery, teamFixturesQuery, teamInfoQuery, teamResultsQuery } from './espnQueries'
import { useFollows } from './useFootball'
import { useMinute } from './useMinute'

export interface FavouriteTeamsGlance {
  /** Each favourite team, in the Following list's order; empty while none is starred. */
  teams: FavouriteTeamGlance[]
  /** What you follow, or a favourite's first answers from ESPN, still loading. */
  isLoading: boolean
  /** What you follow couldn't be read (the app's own rows). */
  isError: boolean
  /** The favourites ESPN didn't answer for; their other facts still show. */
  failed: string[]
  /** Reads again whatever failed. */
  retry: () => void
}

const liveEvery = (q: { state: { data?: FbMatch[] } }) => (q.state.data?.some(m => needsLive(m)) ? LIVE_EVERY : false)

/** `enabled: false` (the card collapsed or hidden) reads nothing from ESPN.
 *  `day`: the day Personal shows — each team's match that day comes as `onDay`. */
export function useFavouriteTeamsGlance({ enabled = true, day }: { enabled?: boolean; day?: string } = {}): FavouriteTeamsGlance {
  const followsQ = useFollows()
  const now = useMinute()
  const favourites = useMemo(() => favouritesOf(followsQ.data ?? []), [followsQ.data])
  // A team followed without its league (ESPN's search gave none): the club's own league, read as its popup reads it.
  const infosQ = useQueries({ queries: favourites.map(f => ({ ...teamInfoQuery(f.ref), enabled: enabled && !f.league })) })
  const leagues = favourites.map((f, i) => {
    const league = f.league ?? infosQ[i]?.data?.defaultLeague ?? null
    return league && isLeagueSlug(league) ? league : null
  })
  const fixturesQ = useQueries({ queries: favourites.map(f => ({ ...teamFixturesQuery(f.ref), enabled, refetchInterval: liveEvery })) })
  const resultsQ = useQueries({ queries: favourites.map(f => ({ ...teamResultsQuery(f.ref), enabled, refetchInterval: liveEvery })) })
  const tablesQ = useQueries({ queries: leagues.map(league => ({ ...standingsQuery(league ?? ''), enabled: enabled && !!league })) })

  const reads = [...infosQ, ...fixturesQ, ...resultsQ, ...tablesQ]
  const stamp = reads.map(q => q.dataUpdatedAt).join(',')
  const teams = useMemo(
    () => favourites.map((f, i) => teamGlance(f, {
      league: leagues[i],
      standings: tablesQ[i]?.data ?? null,
      matches: [...(fixturesQ[i]?.data ?? []), ...(resultsQ[i]?.data ?? [])],
    }, now, day)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the answers' times say when anything changed
    [favourites, stamp, now, day],
  )
  const failed = favourites
    .filter((_, i) => infosQ[i]?.isError || fixturesQ[i]?.isError || resultsQ[i]?.isError || tablesQ[i]?.isError)
    .map(f => f.name)

  return {
    teams,
    isLoading: followsQ.isLoading || reads.some(q => q.isLoading),
    isError: followsQ.isError,
    failed,
    retry: () => {
      if (followsQ.isError) void followsQ.refetch()
      for (const q of reads) if (q.isError) void q.refetch()
    },
  }
}
