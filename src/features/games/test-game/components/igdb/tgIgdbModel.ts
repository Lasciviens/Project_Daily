// Pure rules for the IGDB page's list (scripts/verify-igdb-match.cjs).
import type { TgGame } from '../../testGameModel'
import type { IgdbFilter, IgdbLibraryFilter, IgdbRowState } from '../../../igdb/igdbBatchStore'

export const isIgdbMatched = (g: Pick<TgGame, 'igdb_id'>) => g.igdb_id != null

/** Waiting for a tick: looked up this session, not saved, and not already matched. */
export const needsReview = (g: TgGame, r: IgdbRowState | undefined) =>
  !!r?.decision && !r.saved && !isIgdbMatched(g) && r.decision.status === 'review'

export function igdbRowMatches(g: TgGame, filter: IgdbFilter, r: IgdbRowState | undefined): boolean {
  switch (filter) {
    // Not looked up yet (a lookup moves a game to To review or No match).
    case 'todo': return !isIgdbMatched(g) && !r?.saved && !r?.decision
    case 'none': return !isIgdbMatched(g) && !r?.saved && r?.decision?.status === 'none'
    case 'review': return needsReview(g, r)
    case 'matched': return isIgdbMatched(g) || !!r?.saved
    case 'no_length': return isIgdbMatched(g) && !g.ttb_main_seconds && !g.ttb_extra_seconds && !g.ttb_full_seconds
    default: return true
  }
}

export function libraryMatches(g: TgGame, lib: IgdbLibraryFilter): boolean {
  if (lib === 'all') return true
  if (lib.startsWith('sys:')) return g.library === 'retro' && g.platformKey === lib.slice(4)
  return g.library === lib
}

/** The picker's choices: All, the three libraries, then every retro system with games, biggest first. */
export function igdbScopes(games: readonly TgGame[]): { value: IgdbLibraryFilter; key: string; count: number; kind: 'all' | 'library' | 'system' }[] {
  const sys = new Map<string, number>()
  let retro = 0, steam = 0, psn = 0
  for (const g of games) {
    if (g.library === 'steam') steam++
    else if (g.library === 'playstation') psn++
    else { retro++; sys.set(g.platformKey, (sys.get(g.platformKey) ?? 0) + 1) }
  }
  const out: { value: IgdbLibraryFilter; key: string; count: number; kind: 'all' | 'library' | 'system' }[] = [{ value: 'all', key: 'all', count: games.length, kind: 'all' }]
  if (retro) out.push({ value: 'retro', key: 'retro', count: retro, kind: 'library' })
  if (steam) out.push({ value: 'steam', key: 'steam', count: steam, kind: 'library' })
  if (psn) out.push({ value: 'playstation', key: 'playstation', count: psn, kind: 'library' })
  for (const [k, n] of [...sys].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) out.push({ value: `sys:${k}`, key: k, count: n, kind: 'system' })
  return out
}

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

/** Counts per filter, for the tab badges. */
export function igdbFilterCounts(games: readonly TgGame[], rows: Record<string, IgdbRowState>): Record<IgdbFilter, number> {
  const c: Record<IgdbFilter, number> = { todo: 0, review: 0, none: 0, matched: 0, no_length: 0, all: games.length }
  for (const g of games) for (const f of ['todo', 'review', 'none', 'matched', 'no_length'] as const) if (igdbRowMatches(g, f, rows[g.id])) c[f]++
  return c
}
