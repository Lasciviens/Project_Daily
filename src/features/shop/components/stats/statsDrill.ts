// Which things a Stats number opens, and the amount each one adds: one
// builder per kind of number, shared by every tile, bar and row on the
// screen. A drill-down's rows add up to the number that opened it.
import { formatMonthYear } from '../../../../shared/utils/dateFormat'
import { add, DISPOSAL_LABEL, minus } from '../../ownModel'
import { moneyEvents, periodMonths, type MoneyEvent } from '../../statsModel'
import { moneyWord } from './statsFormat'
import { dayOf, join, native, type Drill, type DrillContent, type DrillRow, type StatsData } from './drillTypes'
import { categoryDrill, keptDrill, ownDrill, resaleDrill, storeDrill, costOfUseDrill } from './statsDrillOwned'
import { nestAccessories } from './drillNest'

function eventRow(e: MoneyEvent, d: StatsData): DrillRow | null {
  const i = d.byId.get(e.id)
  if (!i) return null
  const when = dayOf(i, e.day)
  const sub = e.kind === 'bought' ? join(['Bought', when, i.platform, native(i.price, i.currency)])
    : e.kind === 'cost' ? join([e.label ?? 'Extra cost', when])
      : e.kind === 'refund' ? join(['Returned, money back', when])
        : join([i.disposal ? DISPOSAL_LABEL[i.disposal] : 'Sold', when, i.sold_to && `to ${i.sold_to}`, native(i.sale_price, i.sale_currency)])
  return { key: e.key, id: e.id, title: i.title, sub, amount: e.amount, negate: e.kind === 'refund' }
}

/** Spent (purchases, extra costs, refunds taken off) and got back (sales), newest first. */
function moneyDrill(title: string, events: MoneyEvent[], d: StatsData): DrillContent {
  const out = events.filter(e => e.kind !== 'sold')
  const back = events.filter(e => e.kind === 'sold')
  const spent = minus(add(...out.filter(e => e.kind !== 'refund').map(e => e.amount)), add(...out.filter(e => e.kind === 'refund').map(e => e.amount)))
  const got = add(...back.map(e => e.amount))
  const rows = (list: MoneyEvent[]) => list.map(e => eventRow(e, d)).filter((r): r is DrillRow => !!r).reverse()
  return {
    title,
    subtitle: `Spent ${moneyWord(spent)} · got back ${moneyWord(got)} · net ${moneyWord(minus(spent, got))}`,
    groups: [
      { key: 'spent', title: 'Spent', total: spent, rows: rows(out) },
      { key: 'got', title: 'Got back', total: got, rows: rows(back) },
    ].filter(g => g.rows.length > 0),
    empty: 'No money moved in this period.',
  }
}

/** The things behind a number, each accessory listed under the thing it belongs to. */
export function drillContent(drill: Drill, d: StatsData): DrillContent {
  const c = drillRows(drill, d)
  return { ...c, groups: c.groups.map(g => ({ ...g, rows: nestAccessories(g.rows, d.byId) })) }
}

function drillRows(drill: Drill, d: StatsData): DrillContent {
  switch (drill.kind) {
    case 'period': {
      const range = periodMonths(d.years, drill.year)
      const events = range ? moneyEvents(d.items, d.ctx, range.from, range.to) : []
      return moneyDrill(`Money in and out · ${drill.year ?? 'all time'}`, events, d)
    }
    case 'month': return moneyDrill(formatMonthYear(`${drill.month}-01`), moneyEvents(d.items, d.ctx, drill.month, drill.month), d)
    case 'own': return ownDrill(d)
    case 'use': return costOfUseDrill(d)
    case 'kept': return keptDrill(d)
    case 'resale': return resaleDrill(d)
    case 'category': return categoryDrill(d, drill.key, drill.level)
    case 'store': return storeDrill(d, drill.key, drill.year)
  }
}
