import type { ReactNode } from 'react'
import { Card, CardHeader, SegmentedControl, cx, type SegmentedOption } from '../../../../shared/ui'

// The Stats screen's shared pieces: a card, legend swatches and thin bars.

/** A Stats card: header (title, one-line subtitle, an action such as a legend) and body. */
export function StatsCard({ title, subtitle, action, children, className }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('min-w-0', className)}>
      <CardHeader title={title} subtitle={subtitle} action={action} wrap />
      {children}
    </Card>
  )
}

/** A legend key: a small bar in the series colour, the label in text colour. */
export function Swatch({ color, className, label }: { color?: string; className?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-micro text-fg-muted">
      <span aria-hidden className={cx('h-2 w-3 rounded-sm', className)} style={color ? { background: color } : undefined} />
      {label}
    </span>
  )
}

/** A thin horizontal bar, `value` of `max`; nothing drawn for 0. */
export function HBar({ value, max, color, className }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 && value > 0 ? Math.max(1.5, Math.min(100, (value / max) * 100)) : 0
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      {pct > 0 && <span className={cx('block h-full rounded-full', className)} style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />}
    </span>
  )
}

/** A card's own filter: a small segmented control under its header. */
export function CardFilter<T extends string>({ label, options, value, onChange }: { label: string; options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="mb-3">
      <SegmentedControl size="sm" options={options} value={value} onChange={onChange} />
    </div>
  )
}
