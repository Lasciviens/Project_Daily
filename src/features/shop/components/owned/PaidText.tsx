import { currencyOf } from '../../shopModel'
import { paidOf, complete } from '../../ownModel'
import { money } from '../shopFormat'
import type { ShopItem } from '../../types'

/**
 * What was paid, as paid: "5 990 NOK", "8 999 TRY ≈ 4 840 NOK" (at that day's
 * rate), "8 999 TRY · rate pending", "Gift", "Price not set".
 */
export function PaidText({ item }: { item: ShopItem }) {
  if (item.got_as_gift && !item.price) return <>Gift</>
  if (item.price == null) return <span className="text-fg-faint">Price not set</span>
  const c = currencyOf(item)
  if (c === 'NOK') return <>{money(item.price)}</>
  const nok = paidOf(item)
  return (
    <>
      {money(item.price, c)}
      {complete(nok)
        ? <span className="text-fg-faint"> ≈ {money(nok.nok)}</span>
        : <span className="text-fg-faint" title="Norges Bank publishes the day's rate after 16:00 on weekdays; it is filled in by itself"> · rate pending</span>}
    </>
  )
}
