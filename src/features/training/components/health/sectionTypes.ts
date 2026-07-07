export type SectionId = 'overview' | 'steps' | 'energy' | 'heart' | 'sleep' | 'body' | 'all'

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '⭕' },
  { id: 'steps',    label: 'Steps',    icon: '🚶' },
  { id: 'energy',   label: 'Energy',   icon: '🔥' },
  { id: 'heart',    label: 'Heart',    icon: '❤️' },
  { id: 'sleep',    label: 'Sleep',    icon: '😴' },
  { id: 'body',     label: 'Body',     icon: '⚖️' },
  { id: 'all',      label: 'All Data', icon: '📊' },
]
