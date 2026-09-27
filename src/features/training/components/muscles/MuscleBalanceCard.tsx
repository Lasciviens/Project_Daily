import { Card, SectionLabel, useChartColors } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { PAIR_META, balanceInfo, type BalanceComparison, type BalancePair, type RatioRead } from '../../plan/muscleBalance'
import { CounterpartLine, RatioValue, WhyLine } from '../balance/BalanceBits'
import type { Balance } from './muscleVolumeModel'

function RatioRow({ read, comparison }: { read: RatioRead; comparison: BalanceComparison | null }) {
  const c = useChartColors()
  const m = PAIR_META[read.pair]
  const total = read.a + read.b || 1
  const pa = Math.round((read.a / total) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <span className="flex items-center gap-1 text-meta text-fg-2">{m.label} <InfoBubble>{balanceInfo(read.pair)}</InfoBubble></span>
        <RatioValue read={read} size="body" />
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div style={{ width: `${pa}%`, backgroundColor: c.series[0] }} />
        <div style={{ width: `${100 - pa}%`, backgroundColor: c.series[2] }} />
      </div>
      <p className="flex justify-between gap-2 text-meta tabular-nums text-fg-muted">
        <span>{read.a} {m.a}</span><span>{read.b} {m.b} sets/week</span>
      </p>
      {comparison && <CounterpartLine label="Planned in your program" read={comparison.planned} />}
      <WhyLine comparison={comparison} />
    </div>
  )
}

/** Push:pull and quad:hamstring of what was DONE in the window — the same
 *  ratio and verdict (muscleBalance.ts) as the Program tab's planned card,
 *  with the planned number beside it and a line on why they differ. */
export function MuscleBalanceCard({ balance, windowLabel, comparison }: {
  balance: Balance
  /** "in the last 30 days" or "1 Sep – 14 Sep". */
  windowLabel: string
  comparison: Record<BalancePair, BalanceComparison> | null
}) {
  if (balance.pushPull.lean === 'none' && balance.quadHam.lean === 'none') return null
  return (
    <Card className="flex max-w-xl flex-col gap-3">
      <SectionLabel>Muscle balance · done {windowLabel}</SectionLabel>
      {balance.pushPull.lean !== 'none' && <RatioRow read={balance.pushPull} comparison={comparison?.pushPull ?? null} />}
      {balance.quadHam.lean !== 'none' && <RatioRow read={balance.quadHam} comparison={comparison?.quadHam ?? null} />}
    </Card>
  )
}
