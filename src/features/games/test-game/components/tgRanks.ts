import type { TgGame } from '../testGameModel'
import { createContext } from 'react'

/**
 * ONE queue numbering for the whole page (queueRanks over the page's rows),
 * provided by TestGamePage — the ⋯ menu and the footer's queue button read
 * it instead of re-deriving all three libraries per open detail.
 */
export const TgRanksContext = createContext<ReadonlyMap<string, number> | null>(null)

/** The page's rows, for blocks that relate a game to the rest (its series). */
export const TgGamesContext = createContext<readonly TgGame[]>([])
