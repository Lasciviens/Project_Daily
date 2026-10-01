// Pure rules for the IGDB page's list (scripts/verify-igdb-match.cjs).
import type { TgGame } from '../../testGameModel'
import type { IgdbFilter, IgdbLibraryFilter, IgdbRowState } from '../../../igdb/igdbBatchStore'

export const isIgdbMatched = (g: Pick<TgGame, 'igdb_id'>) => g.igdb_id != null

/** Waiting for a tick: looked up this session, not saved, and not already matched. */
export const needsReview = (g: TgGame, r: IgdbRowState | undefined) =>
  !!r?.decision && !r.saved && !isIgdbMatched(g) && r.decision.status !== 'exact'

export function igdbRowMatches(g: TgGame, filter: IgdbFilter, r: IgdbRowState | undefined): boolean {
  switch (filter) {
    case 'todo': return !isIgdbMatched(g) && !r?.saved
    case 'review': return needsReview(g, r)
    case 'matched': return isIgdbMatched(g) || !!r?.saved
    case 'no_length': return isIgdbMatched(g) && !g.ttb_main_seconds && !g.ttb_extra_seconds && !g.ttb_full_seconds
    default: return true
  }
}

export const libraryMatches = (g: TgGame, lib: IgdbLibraryFilter) => lib === 'all' || g.library === lib

/** Games the page works on: everything except hidden rows (tools, apps). */
export const igdbCandidates = (games: readonly TgGame[]) => games.filter(g => !g.hidden)

export function igdbCoverage(games: readonly TgGame[]) {
  let matched = 0, withLength = 0, rated = 0
  for (const g of games) {
    if (!isIgdbMatched(g)) continue
    matched++
    if (g.ttb_main_seconds || g.ttb_extra_seconds || g.ttb_full_seconds) withLength++
    if (g.igdb_total_rating != null) rated++
  }
  return { total: games.length, matched, withLength, rated }
}

/** Not looked up this session and not matched: what "Match" runs over. */
export const toLookUp = (games: readonly TgGame[], rows: Record<string, IgdbRowState>) =>
  games.filter(g => !isIgdbMatched(g) && !rows[g.id]?.decision && !rows[g.id]?.saved)
