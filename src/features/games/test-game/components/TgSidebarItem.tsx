import type { ReactNode } from 'react'

/**
 * One sidebar row. 32px on a mouse — the design's rhythm, which is what lets
 * the whole list fit a 680px-tall laptop without scrolling — while
 * testGame.css keeps touch at 44px. `!` because testGame.css loads after the
 * Tailwind utilities, so a plain utility would lose to `.tg-nav-item`.
 */
export function TgSidebarItem({
  icon, label, count, accentCount = false, active, onClick, title, pressed,
}: {
  icon: ReactNode
  label: string
  count?: number
  /** The queue badge: tinted like the active row's badge to read as "waiting for you". */
  accentCount?: boolean
  active: boolean
  onClick: () => void
  title?: string
  /** Toggle rows (platforms) report aria-pressed; section rows aria-current. */
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={pressed === undefined && active ? 'page' : undefined}
      aria-pressed={pressed}
      className={`tg-nav-item !gap-3.5 !pl-3 !pr-2 [@media(pointer:fine)]:!min-h-[32px] ${active ? 'is-active' : ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span
          className={`tg-count ${accentCount ? '!bg-[var(--tg-nav-active-count-bg)] !text-[var(--tg-nav-active-text)]' : ''}`}
        >
          {count}
        </span>
      )}
    </button>
  )
}
