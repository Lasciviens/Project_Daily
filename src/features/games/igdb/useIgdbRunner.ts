import type { TgGame } from '../test-game/testGameModel'
import { useIgdbBatch, type IgdbRowState } from './igdbBatchStore'
import { decideMatch, fallbackQuery, searchQuery, type IgdbCandidate, type MatchTarget, type ScoredCandidate } from './igdbMatch'
import type { IgdbApplyItem } from './igdbApi'
import { useAfterIgdbWrite, useApplyIgdb, useIgdbMatch } from './useIgdb'

/** Games per lookup request (≤ 3 IGDB multiqueries, well inside 4 requests/s). */
const CHUNK = 25
const SAVE_CHUNK = 50

export const matchTarget = (g: TgGame): MatchTarget => ({ title: g.title, year: g.release_year, platformKey: g.platformKey, library: g.library })

/**
 * Bulk matching. `run` looks the games up a chunk at a time; an exact match
 * (Steam app id, or the same title on the same platform/year with no rival)
 * is saved right away, everything else waits in the list for a tick. The run
 * writes into the batch store, so it carries on if the page is left, and
 * Stop ends it after the chunk in flight. The library is refreshed once, at
 * the end.
 */
export function useIgdbRunner() {
  const match = useIgdbMatch()
  const apply = useApplyIgdb()
  const after = useAfterIgdbWrite()

  async function save(items: IgdbApplyItem[]): Promise<number> {
    const { patchRows } = useIgdbBatch.getState()
    let n = 0
    for (let i = 0; i < items.length; i += SAVE_CHUNK) {
      const part = items.slice(i, i + SAVE_CHUNK)
      try {
        const r = await apply.mutateAsync(part)
        const patch: Record<string, IgdbRowState> = {}
        for (const s of r.saved) patch[s.game_id] = { saved: { name: s.name, at: Date.now() }, saveError: undefined }
        for (const f of r.failed) patch[f.game_id] = { saveError: f.reason }
        patchRows(patch)
        n += r.saved.length
      } catch {
        // The mutation already toasted; mark the rows so they can be saved again.
        patchRows(Object.fromEntries(part.map(x => [x.game_id, { saveError: 'Not saved — try again' }])))
        break
      }
    }
    return n
  }

  async function run(games: TgGame[]) {
    const st = useIgdbBatch.getState()
    if (st.running || !games.length) return
    st.set({ running: true, stop: false, progress: { done: 0, total: games.length, saved: 0 } })
    let saved = 0
    try {
      for (let i = 0; i < games.length; i += CHUNK) {
        if (useIgdbBatch.getState().stop) break
        const chunk = games.slice(i, i + CHUNK)
        useIgdbBatch.getState().set({ looking: Object.fromEntries(chunk.map(g => [g.id, true])) })
        let results
        try {
          results = await match.mutateAsync(chunk.map(g => ({ game_id: g.id, query: searchQuery(g.title), fallback: fallbackQuery(g.title), steam_appid: g.steamAppId })))
        } catch (e) {
          useIgdbBatch.getState().patchRows(Object.fromEntries(chunk.map(g => [g.id, { error: (e as Error).message }])))
          break
        } finally {
          useIgdbBatch.getState().set({ looking: {} })
        }
        const byId = new Map(results.map(r => [r.game_id, r]))
        const patch: Record<string, IgdbRowState> = {}
        const exact: IgdbApplyItem[] = []
        for (const g of chunk) {
          const r = byId.get(g.id)
          const d = decideMatch(matchTarget(g), r?.steam ?? null, r?.candidates ?? [])
          patch[g.id] = { decision: d, pick: d.best, error: undefined }
          if (d.status === 'exact' && d.best && d.kind) exact.push({ game_id: g.id, igdb_id: d.best.id, match: d.kind })
        }
        useIgdbBatch.getState().patchRows(patch)
        if (exact.length) saved += await save(exact)
        useIgdbBatch.getState().set({ progress: { done: Math.min(games.length, i + CHUNK), total: games.length, saved } })
      }
    } finally {
      useIgdbBatch.getState().set({ running: false, stop: false })
      if (saved) void after()
    }
  }

  /** Saves every ticked row's pick. */
  async function saveTicked(games: TgGame[]) {
    const { rows, ticked, set } = useIgdbBatch.getState()
    const items: IgdbApplyItem[] = []
    for (const g of games) {
      const r = rows[g.id]
      if (!ticked[g.id] || !r?.pick || r.saved) continue
      items.push({ game_id: g.id, igdb_id: r.pick.id, match: r.decision?.kind && r.pick.id === r.decision.best?.id ? r.decision.kind : 'picked' })
    }
    if (!items.length) return
    set({ running: true })
    try {
      const n = await save(items)
      if (n) {
        const t = { ...useIgdbBatch.getState().ticked }
        for (const x of items) delete t[x.game_id]
        set({ ticked: t })
        void after()
      }
    } finally { set({ running: false }) }
  }

  /** Saves one candidate for one game (picked from its results or a search). */
  async function savePick(g: TgGame, c: IgdbCandidate | ScoredCandidate) {
    const n = await save([{ game_id: g.id, igdb_id: c.id, match: 'picked' }])
    if (n) void after()
    return n > 0
  }

  return { run, saveTicked, savePick, stop: () => useIgdbBatch.getState().set({ stop: true }) }
}
