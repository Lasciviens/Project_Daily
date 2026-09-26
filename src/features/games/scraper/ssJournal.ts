// The journal read the Scrape page shows as "Recent saves". Pure, so
// scripts/verify-tg-scrape-model.cjs can check it; the SAME newest-only rule
// as the edge function's undoableByGame: per game only the newest apply can
// be undone, and only until it has been.

export interface JournalRow {
  id: string
  run_id: string
  game_id: string
  decision: 'applied' | 'undone' | string
  matched_title: string | null
  created_at: string
  written_values?: { undid?: string } | null
}

export interface RecentRun {
  run_id: string
  created_at: string
  games: { game_id: string; title: string | null }[]
  /** Games of this run whose save can still be undone (their newest apply, not undone). */
  undoable: number
  /** Every game of the run has been undone. */
  undone: boolean
}

/** Per game, the apply that can still be undone. */
export function undoableApplies(rows: JournalRow[]): Map<string, JournalRow> {
  const byGame = new Map<string, JournalRow[]>()
  for (const r of rows) byGame.set(r.game_id, [...(byGame.get(r.game_id) ?? []), r])
  const out = new Map<string, JournalRow>()
  for (const [game, list] of byGame) {
    const newest = list.filter(r => r.decision === 'applied').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (!newest) continue
    const undone = list.some(r => r.decision === 'undone' && (r.written_values?.undid
      ? r.written_values.undid === newest.id
      : r.run_id === newest.run_id && r.created_at >= newest.created_at))
    if (!undone) out.set(game, newest)
  }
  return out
}

/** Runs newest first, each with its games and how many can still be undone. */
export function recentRuns(rows: JournalRow[], limit = 12): RecentRun[] {
  const live = undoableApplies(rows)
  const undoneRows = rows.filter(r => r.decision === 'undone')
  const runs = new Map<string, RecentRun>()
  for (const r of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (r.decision !== 'applied') continue
    const run = runs.get(r.run_id) ?? { run_id: r.run_id, created_at: r.created_at, games: [], undoable: 0, undone: true }
    if (!run.games.some(g => g.game_id === r.game_id)) {
      run.games.push({ game_id: r.game_id, title: r.matched_title })
      if (live.get(r.game_id)?.run_id === r.run_id) run.undoable++
    }
    const wasUndone = undoneRows.some(u => (u.written_values?.undid ? u.written_values.undid === r.id : u.run_id === r.run_id && u.game_id === r.game_id))
    if (!wasUndone) run.undone = false
    runs.set(r.run_id, run)
  }
  return [...runs.values()].slice(0, limit)
}
