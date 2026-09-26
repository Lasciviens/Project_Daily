import type { ReactNode } from 'react'
import type { TgGame } from './testGameModel'

// Shared contracts between the Test-Game shell and its components.

export interface TgHeaderTab { key: string; label: string; count?: number }

/** Which glyph the header shows left of the title. `platform` renders the
 *  platform's wordmark (the design's "PS2" logo); the rest are section icons. */
export type TgHeaderLogo =
  | 'platform' | 'all' | 'others' | 'queue' | 'wishlist' | 'completed' | 'backlog' | 'analytics' | 'scrape' | 'advanced'

export interface TgHeaderConfig {
  title: string
  subtitle: string
  logo: TgHeaderLogo
  platformKey?: string
  tabs: TgHeaderTab[]
  activeTab: string | null
  /** Several tabs lit at once (the Library's multi-select status filter);
   *  when set it wins over `activeTab` for highlighting. */
  activeTabs?: readonly string[]
  onTab?: (key: string) => void
  /** Present while filters or a search narrow the list: clears them all. */
  onClear?: () => void
  /** A control at the title row's end (e.g. Sync on a provider shelf). */
  action?: ReactNode
}

/** Things any component may ask the shell to open. The shell owns every
 *  modal so two components can never stack two copies of the same dialog. */
export interface TgActions {
  /** The full edit form (existing GameDetailModal, opened in edit mode). */
  openEdit: (id: string) => void
  /** The full record: platforms, plan session, rescrape, delete (existing modal). */
  openFull: (id: string) => void
  /** Steam achievements/store page or PlayStation trophies (existing modals). */
  openProvider: (game: TgGame) => void
  /** Plan a play session in the calendar (the app's shared planner). */
  planSession: (game: TgGame) => void
}
