import type { ComponentProps } from 'react'
import { Card } from '../../../../shared/ui'
import { TrendStatsBlock } from './TrendStatsBlock'

// The trend statistics of one key metric as its own small card under a section.
export function TrendCard({ title, ...props }: { title: string } & ComponentProps<typeof TrendStatsBlock>) {
  return (
    <Card>
      <p className="mb-2 text-body font-semibold text-fg">{title}</p>
      <TrendStatsBlock {...props} />
    </Card>
  )
}
