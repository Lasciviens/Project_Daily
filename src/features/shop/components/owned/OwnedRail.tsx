import { History, PackagePlus } from 'lucide-react'
import { Button, Card, CardHeader, TonePill, Truncate } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDate } from '../../../../shared/utils/dateFormat'
import type { Deadline, OwnedSummary } from '../../ownModel'
import { AmountText } from '../shopKit'
import { amountReason } from '../shopFormat'
import { complete } from '../../ownModel'

/** "What I own": how many things, what they cost, what the valued ones could sell for. */
export function OwnedSummaryCard({ summary, onAdd, onAddHad }: { summary: OwnedSummary; onAdd: () => void; onAddHad: () => void }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-micro text-fg-faint">What I own</p>
        <InfoBubble label="About these numbers">
          Each purchase is counted in NOK at the exchange rate of the day it was bought (Norges Bank's), so a lira price keeps its worth from back then.
          "Could sell for" is your own estimate; only things that have one are added up there.
        </InfoBubble>
      </div>
      <p className="text-lead font-semibold tabular-nums text-fg">
        {summary.mine} thing{summary.mine === 1 ? '' : 's'}
        {summary.accessories > 0 && <span className="text-body font-normal text-fg-muted"> + {summary.accessories} accessor{summary.accessories === 1 ? 'y' : 'ies'}</span>}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-meta">
        <div><dt className="text-fg-muted">Paid</dt><dd className="font-semibold text-fg"><AmountText amount={summary.paid} /></dd></div>
        <div>
          <dt className="text-fg-muted">Could sell for</dt>
          <dd className="font-semibold text-fg">{summary.valued ? <AmountText amount={summary.worth} /> : <span className="font-normal text-fg-faint">Not set yet</span>}</dd>
        </div>
        {summary.valued > 0 && summary.valued < summary.mine + summary.accessories && (
          <p className="col-span-2 text-fg-faint">{summary.valued} of {summary.mine + summary.accessories} have a "Could sell for"</p>
        )}
        {!complete(summary.paid) && <p className="col-span-2 text-fg-faint">Paid is Unknown until: {amountReason(summary.paid)}.</p>}
        {summary.gone > 0 && <p className="col-span-2 text-fg-muted">{summary.gone} sold or gone</p>}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" icon={<PackagePlus />} onClick={onAdd}>Add something I own</Button>
        <Button size="sm" variant="ghost" icon={<History />} onClick={onAddHad}>Something I had</Button>
      </div>
    </Card>
  )
}

/** Return windows (14 days) and complaint rights (60 days) about to end, soonest first. */
export function ComingUpCard({ deadlines, onOpen }: { deadlines: Deadline[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader title="Coming up" variant="label" />
      <ul className="-mx-2 flex flex-col">
        {deadlines.slice(0, 6).map(d => (
          <li key={`${d.item.id}-${d.kind}`}>
            <button type="button" onClick={() => onOpen(d.item.id)} className="flex min-h-[44px] w-full items-center gap-2 rounded-row px-2 text-left hover:bg-surface-hover">
              <span className="min-w-0 flex-1">
                <Truncate as="span" className="block text-body text-fg-2">{d.item.title}</Truncate>
                <span className="block text-meta tabular-nums text-fg-muted">
                  {d.kind === 'return' ? 'Return by' : 'Can complain until'} {formatDate(d.day)}
                </span>
              </span>
              <TonePill tone={d.daysLeft <= 7 ? 'warn' : 'neutral'} className="shrink-0 tabular-nums">
                {d.daysLeft === 0 ? 'Today' : `${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`}
              </TonePill>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
