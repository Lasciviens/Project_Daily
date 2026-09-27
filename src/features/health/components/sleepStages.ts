import type { SleepStageKey } from '../healthAggregate'

// Sleep-stage colours are identity data users know by colour (THEME.md §2.5):
// literal and the same in both themes. 'unstaged' is Apple's plain "Asleep"
// (sleep with no stage), so it takes a neutral slate rather than a stage hue.
export const SLEEP_STAGES: { key: SleepStageKey; label: string; color: string }[] = [
  { key: 'deep',     label: 'Deep',     color: '#4338ca' },
  { key: 'core',     label: 'Core',     color: '#6366f1' },
  { key: 'rem',      label: 'REM',      color: '#a5b4fc' },
  { key: 'unstaged', label: 'Asleep (no stage)', color: '#94a3b8' },
  { key: 'awake',    label: 'Awake',    color: '#f87171' },
]
export const SLEEP_COLOR = '#6366f1'
export const AWAKE_COLOR = '#f87171'
