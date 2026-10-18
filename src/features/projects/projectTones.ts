import type { Tone } from '../../shared/ui'
import { stageTones } from '../../shared/theme/stage'
import type { PhaseStatus, ProjectColor, ProjectStatus } from './types'

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

/**
 * A project's own colour is identity the user picked, not a status. It maps
 * onto the theme's categorical chart palette (plus `info` for blue), so it
 * follows light / dark like every other token.
 */
export const PROJECT_COLOR: Record<ProjectColor, string> = {
  slate:   'rgb(var(--chart-6))',
  blue:    'rgb(var(--info))',
  violet:  'rgb(var(--chart-2))',
  emerald: 'rgb(var(--chart-1))',
  // Series 3 is magenta now (no chart colour may share a status hue); the
  // project colour the user picked as "amber" stays amber.
  amber:   'rgb(var(--warn))',
  rose:    'rgb(var(--chart-4))',
}

export const PROJECT_COLORS = Object.keys(PROJECT_COLOR) as ProjectColor[]
