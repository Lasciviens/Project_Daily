import { Scale } from 'lucide-react'
import { Card, CardHeader, ToneDot } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { PAIR_META, balanceInfo, sidesText, type BalanceComparison, type BalancePair, type RatioRead } from '../../plan/muscleBalance'
import type { BalanceRead } from '../../plan/programBalance'
import { CounterpartLine, RatioValue, WhyLine } from '../balance/BalanceBits'
import { SourceNote } from './SourceNote'

function Ratio({ read, comparison, doneLabel }: { read: RatioRead; comparison: BalanceComparison | null; doneLabel: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="section-label flex items-center gap-1.5">{PAIR_META[read.pair].label} <InfoBubble>{balanceInfo(read.pair)}</InfoBubble></p>
      <RatioValue read={read} />
      <p className="text-meta tabular-nums text-fg-muted">{sidesText(read)}</p>
      {comparison && <CounterpartLine label={doneLabel} read={comparison.done} />}
      <WhyLine comparison={comparison} />
    </div>
  )
}

/** Push:pull and quad:hamstring of the PLANNED week — the same ratio and
 *  verdict (muscleBalance.ts) as the Muscles body map on Progress, which
 *  reads what was DONE; each shows the other's number, and one line says
 *  why when they differ. */
export function BalanceCard({ balance, comparison, doneWindowDays }: {
  balance: BalanceRead
  comparison: Record<BalancePair, BalanceComparison> | null
  doneWindowDays: number
}) {
  const doneLabel = `Done in the last ${doneWindowDays} days`
  return (
    <Card className="max-w-2xl">
      <CardHeader icon={<Scale />} title="Balance" subtitle="Planned in your program · weekly sets" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Ratio read={balance.pushPull} comparison={comparison?.pushPull ?? null} doneLabel={doneLabel} />
        <Ratio read={balance.quadHam} comparison={comparison?.quadHam ?? null} doneLabel={doneLabel} />
      </div>
      {balance.notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
          {balance.notes.map((n, i) => <li key={i} className="flex items-start gap-2 text-body text-fg-2"><ToneDot tone={n.tone} className="mt-1.5 shrink-0" />{n.text}</li>)}
        </ul>
      )}
      <div className="mt-3"><SourceNote ids={['kolber2009', 'vanDyk2019']} /></div>
    </Card>
  )
}
