import { create } from 'zustand'
import { persist, type StateStorage } from 'zustand/middleware'
import type { MatchDecision, ScoredCandidate } from './igdbMatch'

// The IGDB page's session: what was looked up, ticked and saved. Kept in a
// store (not component state) so leaving the page mid-run neither stops the
// run nor loses its results, and saved on this device (lookups, top 5 results
// per game, ticks, filters) so a reload keeps the review list — lookups cost
// IGDB requests. The run's own flags (running, looking, progress) are not saved.

export type IgdbFilter = 'todo' | 'review' | 'none' | 'matched' | 'no_length' | 'all'
/** 'all', a library ('retro' | 'steam' | 'playstation'), or one retro system's platform key ('sys:snes'). */
export type IgdbLibraryFilter = string

export interface IgdbRowState {
  decision?: MatchDecision
  /** The candidate a tick would save (best, or the one picked from the list). */
  pick?: ScoredCandidate | null
  error?: string
  saved?: { name: string | null; at: number }
  saveError?: string
}

interface IgdbBatchState {
  filter: IgdbFilter
  library: IgdbLibraryFilter
  rows: Record<string, IgdbRowState>
  ticked: Record<string, boolean>
  running: boolean
  /** Rows in the lookup request now in flight. */
  looking: Record<string, boolean>
  stop: boolean
  progress: { done: number; total: number; saved: number } | null
  /** A game opened from its detail ("Find on IGDB"): shown first, searched. */
  focusId: string | null
  set: (p: Partial<Omit<IgdbBatchState, 'set' | 'patchRows'>>) => void
  patchRows: (patch: Record<string, IgdbRowState>) => void
}

// Every access guarded: private mode, quota or blocked storage just means no saving.
const safeStorage: StateStorage = {
  getItem: k => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k, v) => { try { localStorage.setItem(k, v) } catch { /* full or blocked */ } },
  removeItem: k => { try { localStorage.removeItem(k) } catch { /* blocked */ } },
}

const trimRows = (rows: Record<string, IgdbRowState>) => Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, {
  ...r, error: undefined, saveError: undefined,
  decision: r.decision ? { ...r.decision, candidates: r.decision.candidates.slice(0, 5) } : undefined,
}]))

export const useIgdbBatch = create<IgdbBatchState>()(persist(set => ({
  filter: 'todo',
  library: 'all',
  rows: {},
  ticked: {},
  running: false,
  looking: {},
  stop: false,
  progress: null,
  focusId: null,
  set: p => set(p),
  patchRows: patch => set(s => ({ rows: { ...s.rows, ...Object.fromEntries(Object.entries(patch).map(([id, r]) => [id, { ...s.rows[id], ...r }])) } })),
}), {
  name: 'lasci.igdbBatch',
  version: 1,
  storage: { getItem: k => { try { const v = safeStorage.getItem(k) as string | null; return v ? JSON.parse(v) : null } catch { return null } }, setItem: (k, v) => safeStorage.setItem(k, JSON.stringify(v)), removeItem: k => safeStorage.removeItem(k) },
  partialize: s => ({ filter: s.filter, library: s.library, rows: trimRows(s.rows), ticked: s.ticked }) as unknown as IgdbBatchState,
}))
