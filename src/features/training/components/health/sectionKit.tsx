import type { ReactNode } from 'react'
import { Card, cx } from '../../../../shared/ui'

/** A Health section's panel. */
export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cx('flex flex-col gap-3', className)}>{children}</Card>
}

/** Eyebrow + big number: the section's headline figure. */
export function HeadlineStat({ label, value, unit }: { label: ReactNode; value: ReactNode; unit?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="section-label">{label}</p>
      <p className="text-kpi font-bold leading-tight tabular-nums tracking-tight text-fg">
        {value}
        {unit != null && <span className="text-body font-normal text-fg-muted"> {unit}</span>}
      </p>
    </div>
  )
}

/** A secondary figure beside the headline. */
export function SideStat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-lead font-bold tabular-nums text-fg">{value}</p>
      <p className="text-micro font-normal text-fg-muted">{label}</p>
    </div>
  )
}
