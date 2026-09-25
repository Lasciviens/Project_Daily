import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive, ArrowLeft, ChartColumn, CircleCheck, Monitor, Moon, SlidersHorizontal, Sun,
  type LucideProps,
} from 'lucide-react'
import { useThemeStore, type ThemePreference } from '../../../../app/store'
import { useTestGameStore } from '../testGameStore'
import type { TgSection } from '../testGameModel'
import { TgMobileSheet } from './TgMobileSheet'

const THEMES: { value: ThemePreference; label: string; Icon: ComponentType<LucideProps> }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

const ROW = 'flex w-full min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition-colors'
// Hover only where a pointer can hover: on touch, :hover sticks to whatever was
// tapped last (the row under the finger that opened this sheet) — press state instead.
const ROW_IDLE = 'active:bg-[var(--tg-hover)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]'

/** Everything the four-slot tab bar has no room for. */
export function TgMobileMoreSheet({ open, onClose, counts }: {
  open: boolean
  onClose: () => void
  counts: { completed: number; backlog: number }
}) {
  const navigate = useNavigate()
  const section = useTestGameStore(s => s.section)
  const setSection = useTestGameStore(s => s.setSection)
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)

  const items: { key: TgSection; label: string; Icon: ComponentType<LucideProps>; count?: number }[] = [
    { key: 'completed', label: 'Completed', Icon: CircleCheck, count: counts.completed },
    { key: 'backlog', label: 'Backlog', Icon: Archive, count: counts.backlog },
    { key: 'analytics', label: 'Analytics', Icon: ChartColumn },
    { key: 'advanced', label: 'Advanced tools', Icon: SlidersHorizontal },
  ]

  function go(key: TgSection) {
    if (key !== section) setSection(key) // re-picking the current one keeps its filters
    onClose()
  }

  return (
    <TgMobileSheet open={open} onClose={onClose} title="More">
      <nav aria-label="More sections" className="flex flex-col gap-1">
        {items.map(({ key, label, Icon, count }) => {
          const active = section === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(key)}
              aria-current={active ? 'page' : undefined}
              className={`${ROW} ${
                active
                  ? 'bg-[var(--tg-nav-active-bg)] font-semibold text-[var(--tg-nav-active-text)]'
                  : `text-[var(--tg-text)] ${ROW_IDLE}`
              }`}
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden className="shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {count != null && (
                <span
                  className={`min-w-[26px] rounded-md px-1.5 py-0.5 text-center text-[12px] font-semibold tabular-nums ${
                    active
                      ? 'bg-[var(--tg-nav-active-count-bg)] text-[var(--tg-nav-active-text)]'
                      : 'bg-[var(--tg-panel-2)] text-[var(--tg-muted)]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="my-3 h-px bg-[var(--tg-border)]" />

      <h3 className="tg-section-label mb-2 px-1">Theme</h3>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--tg-panel-2)] p-1">
        {THEMES.map(({ value, label, Icon }) => {
          const active = theme === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-[14px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--tg-panel)] text-[var(--tg-accent)] shadow-[shadow:var(--tg-shadow)]'
                  : 'text-[var(--tg-muted)]'
              }`}
            >
              <Icon size={16} strokeWidth={1.9} aria-hidden />
              {label}
            </button>
          )
        })}
      </div>

      <div className="my-3 h-px bg-[var(--tg-border)]" />

      <button
        type="button"
        // Replaces the sheet's own history entry, so Back from the Games page
        // returns here instead of to a stale overlay entry.
        onClick={() => navigate('/games', { replace: true })}
        className={`${ROW} text-[var(--tg-text-2)] ${ROW_IDLE}`}
      >
        <ArrowLeft size={19} strokeWidth={1.8} aria-hidden className="shrink-0" />
        Back to Lasci's Board
      </button>
    </TgMobileSheet>
  )
}
