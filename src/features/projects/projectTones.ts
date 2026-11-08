import type { Tone } from '../../shared/ui'
import { stageTones } from '../../shared/theme/stage'
import type { PhaseStatus, ProjectStatus } from './types'

// The one enum → tone map per project enum (THEME.md §2.4).

// Statuses go through the shared stages (shared/theme/stage.ts): Active is
// the same cyan as Watching, Completed the same green as Done.
export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = stageTones({
  active:    'active',
  on_hold:   'paused',
  completed: 'done',
  archived:  'idle',
})

export const PHASE_STATUS_TONE: Record<PhaseStatus, Tone> = stageTones({
  pending:     'idle',
  in_progress: 'active',
  done:        'done',
})
