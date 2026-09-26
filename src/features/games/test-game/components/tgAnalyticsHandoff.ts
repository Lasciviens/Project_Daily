import { createContext, useCallback, useContext } from 'react'
import type { PlayStatus } from '../../types'
import type { TgGame } from '../testGameModel'
import type { TgaBase } from './tgAnalyticsData'
import { TGA_LIBRARIES, TGA_WINDOWS, type TgaLibrary, type TgaWindow } from './tgAnalyticsModel'
import { openLibraryWith } from './tgAnalyticsNav'

/** The Analytics base (window, library, games) for cards that hand off to the Library. */
export const TgaBaseContext = createContext<TgaBase | null>(null)

/** "Completed · Last 30 days · Retro" — what a hand-off list is, in the header. */
export function scopeLabel(what: string, period: TgaWindow, library: TgaLibrary): string {
  return [
    what,
    period === 'all' ? null : TGA_WINDOWS.find(w => w.key === period)?.label,
    library === 'all' ? null : TGA_LIBRARIES.find(l => l.key === library)?.label,
  ].filter(Boolean).join(' · ')
}

export interface TgaHandoffOptions {
  /** Also lights this platform's shelf (a single-platform row). */
  platform?: string
  /** Also lights this status tab; `hidden` is required for hidden games. */
  status?: PlayStatus
  /** The list ignores the time window (idle, hidden), so the label leaves it out. */
  wholeLibrary?: boolean
}

export interface TgaHandoff {
  base: TgaBase | null
  /** Opens the Library on exactly `games`, labelled `what` plus the window and library. */
  open: (what: string, games: readonly TgGame[], o?: TgaHandoffOptions) => void
}

export function useAnalyticsHandoff(): TgaHandoff {
  const base = useContext(TgaBaseContext)
  const open = useCallback((what: string, games: readonly TgGame[], o: TgaHandoffOptions = {}) => {
    const { wholeLibrary, ...rest } = o
    const period = wholeLibrary ? 'all' : base?.period ?? 'all'
    openLibraryWith({ ids: games.map(g => g.id), label: scopeLabel(what, period, base?.library ?? 'all'), ...rest })
  }, [base])
  return { base, open }
}
