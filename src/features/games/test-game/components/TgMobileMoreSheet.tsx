import { useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive, ArrowLeft, History, ChartColumn, CircleCheckBig, Plus, SlidersHorizontal,
  type LucideProps,
} from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { TgSection } from '../testGameModel'
import { TgMobileSheet } from './TgMobileSheet'
import { TgThemeSwitch } from './TgThemeSwitch'
import { TgConnections } from './TgConnections'
import { TgPsnRenewDialog } from './TgPsnRenewDialog'
import { useTgAddGame } from './tgAddGame'

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
  const openAddGame = useTgAddGame(s => s.setOpen)
  const [renewOpen, setRenewOpen] = useState(false)

  const items: { key: TgSection; label: string; Icon: ComponentType<LucideProps>; count?: number }[] = [
    { key: 'completed', label: 'Completed', Icon: CircleCheckBig, count: counts.completed },
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

      <button
        type="button"
        onClick={() => { onClose(); openAddGame(true) }}
        className={`${ROW} text-[var(--tg-text)] ${ROW_IDLE}`}
      >
        <Plus size={19} strokeWidth={1.8} aria-hidden className="shrink-0" />
        Add game
      </button>

      <div className="my-3 h-px bg-[var(--tg-border)]" />

      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="tg-section-label">Theme</h3>
        <TgThemeSwitch />
      </div>

      <h3 className="tg-section-label mb-1 mt-4 px-1">Connections</h3>
      {/* The sheet's body only mounts while it is open, so these fetch on open only. */}
      <TgConnections onRenewPsn={() => setRenewOpen(true)} />
      {/* Nested inside the sheet's dialog so Headless UI stacks it on top. */}
      <TgPsnRenewDialog open={renewOpen} onClose={() => setRenewOpen(false)} />

      <div className="my-3 h-px bg-[var(--tg-border)]" />

      {/* Both replace the sheet's own history entry, so Back from the
          destination returns here instead of to a stale overlay entry. */}
      <button
        type="button"
        onClick={() => navigate('/games-legacy', { replace: true })}
        className={`${ROW} text-[var(--tg-text-2)] ${ROW_IDLE}`}
      >
        <History size={19} strokeWidth={1.8} aria-hidden className="shrink-0" />
        Legacy Games page
      </button>
      <button
        type="button"
        onClick={() => navigate('/home', { replace: true })}
        className={`${ROW} text-[var(--tg-text-2)] ${ROW_IDLE}`}
      >
        <ArrowLeft size={19} strokeWidth={1.8} aria-hidden className="shrink-0" />
        Back to Lasci's Board
      </button>
    </TgMobileSheet>
  )
}
