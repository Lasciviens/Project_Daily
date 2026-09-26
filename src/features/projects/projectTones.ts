import type { Tone } from '../../shared/ui'
import type { ItemStatus, ItemType, PhaseStatus, ProjectColor, ProjectStatus } from './types'

export { PRIORITY_TONE as ITEM_PRIORITY_TONE } from '../todo/taskTones'

// The one enum → tone map per project enum (THEME.md §2.4).

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  active:    'success',
  on_hold:   'warn',
  completed: 'info',
  archived:  'neutral',
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
}

export const PHASE_STATUS_TONE: Record<PhaseStatus, Tone> = {
  pending:     'neutral',
  in_progress: 'info',
  done:        'success',
}

export const ITEM_STATUS_TONE: Record<ItemStatus, Tone> = {
  open:        'neutral',
  in_progress: 'info',
  done:        'success',
  cancelled:   'neutral',
}

// Item type is a category, not a status; tones only keep the five apart.
export const ITEM_TYPE_TONE: Record<ItemType, Tone> = {
  update:      'info',
  improvement: 'success',
  ui_request:  'highlight',
  bug:         'danger',
  wishlist:    'star',
}

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  update: 'update', improvement: 'improve', ui_request: 'UI', bug: 'bug', wishlist: 'wish',
}

export const ITEM_TYPE_ORDER: ItemType[] = ['update', 'improvement', 'ui_request', 'bug', 'wishlist']

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
  amber:   'rgb(var(--chart-3))',
  rose:    'rgb(var(--chart-4))',
}

export const PROJECT_COLORS = Object.keys(PROJECT_COLOR) as ProjectColor[]
