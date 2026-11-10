import type { ReactNode } from 'react'
import { Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { currencyOf, priceNow, wishRange } from '../../shopModel'
import { bestMatch } from '../../wishModel'
import { add, boughtOn, complete, costOf, durationLabel, extrasOf, gotOf, minus, perMonth, perMonthWords, valueNowOf, ZERO, type Amount, type MoneyCtx } from '../../ownModel'
import { finalCostOf, ifSoldNow, type Chain, type IfSold } from '../../chainModel'
import { AmountText } from '../shopKit'
import { hostOf, money, moneyRange } from '../shopFormat'
import { PaidText } from '../owned/PaidText'
import { mixedWords, noPriceHint } from '../../watchWords'
import type { RecordState } from './recordState'
import type { ShopItem, ShopPriceWatch } from '../../types'

function Cell({ label, children, hint, strong }: { label: string; children: ReactNode; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-row border border-line bg-surface-2 px-3 py-2">
      <p className="section-label">{label}</p>
      <p className={cx('mt-0.5 text-ui tabular-nums text-fg', strong && 'font-semibold')}>{children}</p>
      {hint != null && <Truncate as="p" className="text-micro text-fg-muted">{hint}</Truncate>}
    </div>
  )
}

/**
 * The net if sold now: made / cost you, at "Could sell for" — the whole chain's when it is in one, with this
 * thing's own beside it; else what it costs a month.
 */
function IfSoldCell({ sold, chained, monthly }: { sold: IfSold | null; chained: boolean; monthly: string | null }) {
  if (!sold) return <Cell label="Net if sold now" hint='needs "Could sell for"'>—</Cell>
  const main = sold.route ?? sold.own
  const signed = (a: Amount) => (!complete(a) ? null : `${a.nok >= 0 ? '+' : '−'}${money(Math.abs(a.nok))}`)
  const made = complete(main) && main.nok > 0
  return (
    <Cell label="Net if sold now" strong hint={chained ? (signed(sold.own) ? `this one alone ${signed(sold.own)}` : 'with the chain') : monthly ?? 'at "Could sell for"'}>
      {complete(main)
        ? <span className={cx(made && 'text-success')}>{main.nok >= 0 ? 'Made ' : 'Cost you '}{money(Math.abs(main.nok))}</span>
        : <AmountText amount={main} />}
    </Cell>
  )
}

/**
 * "Price now" in the strip: the price read and where from — and its day, or ", new and used" when it may be a used
 * one — or why there is none: a refusal, a check that failed on its day, no new offer, never "not checked yet" for a
 * link that was checked.
 */
function PriceNowCell({ item, watch }: { item: ShopItem; watch: ShopPriceWatch | null }) {
  const w = watch && watch.url === item.url ? watch : null
  if (!w || (w.low == null && w.status === 'ok')) return <Cell label="Price now" hint={item.url ? 'not checked yet' : 'add a link to watch it'}>—</Cell>
  if (w.low == null) return <Cell label="Price now" hint={noPriceHint(w)}>—</Cell>
  const src = w.source === 'prisjakt' ? 'Prisjakt' : hostOf(item.url) ?? 'the shop'
  const mixed = mixedWords(w)
  return (
    <Cell label="Price now" hint={mixed ? `${src}${mixed}` : `${src} · ${formatDate(w.last_ok_at ?? w.checked_at)}`}>
      {money(w.low, (w.currency ?? currencyOf(item)).toUpperCase())}
    </Cell>
  )
}

/**
 * Four numbers that answer the row's question at a glance — which four depends on where it is in its life: to buy,
 * its price, the price now, the target and the day; yours, the money strip — paid, extra costs, could sell for and
 * the net if sold now; gone, paid, costs, got back and the net.
 */
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
      <Cell key="r" label="Price range">{range ? moneyRange(range.min, range.max, cur) : '—'}</Cell>,
      <Cell key="m" label="Models">{open.length} in the running</Cell>,
      <Cell key="f" label="From">{prices.length ? money(Math.min(...prices.map(p => p.amount)), prices[0].currency) : '—'}</Cell>,
      <Cell key="b" label="Best match" hint={best ? undefined : 'none yet'}>{best ? <Truncate as="span">{best.title}</Truncate> : '—'}</Cell>,
    )
  } else if (state === 'buy') {
    cells.push(
      <Cell key="p" label="Price" strong>{item.price != null ? money(item.price, cur) : '—'}</Cell>,
      <PriceNowCell key="n" item={item} watch={watch} />,
      <Cell key="t" label="Target">{item.target_price != null ? money(item.target_price, cur) : '—'}</Cell>,
      <Cell key="w" label={item.wait_for_deal ? 'Deal from' : 'Buy on'}>{item.planned_date ? formatDate(item.planned_date) : item.wait_for_deal ? 'Any day' : '—'}</Cell>,
    )
  } else if (state === 'mine' || state === 'gone') {
    // The money strip (step A): paid, its extra costs, what it could sell for or got back, and the net.
    const together = item.sale_group ? accessories.filter(a => a.sale_group === item.sale_group) : []
    const from = boughtOn(item)
    const per = perMonth(item, ctx, today, accessories)
    const perWords = per ? perMonthWords(per.nok) : null
    const monthly = perWords ? `≈ ${money(perWords.nok)} a month${perWords.label === 'Gained' ? ' gained' : ''}` : null
    const extras = ctx.costs.get(item.id) ?? []
    cells.push(
      <Cell key="p" label="Paid" strong hint={from ? `${item.approx_dates ? '≈ ' : ''}${formatDate(from)}` : undefined}><PaidText item={item} /></Cell>,
      <Cell key="c" label="Costs" hint={extras.length ? `${extras.length} extra cost${extras.length === 1 ? '' : 's'}` : 'repairs, fees, cover'}>
        {extras.length ? <AmountText amount={extrasOf(item, ctx)} /> : 'None'}
      </Cell>,
    )
    if (state === 'mine') {
      // An accessory's chain node is its item's: its own route cost is not one.
      const final = chain && !item.accessory_of ? finalCostOf(chain, item.id) : null
      const value = valueNowOf(item, ctx)
      cells.push(
        <Cell key="v" label="Could sell for" hint={item.value_on ? formatDate(item.value_on) : 'not set'}>{value ? <AmountText amount={value} /> : '—'}</Cell>,
        <IfSoldCell key="s" sold={ifSoldNow(item, accessories, ctx, final)} chained={!!final} monthly={monthly} />,
      )
    } else {
      const got = add(gotOf(item) ?? ZERO, ...together.map(a => gotOf(a) ?? ZERO))
      const result = minus(add(costOf(item, ctx), ...together.map(a => costOf(a, ctx))), got)
      const profit = complete(result) && result.nok < 0
      cells.push(
        <Cell key="g" label="Got back" hint={together.length ? `with ${together.length} accessor${together.length === 1 ? 'y' : 'ies'}` : item.sold_to ?? undefined}><AmountText amount={got} /></Cell>,
        <Cell key="r" label={profit ? 'Net: made' : 'Net: cost you'} strong
          hint={monthly ?? (from && item.disposed_on ? `kept ${durationLabel(from, item.disposed_on)}` : undefined)}>
          {profit ? <span className="text-success">{money(-result.nok)}</span> : <AmountText amount={result} />}
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
