import type { ReactNode } from 'react'
import { Card, CardHeader, cx } from '../../../shared/ui'

/** The Progress/Health chart frame: eyebrow title, optional right action, body. */
export function ChartCard({ title, action, children, className }: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cx('flex flex-col gap-2', className)}>
      <CardHeader variant="label" title={title} action={action} className="!mb-1" />
      {children}
    </Card>
  )
}

/** Explanatory copy under a chart. */
export function ChartNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('max-w-3xl text-meta text-fg-muted', className)}>{children}</div>
}

/** Empty state inside a chart frame. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-body text-fg-muted">{children}</p>
}
