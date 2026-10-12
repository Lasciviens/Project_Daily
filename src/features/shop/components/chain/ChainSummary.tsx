import { Card, cx } from '../../../../shared/ui'
import { complete } from '../../ownModel'
import { finalCostOf, type Chain } from '../../chainModel'
import type { DraftOutcome } from '../../chainDraft'
import { AmountText } from '../shopKit'
import { finalCostWords, money } from '../shopFormat'
import type { Headline } from './chainText'

/**
 * The answer, live: what the whole chain made or lost (a thing still yours at
 * its "Could sell for"), what it cost and brought back, how much of your own
 * money went in on top of the sales, and what is back in hand.
 */
export function ChainSummary({ chain, outcome, head, toSell }: { chain: Chain | null; outcome: DraftOutcome | null; head: Headline; toSell: boolean }) {
  // A loss on things you used is their cost of use (neutral); only a chain bought to sell shows its profit in green.
  const tone = head.sign != null && head.sign > 0 && toSell ? 'text-success' : 'text-fg'
  return (
    <Card className="flex flex-col gap-2" aria-live="polite">
      <p className="section-label">{head.label}</p>
      <p className={cx('text-kpi font-bold tabular-nums', head.sign == null ? 'text-fg-muted' : tone)}>{head.value}</p>
      {outcome && chain && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-meta">
          <div><dt className="text-fg-muted">Paid</dt><dd className="font-semibold text-fg"><AmountText amount={outcome.paid} /></dd></div>
          <div><dt className="text-fg-muted">Got back</dt><dd className="font-semibold text-fg"><AmountText amount={outcome.got} /></dd></div>
          <div><dt className="text-fg-muted">Your own money in</dt><dd className="font-semibold text-fg"><AmountText amount={outcome.ownMoney} /></dd></div>
          {complete(outcome.addedAlong) && Math.round(outcome.addedAlong.nok) > 0 && (
            <div><dt className="text-fg-muted">Added along the way</dt><dd className="font-semibold text-fg">{money(outcome.addedAlong.nok)}</dd></div>
          )}
          {complete(outcome.inHand) && Math.round(outcome.inHand.nok) > 0 && (
            <div><dt className="text-fg-muted">Back in hand</dt><dd className="font-semibold text-fg">{money(outcome.inHand.nok)}</dd></div>
          )}
        </dl>
      )}
      {outcome?.held.map(h => {
        const final = chain ? finalCostOf(chain, h.node.id) : null
        if (!final || !complete(final.total) || !complete(final.own) || !complete(final.carried) || Math.round(final.carried.nok) === 0) return null
        return (
          <p key={h.node.id} className="text-meta text-fg-2">
            {h.node.item.title || 'The last thing'} really cost you <strong className="tabular-nums">{money(final.total.nok)}</strong>
            <span className="text-fg-muted"> ({finalCostWords(final.own.nok, final.carried.nok)})</span>
          </p>
        )
      })}
      {head.note && <p className="text-meta text-fg-muted">{head.note}</p>}
    </Card>
  )
}
