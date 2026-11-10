// The insurance list (Shop step C): everything you own and its value — what you paid (at its own day's rate)
// and, when a price watch read one, the new price now — sorted by value, as a CSV file to save or a page to
// print. Pure — scripts/verify-shop-owning.cjs.

import { formatDate } from '../../shared/utils/dateFormat'
import { boughtOn, complete, isMine, nokNow, paidOf, type Amount, type MoneyCtx } from './ownModel'
import { categoryPath, localDay, watchedPrice } from './shopModel'
import type { ShopCategory, ShopItem, ShopPriceWatch } from './types'

export interface InsuranceRow {
  id:       string
  title:    string
  category: string
  store:    string | null
  /** yyyy-mm-dd, or null. */
  bought:   string | null
  approx:   boolean
  serial:   string | null
  /** What was paid in its own currency (null: not written down; 0 with `gift`). */
  price:    number | null
  currency: string
  gift:     boolean
  /** What was paid in NOK at its day's rate. */
  paid:     Amount
  /** The new price a watch read for it (a new offer or the shop's own page — never a mixed or used figure), in NOK at today's rate. */
  newNow:   { amount: number; currency: string; nok: number | null; on: string } | null
  /** What it sorts by: the new price now when known, else what was paid (NOK; 0 when neither is known). */
  value:    number
  /** The thing it is an accessory of, else null. */
  accessoryOf: string | null
}

/** Only a clean new price stands for "new now" (wishTile.isClean's rule), from the watch of the thing's own link. */
function newPriceNow(item: ShopItem, watch: ShopPriceWatch | undefined, ctx: MoneyCtx): InsuranceRow['newNow'] {
  if (!watch || watch.status === 'not_allowed' || (watch.condition !== 'new' && watch.condition !== 'unknown')) return null
  const m = watchedPrice(item, watch)
  if (!m) return null
  const nok = nokNow(m.amount, m.currency, ctx.rates)
  return { amount: m.amount, currency: m.currency, nok: complete(nok) ? Math.round(nok.nok) : null, on: localDay(watch.last_ok_at ?? watch.checked_at) }
}

/** Everything still yours (accessories too, each under its own line), the most valuable first. */
export function insuranceRows(items: readonly ShopItem[], categories: readonly ShopCategory[], ctx: MoneyCtx, watches: ReadonlyMap<string, ShopPriceWatch>): InsuranceRow[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const rows: InsuranceRow[] = []
  for (const i of items) {
    if (!isMine(i)) continue
    const owner = i.accessory_of ? byId.get(i.accessory_of) ?? null : null
    const p = categoryPath(i.category_id ?? owner?.category_id, categories)
    const paid = paidOf(i)
    const newNow = newPriceNow(i, watches.get(i.id), ctx)
    rows.push({
      id: i.id, title: i.title, category: p.topId ? [p.topName, p.subName].filter(Boolean).join(' › ') : '',
      store: i.platform ?? null, bought: boughtOn(i), approx: !!i.approx_dates, serial: i.serial ?? null,
      price: i.price ?? null, currency: i.currency ?? (i.region === 'TR' ? 'TRY' : 'NOK'), gift: !!i.got_as_gift,
      paid, newNow, value: newNow?.nok ?? (complete(paid) ? Math.round(paid.nok) : 0), accessoryOf: owner?.title ?? null,
    })
  }
  return rows.sort((a, b) => b.value - a.value || a.title.localeCompare(b.title))
}

export interface InsuranceTotals { things: number; paid: Amount; newNow: number; checked: number; value: number }

export function insuranceTotals(rows: readonly InsuranceRow[]): InsuranceTotals {
  let nok = 0, missing = 0, pending = 0, newNow = 0, checked = 0, value = 0
  for (const r of rows) {
    nok += r.paid.nok; missing += r.paid.missing; pending += r.paid.pending
    if (r.newNow?.nok != null) { newNow += r.newNow.nok; checked++ }
    value += r.value
  }
  return { things: rows.length, paid: { nok, missing, pending }, newNow, checked, value }
}

// ── The CSV file ─────────────────────────────────────────────────────────────
//
// Semicolons between cells (a Norwegian spreadsheet reads a comma as the decimal sign) and a byte-order mark,
// so Excel reads æ, ø and å. A cell is data, never a formula: a title read from a web page that starts with
// = + - @ (or a tab or a return) gets a leading apostrophe — a spreadsheet would run it otherwise.

/** The byte-order mark that tells a spreadsheet the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff)
const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV cell: never a formula, quoted when it holds a separator, a quote or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  let s = typeof value === 'number' ? String(Math.round(value)) : value.replace(/\r\n?/g, '\n')
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const INSURANCE_COLUMNS = [
  'Name', 'Category', 'Accessory of', 'Store', 'Bought', 'Serial number', 'Paid', 'Currency', 'Paid (NOK)', 'New price now (NOK)', 'New price checked',
] as const

/** The list as a CSV file's text (with its byte-order mark). Dates DD.MM.YYYY, amounts in whole units. */
export function insuranceCsv(rows: readonly InsuranceRow[]): string {
  const lines = [INSURANCE_COLUMNS.map(csvCell).join(';')]
  for (const r of rows) {
    lines.push([
      r.title, r.category, r.accessoryOf, r.store, r.bought ? `${r.approx ? '≈ ' : ''}${formatDate(r.bought)}` : null, r.serial,
      r.gift && !r.price ? 0 : r.price, r.currency, complete(r.paid) ? r.paid.nok : null,
      r.newNow?.nok ?? null, r.newNow ? formatDate(r.newNow.on) : null,
    ].map(csvCell).join(';'))
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}

/** "Insurance list 10.11.2026.csv". */
export const insuranceFileName = (today: string): string => `Insurance list ${formatDate(today)}.csv`
