import { DOMAIN_TONE } from './taskTones'
import type { TaskDomain } from './types'

// Single source of truth for domain label + colour across the app
// (ToDoItem, Home widgets, etc). The colour comes from DOMAIN_TONE, so both
// themes work; add a new domain in both maps and every consumer picks it up.
export const DOMAIN_LABEL: Record<TaskDomain, string> = {
  personal: 'Personal',
  work:     'Work',
  media:    'Media',
}

const TONE_TAG: Record<string, string> = {
  neutral:   'bg-neutral-soft text-neutral',
  info:      'bg-info-soft text-info',
  highlight: 'bg-highlight-soft text-highlight',
}
const TONE_DOT: Record<string, string> = {
  neutral:   'bg-neutral',
  info:      'bg-info',
  highlight: 'bg-highlight',
}

export const DOMAIN_TAG_CLASS: Record<TaskDomain, string> = {
  personal: TONE_TAG[DOMAIN_TONE.personal],
  work:     TONE_TAG[DOMAIN_TONE.work],
  media:    TONE_TAG[DOMAIN_TONE.media],
}

export const DOMAIN_DOT_CLASS: Record<TaskDomain, string> = {
  personal: TONE_DOT[DOMAIN_TONE.personal],
  work:     TONE_DOT[DOMAIN_TONE.work],
  media:    TONE_DOT[DOMAIN_TONE.media],
}
