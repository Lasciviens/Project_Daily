import type { TgGame } from './testGameModel'

// Shared contracts between the Test-Game shell and its components.

export interface TgHeaderTab { key: string; label: string; count?: number }

/** Which glyph the header shows left of the title. `platform` renders the
 *  platform's wordmark (the design's "PS2" logo); the rest are section icons. */
export type TgHeaderLogo =
  | 'platform' | 'all' | 'others' | 'queue' | 'wishlist' | 'completed' | 'backlog' | 'analytics' | 'advanced'

export interface TgHeaderConfig {
  title: string
  subtitle: string
  logo: TgHeaderLogo
  platformKey?: string
  tabs: TgHeaderTab[]
  activeTab: string | null
  onTab?: (key: string) => void
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
}
