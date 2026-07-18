import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared anatomy for the glance-board cells. Every module renders inside ONE
//  fixed grid slot of the board surface (TodaySummary): the cell paints its
//  own background over the board's hairline-gap backdrop and never draws its
//  own border — borders belong to top-level surfaces only. Header = icon chip
//  + 13px semibold title + exactly one right-side control.
// ─────────────────────────────────────────────────────────────────────────────

export function Cell({ children }: { children: ReactNode }) {
  return <div className="bg-cream-50 p-4 flex flex-col gap-2.5 h-full">{children}</div>
}

export function CellHeader({ icon, title, action }: { icon: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-[28px]">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-800">
        <span className="w-6 h-6 rounded-md bg-ink-100/60 grid place-items-center text-[13px] leading-none">{icon}</span>
        {title}
      </h3>
      {action}
    </div>
  )
}

// Quiet link-out — deliberately ink, not accent (the accent is budgeted for
// primary actions and "now" states, not navigation).
export function CellLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-[11px] font-medium text-ink-400 hover:text-accent-600 min-h-[28px] px-1 flex items-center transition-colors shrink-0"
    >
      {children}
    </Link>
  )
}
