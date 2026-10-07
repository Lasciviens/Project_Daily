import type { TaskDomain } from './types'

// Single source of truth for the domain label across the app (ToDoItem, the
// plan modal). Colours live in DOMAIN_TONE (taskTones.ts).
export const DOMAIN_LABEL: Record<TaskDomain, string> = {
  personal: 'Personal',
  work:     'Work',
  media:    'Media',
}
