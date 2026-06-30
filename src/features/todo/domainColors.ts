import type { TaskDomain } from './types'

// Single source of truth for domain/category colour + label across the app
// (ToDoItem, Home widgets, etc). Add a new domain here and every consumer
// picks it up automatically.
export const DOMAIN_LABEL: Record<TaskDomain, string> = {
  personal: 'Personal',
  work:     'Work',
  media:    'Media',
}

export const DOMAIN_TAG_CLASS: Record<TaskDomain, string> = {
  personal: 'bg-accent-50 text-accent-600',
  work:     'bg-blue-50 text-blue-600',
  media:    'bg-purple-50 text-purple-600',
}

export const DOMAIN_DOT_CLASS: Record<TaskDomain, string> = {
  personal: 'bg-accent-400',
  work:     'bg-blue-400',
  media:    'bg-purple-400',
}
