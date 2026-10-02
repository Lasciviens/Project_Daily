import type { Tone } from '../../shared/ui/Tone'
import { stageTones, type Stage } from '../../shared/theme/stage'
import type { PlayStatus } from './types'

// A game's status on the shared stage scale (shared/theme/stage.ts). The Games
// page's own CSS (`[data-status]` in testGame.css) uses the same tone tokens.
export const PLAY_STATUS_STAGE: Record<PlayStatus, Stage> = {
  backlog: 'idle', wishlist: 'planned', playing: 'active', completed: 'done', dropped: 'dropped', hidden: 'idle',
}

export const PLAY_STATUS_TONE: Record<PlayStatus, Tone> = stageTones(PLAY_STATUS_STAGE)
