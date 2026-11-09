// Drill-downs about the things themselves, for the picked period: what you
// own (all of it, or one category) at its end, cost of use in it, how long the
// things that went in it were kept, things bought to sell, and one store's
// purchases.
import type { ShopItem } from '../../types'
import {
  accessoriesByItem, boughtOn, complete, costOf, DISPOSAL_LABEL, durationLabel, gotOf, isMine, minus, paidOf, perMonthWords, valueNowOf, ZERO, type Amount,
} from '../../ownModel'
import {
  byStore, costAt, costOfUseGap, costOfUseIn, keptRows, monthsLabel, ownedAt, ownedByCategory, resaleSummary, wentIn,
  type CategoryLevel, type OwnedAt, type UseGap,
} from '../../statsModel'
import { money } from '../shopFormat'
import { moneyWord, num, plural } from './statsFormat'
import { atEnd, dayOf, inPeriod, join, native, type DrillContent, type DrillGroup, type DrillRow, type StatsData } from './drillTypes'

const GAP_LABEL: Record<UseGap, string> = { no_value: 'No "Could sell for"', missing: 'Price missing', pending: 'Rate pending', new: 'Under a month' }

const items = (ids: readonly string[], d: StatsData) => ids.map(id => d.byId.get(id)).filter((i): i is ShopItem => !!i)
const byCost = (d: StatsData) => (a: ShopItem, b: ShopItem) => costAt(b, d.ctx, d.period).nok - costAt(a, d.ctx, d.period).nok || a.title.localeCompare(b.title)
const signedWord = (a: Amount) => (complete(a) ? `${a.nok > 0 ? '+' : ''}${money(a.nok)}` : 'unknown')
/** "sold 15.05.2026" — how and when a thing left. */
const leftWords = (i: ShopItem) => (i.disposal ? `${DISPOSAL_LABEL[i.disposal].toLowerCase()} ${dayOf(i, i.disposed_on)}` : null)

/** A thing you had at the period's end: what it had cost by then, and what it could sell for today (only while it is yours). */
function ownedRow(i: ShopItem, d: StatsData): DrillRow {
  const v = valueNowOf(i, d.ctx)
  return {
    key: i.id, id: i.id, title: i.title, amount: costAt(i, d.ctx, d.period),
    sub: join([`Bought ${dayOf(i, boughtOn(i))}`, v && `could sell for ${moneyWord(v)}${d.period.past ? ' today' : ''}`, d.period.past && !isMine(i) && leftWords(i)]),
  }
}

/** A past year: "Could sell for" keeps no history, so only the things still yours have one — today's. */
function valueThen(s: OwnedAt): string {
  const all = s.things + s.accessories
  const still = !s.stillYours ? 'None of them is still yours.'
    : `${s.stillYours === all ? 'All' : `${s.stillYours} of ${all}`} still yours${s.valued ? ` could sell for ${moneyWord(s.worth)} today (${s.valued} valued)` : ', none with a "Could sell for"'}.`
  return `What they could sell for then is not known: "Could sell for" keeps no history. ${still}`
}

export function ownDrill(d: StatsData): DrillContent {
  const p = d.period
  const s = ownedAt(d.items, d.ctx, p)
  const groups: DrillGroup[] = ownedByCategory(d.items, d.categories, d.ctx, 'top', p).map(row => ({
    key: row.key, title: row.title, total: row.paid, rows: items(row.ids, d).sort(byCost(d)).map(i => ownedRow(i, d)),
  }))
  const things = `${plural(s.things, 'thing')}${s.accessories ? ` + ${plural(s.accessories, 'accessory', 'accessories')}` : ''}`
  return {
    title: p.past ? `What you owned ${atEnd(p)}` : 'What you own',
    subtitle: p.past
      ? `${things} · paid ${moneyWord(s.paid)} by then. ${valueThen(s)}`
      : `${things} · paid ${moneyWord(s.paid)} · could sell for ${moneyWord(s.worth)} (${s.valued} valued)`,
    groups,
    empty: p.past ? `Nothing was yours ${atEnd(p)}.` : 'Nothing is yours right now.',
  }
}

export function categoryDrill(d: StatsData, key: string, level: CategoryLevel = 'top'): DrillContent {
  const p = d.period
  const row = ownedByCategory(d.items, d.categories, d.ctx, level, p).find(r => r.key === key)
  if (!row) return { title: 'Category', subtitle: '', groups: [], empty: 'Nothing here any more.' }
  const value = !p.past ? `could sell for ${moneyWord(row.worth)} (${row.valued} valued)`
    : row.stillYours ? `${row.stillYours} still yours could sell for ${moneyWord(row.worth)} today (${row.valued} valued)` : 'none still yours'
  return {
    title: row.title,
    subtitle: `${plural(row.count, 'thing')} you ${p.past ? `owned ${atEnd(p)}` : 'own'} · paid ${moneyWord(row.paid)}${p.past ? ' by then' : ''} · ${value}`,
    groups: [{ key: row.key, title: null, rows: items(row.ids, d).sort(byCost(d)).map(i => ownedRow(i, d)) }],
    empty: 'Nothing here any more.',
  }
}

export function costOfUseDrill(d: StatsData): DrillContent {
  const p = d.period
  const u = costOfUseIn(d.items, d.ctx, p)
  const acc = accessoriesByItem(d.items)
  const counted = new Set(u.rows.map(r => r.item.id))
  const rows: DrillRow[] = u.rows.map(({ item: i, per, months, nok }) => {
    const w = perMonthWords(per.nok)
    return {
      key: i.id, id: i.id, title: i.title, text: nok < 0 ? `made ≈ ${money(-nok)}` : `≈ ${money(nok)}`,
      sub: join([w.label === 'Gained' ? `gained ≈ ${num(w.nok)} a month` : `≈ ${num(w.nok)} NOK/month`, `${monthsLabel(months)} ${inPeriod(p)}`,
        leftWords(i) ?? 'still yours: at today\'s "Could sell for"']),
    }
  })
  const rest: DrillRow[] = u.things.filter(i => !counted.has(i.id)).sort(byCost(d)).map(i => ({
    key: i.id, id: i.id, title: i.title, muted: true, text: GAP_LABEL[costOfUseGap(i, d.ctx, d.today, acc.get(i.id) ?? []) ?? 'no_value'],
    sub: join([`Paid ${moneyWord(costOf(i, d.ctx))}`, `bought ${dayOf(i, boughtOn(i))}`, leftWords(i)]),
  }))
  const perMonth = p.year && u.months >= 1 ? ` (≈ ${money(u.nok / u.months)} a month)` : ''
  return {
    title: p.year ? `Cost of use · ${p.year}` : 'Cost of use · all time',
    subtitle: u.rows.length
      ? `≈ ${money(u.nok)} ${inPeriod(p)}${perMonth}, from ${u.rows.length} of ${plural(u.things.length, 'thing')}: each one's cost of use per month — what it cost, less what came back or, still yours, what it could sell for today — times the months you had it${p.year ? ` in ${p.year}` : ''}.`
      : 'Set "Could sell for" on your things — or sell one — to see what using them costs.',
    groups: [{ key: 'counted', title: 'Counted', rows }, { key: 'rest', title: 'Not counted', rows: rest }].filter(g => g.rows.length > 0),
    empty: p.year ? `Nothing was yours in ${p.year}.` : 'Nothing bought yet.',
  }
}

export function keptDrill(d: StatsData): DrillContent {
  const p = d.period
  const rows = keptRows(d.items, p)
  const avg = rows.length ? rows.reduce((s, r) => s + r.months, 0) / rows.length : null
  const none = p.year ? `Nothing sold or gone in ${p.year}.` : 'Nothing sold or gone yet.'
  return {
    title: p.year ? `Kept for · went in ${p.year}` : 'Kept for',
    subtitle: avg == null ? none : `≈ ${monthsLabel(avg)} on average, over ${plural(rows.length, 'thing')} sold or gone${p.year ? ` in ${p.year}` : ''}.`,
    groups: rows.length ? [{
      key: 'kept', title: null,
      rows: rows.map(r => ({
        key: r.item.id, id: r.item.id, title: r.item.title, text: durationLabel(r.from, r.to),
        sub: join([`${dayOf(r.item, r.from)} – ${dayOf(r.item, r.to)}`, r.item.disposal && DISPOSAL_LABEL[r.item.disposal]]),
      })),
    }] : [],
    empty: none,
  }
}

export function resaleDrill(d: StatsData): DrillContent {
  const p = d.period
  const s = resaleSummary(d.items, d.ctx, p)
  const title = p.year ? `Bought to sell · ${p.year}` : 'Bought to sell'
  const none = p.year ? `Nothing bought to sell was sold or held in ${p.year}.` : 'Nothing was bought to sell later.'
  if (!s) return { title, subtitle: '', groups: [], empty: none }
  const rows: DrillRow[] = items(s.ids, d).map(i => {
    const bought = `Bought ${dayOf(i, boughtOn(i))}`
    if (!wentIn(i, p)) return { key: i.id, id: i.id, title: i.title, text: p.past ? 'Still yours then' : 'Still yours', muted: true, sub: join([bought, `paid ${moneyWord(costAt(i, d.ctx, p))}`]) }
    const r = minus(gotOf(i) ?? ZERO, costOf(i, d.ctx))
    return {
      key: i.id, id: i.id, title: i.title, amount: r, signed: true, tone: complete(r) && r.nok !== 0 ? (r.nok > 0 ? 'success' : 'danger') : undefined,
      sub: join([bought, `${DISPOSAL_LABEL[i.disposal ?? 'other']} ${dayOf(i, i.disposed_on)}`]),
    }
  })
  return {
    title,
    subtitle: join([`Result ${signedWord(s.result)}`, `${s.sold} of ${s.bought} sold${p.year ? ` in ${p.year}` : ''}`, s.avgDaysToSell != null && `≈ ${plural(s.avgDaysToSell, 'day')} to sell`]),
    groups: [{ key: 'resale', title: null, rows }],
    empty: none,
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
