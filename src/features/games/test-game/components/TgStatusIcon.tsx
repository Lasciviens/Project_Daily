import type { JSX } from 'react'
import { STATUS_GLYPH } from './TgStatusMeta'

/**
 * The small filled status badge from the design: a disc in the status colour
 * with a white glyph — a dot for Playing, a check for Completed, a clock for
 * Backlog, a heart for Wishlist, a cross for Dropped. Decorative: the status
 * is always spelled out next to it.
 */
export function TgStatusIcon({ status, size = 13, className = '' }: { status: string; size?: number; className?: string }): JSX.Element {
  const glyph = STATUS_GLYPH[status]
  const Icon = glyph?.icon
  return (
    <span
      aria-hidden
      data-status={status}
      className={`inline-grid shrink-0 place-items-center rounded-full bg-[var(--st)] text-white ${className}`}
      style={{ width: size, height: size }}
    >
      {Icon ? (
        <Icon size={Math.round(size * 0.7)} strokeWidth={glyph.filled ? 0 : 3.25} fill={glyph.filled ? 'currentColor' : 'none'} />
      ) : (
        <span className="rounded-full bg-white" style={{ width: Math.round(size * 0.38), height: Math.round(size * 0.38) }} />
      )}
    </span>
  )
}
