import { Scale } from 'lucide-react'
import { Card, CardHeader, ToneDot } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import type { BalanceRead } from '../../plan/programBalance'
import { SourceNote } from './SourceNote'

function Ratio({ label, left, right, value, flagged, info }: { label: string; left: string; right: string; value: string; flagged: boolean; info: string }) {
  return (
    <div className="min-w-0">
      <p className="section-label flex items-center gap-1.5">{label} <InfoBubble>{info}</InfoBubble></p>
      <p className="mt-1 flex items-center gap-2 text-kpi font-bold tabular-nums text-fg"><ToneDot tone={flagged ? 'warn' : 'success'} />{value}</p>
      <p className="text-meta text-fg-muted">{left} vs {right}</p>
    </div>
  )
}

/** Push:pull and quad:hamstring balance of the planned week. */
export function BalanceCard({ balance }: { balance: BalanceRead }) {
  const b = balance
  return (
    <Card className="max-w-2xl">
      <CardHeader icon={<Scale />} title="Balance" subtitle="Planned weekly sets, same counting as above" />
      <div className="grid grid-cols-2 gap-4">
        <Ratio
          label="Push : pull"
          value={b.pushPullRatio != null ? `${b.pushPullRatio} : 1` : b.push + b.pull === 0 ? '—' : b.push > 0 ? 'push only' : 'pull only'}
          left={`${b.push} push (chest, shoulders, triceps)`}
          right={`${b.pull} pull (back, traps, biceps)`}
          flagged={b.pushPullFlag != null}
          info="Roughly 1 : 1 is the usual aim, flagged outside 0.67–1.5. A rule of thumb with no trial behind the exact cut-off; recreational lifters often over-train pressing. Shoulders count as push, although rear-delt work is pulling."
        />
        <Ratio
          label="Hamstring : quad"
          value={b.hamQuadRatio != null ? `${b.hamQuadRatio} : 1` : '—'}
          left={`${b.ham} hamstring`}
          right={`${b.quad} quad`}
          flagged={b.hamQuadFlag || (!b.hasKneeFlexion && b.quad + b.ham > 0)}
          info="Hamstrings under about half the quad sets is a soft flag (a heuristic). Including a knee-flexion exercise — a leg curl or the Nordic curl — is the part with evidence: programmes with the Nordic curl roughly halved hamstring injuries in athletes."
        />
      </div>
      {b.notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
          {b.notes.map((n, i) => <li key={i} className="flex items-start gap-2 text-body text-fg-2"><ToneDot tone="warn" className="mt-1.5 shrink-0" />{n}</li>)}
        </ul>
      )}
      <div className="mt-3"><SourceNote ids={['kolber2009', 'vanDyk2019']} /></div>
    </Card>
  )
}
