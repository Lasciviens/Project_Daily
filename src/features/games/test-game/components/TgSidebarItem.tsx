import type { ReactNode } from 'react'

/**
 * One navigation row. 31px on a mouse — the design's rhythm, which keeps the
 * sections and a good run of platforms on a 680px-tall laptop — while
 * testGame.css keeps touch at 44px. `!` because testGame.css loads after the
 * Tailwind utilities, so a plain utility would lose to `.tg-nav-item`.
 *
 * `iconOnly` is the folded panel's rail: a 44px square with the label as its
 * accessible name and tooltip, and the count as a small badge on the icon.
 */
export function TgSidebarItem({
  icon, label, count, accentCount = false, active, onClick, title, pressed, iconOnly = false,
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
  iconOnly?: boolean
}) {
  const aria = {
    'aria-current': pressed === undefined && active ? 'page' as const : undefined,
    'aria-pressed': pressed,
  }
  if (iconOnly) {
    const tip = count != null ? `${label} · ${count.toLocaleString('en-GB')}` : label
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? tip}
        aria-label={tip}
        {...aria}
        className={`tg-nav-item relative mx-auto !h-11 !w-11 !justify-center !p-0 ${active ? 'is-active' : ''}`}
      >
        {icon}
        {count != null && (
          <span
            aria-hidden
            className={`absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-semibold leading-none tabular-nums ${
              accentCount || active
                ? 'bg-[var(--tg-accent)] text-[var(--tg-on-accent)]'
                : 'bg-[var(--tg-panel-2)] text-[var(--tg-muted)] ring-1 ring-[var(--tg-border)]'
            }`}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      {...aria}
      className={`tg-nav-item !gap-3.5 !pl-3 !pr-2 [@media(pointer:fine)]:!min-h-[31px] ${active ? 'is-active' : ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span
          className={`tg-count ${accentCount ? '!bg-[var(--tg-nav-active-count-bg)] !text-[var(--tg-nav-active-text)]' : ''}`}
        >
          {count.toLocaleString('en-GB')}
        </span>
      )}
    </button>
  )
}
