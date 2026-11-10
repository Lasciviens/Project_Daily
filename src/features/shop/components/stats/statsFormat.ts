// Words and numbers for the Stats screen: counts, whole-unit amounts and the
// reason a sum is not a number yet. Pure.
import { complete, type Amount } from '../../ownModel'
import { amountWords, num } from '../shopFormat'

export { num }

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

/** "Price missing", "Rate pending" — why an amount is not a number (short, for a row). */
export function shortReason(a: Amount): string {
  if (a.missing && a.pending) return 'Price missing · rate pending'
  return a.missing ? 'Price missing' : 'Rate pending'
}

/** "4 490 NOK", "20 100 NOK + 4 500 TRY pending" while only a rate waits, or "unknown" for a sum with a price missing. */
export function moneyWord(a: Amount): string {
  return amountWords(a) ?? 'unknown'
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

/** A sum for a tile's one-line hint: "83 216", "83 216 + pending" while only a rate waits (never at today's rate), else "unknown". */
export function shortSum(a: Amount): string {
  if (complete(a)) return num(a.nok)
  return a.missing ? 'unknown' : `${num(a.nok)} + pending`
}

/** "+1 101" / "−300" / "0" — a result with its sign. */
export const signedNum = (n: number) => `${Math.round(n) > 0 ? '+' : ''}${num(n)}`

// Month names as chart labels only — the owner's exception to the date rule
// ("this is not a date format"); a date is still DD.MM.YYYY.
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthIndex = (key: string) => Number(key.slice(5, 7)) - 1
/** "September", or "September 2025" when no year is picked (key: yyyy-mm). */
export const monthName = (key: string, withYear: boolean) => `${MONTHS[monthIndex(key)]}${withYear ? ` ${key.slice(0, 4)}` : ''}`
