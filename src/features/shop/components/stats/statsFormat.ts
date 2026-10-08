// Words and numbers for the Stats screen: counts, whole-unit amounts and the
// reason a sum is not a number yet. Pure.
import { complete, type Amount } from '../../ownModel'
import { money } from '../shopFormat'

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** "4 490" — whole units, thousands with a space, no currency (the unit sits beside it). */
export function num(n: number): string {
  const r = Math.round(n)
  return `${r < 0 ? '-' : ''}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/** "Price missing", "Rate pending" — why an amount is not a number (short, for a row). */
export function shortReason(a: Amount): string {
  if (a.missing && a.pending) return 'Price missing · rate pending'
  return a.missing ? 'Price missing' : 'Rate pending'
}

/** "4 490 NOK", or "unknown" for a sum that is not complete. */
export function moneyWord(a: Amount): string {
  return complete(a) ? money(a.nok) : 'unknown'
}

/** "2 amounts not counted: 1 price missing · 1 exchange rate pending (…)", or null when every amount counted. */
export function notCounted(a: Amount): string | null {
  const n = a.missing + a.pending
  if (!n) return null
  const parts = [a.missing && `${plural(a.missing, 'price')} missing`, a.pending && `${plural(a.pending, 'exchange rate')} pending`].filter(Boolean)
  const why = a.pending ? ' (Norges Bank publishes rates after 16:00 on weekdays)' : ''
  return `${plural(n, 'amount')} not counted: ${parts.join(' · ')}${why}.`
}

/** "1 price missing", "2 rates pending", "1 price missing · 2 rates pending" — for a total that is not a number. */
export function countReason(a: Amount): string {
  return [a.missing && `${plural(a.missing, 'price')} missing`, a.pending && `${plural(a.pending, 'rate')} pending`].filter(Boolean).join(' · ')
}

/** "+1 101" / "-300" / "0" — a result with its sign. */
export const signedNum = (n: number) => `${Math.round(n) > 0 ? '+' : ''}${num(n)}`

// Month names as chart labels only — the owner's exception to the date rule
// ("this is not a date format"); a date is still DD.MM.YYYY.
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthIndex = (key: string) => Number(key.slice(5, 7)) - 1
/** "September", or "September 2025" when no year is picked (key: yyyy-mm). */
export const monthName = (key: string, withYear: boolean) => `${MONTHS[monthIndex(key)]}${withYear ? ` ${key.slice(0, 4)}` : ''}`
