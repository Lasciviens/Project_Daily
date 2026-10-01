import { create } from 'zustand'
import type { MatchDecision, ScoredCandidate } from './igdbMatch'

// The IGDB page's session: what was looked up, ticked and saved. Kept in a
// store (not component state) so leaving the page mid-run neither stops the
// run nor loses its results; not persisted — a reload starts fresh.

export type IgdbFilter = 'todo' | 'review' | 'matched' | 'no_length' | 'all'
export type IgdbLibraryFilter = 'all' | 'retro' | 'steam' | 'playstation'

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

export const useIgdbBatch = create<IgdbBatchState>()(set => ({
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
}))
