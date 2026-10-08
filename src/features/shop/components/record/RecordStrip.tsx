import type { ReactNode } from 'react'
import { Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { currencyOf, priceNow, wishRange } from '../../shopModel'
import { bestMatch } from '../../wishModel'
import { add, boughtOn, complete, costOf, durationLabel, gotOf, minus, perMonth, valueNowOf, ZERO, type Amount, type MoneyCtx } from '../../ownModel'
import { finalCostOf, ifSoldNow, type Chain, type IfSold } from '../../chainModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import { PaidText } from '../owned/PaidText'
import type { RecordState } from './recordState'
import type { ShopItem, ShopPriceWatch } from '../../types'

function Cell({ label, children, hint, strong }: { label: string; children: ReactNode; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-row border border-line bg-surface-2 px-3 py-2">
      <p className="section-label">{label}</p>
      <p className={cx('mt-0.5 text-ui tabular-nums text-fg', strong && 'font-semibold')}>{children}</p>
      {hint != null && <Truncate as="p" className="text-micro text-fg-faint">{hint}</Truncate>}
    </div>
  )
}

/** "If sold now": made / cost you, at "Could sell for" — the whole chain's when it is in one, with this thing's own beside it. */
function IfSoldCell({ sold, resale, chained }: { sold: IfSold | null; resale: boolean; chained: boolean }) {
  if (!sold) return <Cell label="If sold now" hint='needs "Could sell for"'>—</Cell>
  const main = sold.route ?? sold.own
  const signed = (a: Amount) => (!complete(a) ? null : `${a.nok >= 0 ? '+' : '−'}${money(Math.abs(a.nok))}`)
  const made = complete(main) && main.nok > 0
  return (
    <Cell label="If sold now" strong hint={chained ? (signed(sold.own) ? `this one alone ${signed(sold.own)}` : 'with the chain') : 'at "Could sell for"'}>
      {complete(main)
        ? <span className={cx(made && resale && 'text-success')}>{main.nok >= 0 ? 'Made ' : 'Cost you '}{money(Math.abs(main.nok))}</span>
        : <AmountText amount={main} />}
    </Cell>
  )
}

/** Four numbers that answer the row's question at a glance — which four depends on where it is in its life. */
export function RecordStrip({ item, state, ctx, chain, watch, models, watches, accessories, today }: {
  item: ShopItem
  state: RecordState
  ctx: MoneyCtx
  chain: Chain | null
  watch: ShopPriceWatch | null
  models: ShopItem[]
  watches: ReadonlyMap<string, ShopPriceWatch>
  accessories: ShopItem[]
  today: string
}) {
  const cur = currencyOf(item)
  const cells: ReactNode[] = []
  if (state === 'general') {
    const range = wishRange(item, models, ctx.rates, watches)
    const open = models.filter(m => m.status === 'wishlist')
    const prices = open.map(m => priceNow(m, watches.get(m.id))).filter((p): p is NonNullable<typeof p> => !!p)
    const best = bestMatch(item, models, m => priceNow(m, watches.get(m.id)))
    cells.push(
      <Cell key="r" label="Price range">{range ? `${money(range.min, cur).replace(` ${cur}`, '')}–${money(range.max, cur)}` : '—'}</Cell>,
      <Cell key="m" label="Models">{open.length} in the running</Cell>,
      <Cell key="f" label="From">{prices.length ? money(Math.min(...prices.map(p => p.amount)), prices[0].currency) : '—'}</Cell>,
      <Cell key="b" label="Best match" hint={best ? undefined : 'none yet'}>{best ? <Truncate as="span">{best.title}</Truncate> : '—'}</Cell>,
    )
  } else if (state === 'buy') {
    const now = watch && watch.url === item.url && watch.low != null ? watch : null
    cells.push(
      <Cell key="p" label="Price" strong>{item.price != null ? money(item.price, cur) : '—'}</Cell>,
      <Cell key="n" label="Price now" hint={now ? `${now.source === 'prisjakt' ? 'Prisjakt' : 'the shop'} · ${formatDate(now.last_ok_at ?? now.checked_at)}` : item.url ? 'not checked yet' : 'add a link to watch it'}>
        {now ? money(now.low as number, (now.currency ?? cur).toUpperCase()) : '—'}
      </Cell>,
      <Cell key="t" label="Target">{item.target_price != null ? money(item.target_price, cur) : '—'}</Cell>,
      <Cell key="w" label={item.wait_for_deal ? 'Deal from' : 'Buy on'}>{item.planned_date ? formatDate(item.planned_date) : item.wait_for_deal ? 'Any day' : '—'}</Cell>,
    )
  } else if (state === 'mine' || state === 'gone') {
    const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
    const from = boughtOn(item)
    const per = perMonth(item, ctx, today, accessories)
    // An accessory's chain node is its item's: its own route cost is not one.
    const final = chain && !item.accessory_of ? finalCostOf(chain, item.id) : null
    cells.push(<Cell key="p" label="Paid" strong><PaidText item={item} /></Cell>)
    if (state === 'mine') {
      const value = valueNowOf(item, ctx)
      cells.push(
        <Cell key="v" label="Could sell for" hint={item.value_on ? formatDate(item.value_on) : 'not set'}>{value ? <AmountText amount={value} /> : '—'}</Cell>,
        final
          ? <Cell key="f" label="Final cost" hint={chain?.name ? `with earlier things in ${chain.name}` : 'with earlier things in its chain'}><AmountText amount={final.total} /></Cell>
          : <Cell key="m" label="Per month" hint={per ? 'paid − could sell for' : 'needs "Could sell for"'}>{per ? `≈ ${money(per.nok)}` : '—'}</Cell>,
        <IfSoldCell key="s" sold={ifSoldNow(item, accessories, ctx, final)} resale={!!item.for_resale} chained={!!final} />,
      )
    } else {
      const got = add(gotOf(item) ?? ZERO, ...together.map(a => gotOf(a) ?? ZERO))
      const result = minus(add(costOf(item, ctx), ...together.map(a => costOf(a, ctx))), got)
      const profit = complete(result) && result.nok < 0
      cells.push(
        <Cell key="g" label="Got back" hint={together.length ? `with ${together.length} accessor${together.length === 1 ? 'y' : 'ies'}` : item.sold_to ?? undefined}><AmountText amount={got} /></Cell>,
        <Cell key="k" label="Kept">{from && item.disposed_on ? durationLabel(from, item.disposed_on) : '—'}</Cell>,
        <Cell key="r" label={profit ? 'Made' : 'Cost you'} hint={per ? `≈ ${money(per.nok)}/month` : undefined}>
          {profit ? <span className={item.for_resale ? 'text-success' : undefined}>{money(-result.nok)}</span> : <AmountText amount={result} />}
        </Cell>,
      )
    }
  } else {
    const from = boughtOn(item)
    cells.push(
      <Cell key="p" label={item.status === 'bought' ? 'Paid' : 'Price'}>{item.price != null ? <PaidText item={item} /> : '—'}</Cell>,
      <Cell key="d" label="Bought on">{from ? formatDate(from) : '—'}</Cell>,
    )
  }
  return <div className="grid grid-cols-2 gap-2 @[40rem]:grid-cols-4">{cells}</div>
}
