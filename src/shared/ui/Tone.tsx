import type { ReactNode } from 'react'
import { cx } from './cx'

/** Semantic status colours (THEME.md §2.4). Never pick a raw colour for a status. */
export type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral' | 'highlight' | 'star' | 'accent'

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span data-tone={tone} aria-hidden className={cx('tone-dot', className)} />
}

export function TonePill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span data-tone={tone} className={cx('tone-pill', className)}>{children}</span>
}
