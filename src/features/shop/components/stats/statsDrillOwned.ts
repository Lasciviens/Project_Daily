// Drill-downs about the things themselves: what you own (all of it, or one
// category), cost of use, how long things were kept, things bought to sell,
// and one store's purchases.
import type { ShopItem } from '../../types'
import {
  boughtOn, complete, costOf, DISPOSAL_LABEL, durationLabel, gotOf, minus, ownedSummary, paidOf, valueNowOf, ZERO, type Amount,
} from '../../ownModel'
import { byStore, costOfUseGap, costOfUseNow, keptRows, monthsLabel, ownedByCategory, resaleSummary, type UseGap } from '../../statsModel'
import { money } from '../shopFormat'
import { moneyWord, num, plural } from './statsFormat'
import { dayOf, join, native, type DrillContent, type DrillGroup, type DrillRow, type StatsData } from './drillTypes'

const GAP_LABEL: Record<UseGap, string> = { no_value: 'No "Could sell for"', missing: 'Price missing', pending: 'Rate pending', new: 'Under a month' }

const items = (ids: readonly string[], d: StatsData) => ids.map(id => d.byId.get(id)).filter((i): i is ShopItem => !!i)
const byCost = (d: StatsData) => (a: ShopItem, b: ShopItem) => costOf(b, d.ctx).nok - costOf(a, d.ctx).nok || a.title.localeCompare(b.title)
const signedWord = (a: Amount) => (complete(a) ? `${a.nok > 0 ? '+' : ''}${money(a.nok)}` : 'unknown')

/** A thing you own: what it cost (paid + extras), and what it could sell for. */
function ownedRow(i: ShopItem, d: StatsData): DrillRow {
  const v = valueNowOf(i, d.ctx)
  const parent = i.accessory_of ? d.byId.get(i.accessory_of) : undefined
  return {
    key: i.id, id: i.id, title: i.title, amount: costOf(i, d.ctx),
    sub: join([`Bought ${dayOf(i, boughtOn(i))}`, v && `could sell for ${moneyWord(v)}`, parent && `with ${parent.title}`]),
  }
}

export function ownDrill(d: StatsData): DrillContent {
  const s = ownedSummary(d.items, d.ctx)
  const groups: DrillGroup[] = ownedByCategory(d.items, d.categories, d.ctx).map(row => ({
    key: row.key, title: row.title, total: row.paid, rows: items(row.ids, d).sort(byCost(d)).map(i => ownedRow(i, d)),
  }))
  const acc = s.accessories ? ` + ${plural(s.accessories, 'accessory', 'accessories')}` : ''
  return {
    title: 'What you own',
    subtitle: `${plural(s.mine, 'thing')}${acc} · paid ${moneyWord(s.paid)} · could sell for ${moneyWord(s.worth)} (${s.valued} valued)`,
    groups,
    empty: 'Nothing is yours right now.',
  }
}

export function categoryDrill(d: StatsData, key: string): DrillContent {
  const row = ownedByCategory(d.items, d.categories, d.ctx).find(r => r.key === key)
  if (!row) return { title: 'Category', subtitle: '', groups: [], empty: 'Nothing here any more.' }
  return {
    title: row.title,
    subtitle: `${plural(row.count, 'thing')} you own · paid ${moneyWord(row.paid)} · could sell for ${moneyWord(row.worth)} (${row.valued} valued)`,
    groups: [{ key: row.key, title: null, rows: items(row.ids, d).sort(byCost(d)).map(i => ownedRow(i, d)) }],
    empty: 'Nothing here any more.',
  }
}

export function costOfUseDrill(d: StatsData): DrillContent {
  const u = costOfUseNow(d.items, d.ctx, d.today)
  const counted = new Set(u.rows.map(r => r.item.id))
  const rows: DrillRow[] = u.rows.map(({ item: i, per }) => ({
    key: i.id, id: i.id, title: i.title, text: `≈ ${num(per.nok)} NOK/month`,
    sub: join([`Paid ${moneyWord(costOf(i, d.ctx))}`, `could sell for ${moneyWord(valueNowOf(i, d.ctx) ?? ZERO)}`, durationLabel(boughtOn(i) as string, d.today)]),
  }))
  const rest: DrillRow[] = u.things.filter(i => !counted.has(i.id)).sort(byCost(d)).map(i => ({
    key: i.id, id: i.id, title: i.title, muted: true, text: GAP_LABEL[costOfUseGap(i, d.ctx, d.today) ?? 'no_value'],
    sub: join([`Paid ${moneyWord(costOf(i, d.ctx))}`, `bought ${dayOf(i, boughtOn(i))}`]),
  }))
  return {
    title: 'Cost of use per month',
    subtitle: u.rows.length
      ? `≈ ${num(u.nok)} NOK/month from ${u.rows.length} of ${plural(u.things.length, 'thing')}: what each cost, less what it could sell for, per month you have had it.`
      : 'Set "Could sell for" on your things to see what they cost you per month.',
    groups: [{ key: 'counted', title: 'Counted', rows }, { key: 'rest', title: 'Not counted yet', rows: rest }].filter(g => g.rows.length > 0),
    empty: 'Nothing is yours right now.',
  }
}

export function keptDrill(d: StatsData): DrillContent {
  const rows = keptRows(d.items)
  const avg = rows.length ? rows.reduce((s, r) => s + r.months, 0) / rows.length : null
  return {
    title: 'Kept for',
    subtitle: avg == null ? 'Nothing sold or gone yet.' : `≈ ${monthsLabel(avg)} on average, over ${plural(rows.length, 'thing')} sold or gone.`,
    groups: rows.length ? [{
      key: 'kept', title: null,
      rows: rows.map(r => ({
        key: r.item.id, id: r.item.id, title: r.item.title, text: durationLabel(r.from, r.to),
        sub: join([`${dayOf(r.item, r.from)} – ${dayOf(r.item, r.to)}`, r.item.disposal && DISPOSAL_LABEL[r.item.disposal]]),
      })),
    }] : [],
    empty: 'Nothing sold or gone yet.',
  }
}

export function resaleDrill(d: StatsData): DrillContent {
  const s = resaleSummary(d.items, d.ctx)
  if (!s) return { title: 'Bought to sell', subtitle: '', groups: [], empty: 'Nothing was bought to sell later.' }
  const rows: DrillRow[] = items(s.ids, d).map(i => {
    const bought = `Bought ${dayOf(i, boughtOn(i))}`
    if (!i.disposal) return { key: i.id, id: i.id, title: i.title, text: 'Still yours', muted: true, sub: join([bought, `paid ${moneyWord(costOf(i, d.ctx))}`]) }
    const r = minus(gotOf(i) ?? ZERO, costOf(i, d.ctx))
    return {
      key: i.id, id: i.id, title: i.title, amount: r, signed: true, tone: complete(r) && r.nok !== 0 ? (r.nok > 0 ? 'success' : 'danger') : undefined,
      sub: join([bought, `${DISPOSAL_LABEL[i.disposal]} ${dayOf(i, i.disposed_on)}`]),
    }
  })
  return {
    title: 'Bought to sell',
    subtitle: join([`Result ${signedWord(s.result)}`, `${s.sold} of ${s.bought} sold`, s.avgDaysToSell != null && `≈ ${plural(s.avgDaysToSell, 'day')} to sell`]),
    groups: [{ key: 'resale', title: null, rows }],
    empty: 'Nothing was bought to sell later.',
  }
}

export function storeDrill(d: StatsData, key: string, year: string | null): DrillContent {
  const row = byStore(d.items, year ?? undefined).find(r => r.key === key)
  const title = `${row?.title ?? 'Store'} · ${year ?? 'all time'}`
  if (!row) return { title, subtitle: '', groups: [], empty: 'No purchases here in this period.' }
  const day = (i: ShopItem) => boughtOn(i) ?? ''
  return {
    title,
    subtitle: `${plural(row.count, 'purchase')} · ${moneyWord(row.spent)}`,
    groups: [{
      key: row.key, title: null,
      rows: items(row.ids, d).sort((a, b) => day(b).localeCompare(day(a))).map(i => ({
        key: i.id, id: i.id, title: i.title, amount: paidOf(i), sub: join([`Bought ${dayOf(i, boughtOn(i))}`, native(i.price, i.currency)]),
      })),
    }],
    empty: 'No purchases here in this period.',
  }
}
