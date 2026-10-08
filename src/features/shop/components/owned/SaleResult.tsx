import { add, boughtOn, complete, costOf, durationLabel, monthsBetween, type MoneyCtx } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import type { ShopCurrency, ShopItem } from '../../types'

/**
 * The live result line of a sale: what came back for what it cost, the cost
 * of use and how long it was kept. A sale in another currency waits for that
 * day's rate (never today's), so it says so instead of guessing.
 */
export function SaleResult({ item, sold, ctx, got, currency, on }: { item: ShopItem; sold: ShopItem[]; ctx: MoneyCtx; got: number | null; currency: ShopCurrency; on: string }) {
  const cost = add(...sold.map(r => costOf(r, ctx)))
  const from = boughtOn(item)
  const kept = from && on ? durationLabel(from, on) : null
  const months = from && on ? monthsBetween(from, on) : 0
  const what = sold.length > 1 ? `${item.title} + ${sold.length - 1} accessor${sold.length === 2 ? 'y' : 'ies'}` : item.title
  if (!complete(cost)) {
    return <p className="rounded-row bg-surface-2 p-3 text-meta text-fg-muted">The result shows once every price here is known (<AmountText amount={cost} />).</p>
  }
  if (got == null) {
    return <p className="rounded-row bg-surface-2 p-3 text-meta text-fg-muted">{what} cost {money(cost.nok)}{kept ? `, kept ${kept}` : ''}.</p>
  }
  if (currency !== 'NOK') {
    return (
      <p className="rounded-row bg-surface-2 p-3 text-meta text-fg-muted">
        Got {money(got, currency)} for {what} (paid {money(cost.nok)}). The result is worked out with Norges Bank's rate of that day once it is in.
      </p>
    )
  }
  const result = cost.nok - got
  return (
    <div className="rounded-row bg-surface-2 p-3 text-meta">
      <p className="text-fg-2">Got <strong className="tabular-nums">{money(got)}</strong> for {what} (paid {money(cost.nok)})</p>
      <p className="tabular-nums text-fg-muted">
        {result >= 0 ? <>Cost of use {money(result)}</> : <>Made {money(-result)}</>}
        {kept && <> · kept {kept}</>}
        {result > 0 && months >= 1 && <> · ≈ {money(result / months)}/month</>}
      </p>
    </div>
  )
}
