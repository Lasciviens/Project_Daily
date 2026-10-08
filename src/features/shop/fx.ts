// Money in NOK for Shop. A purchase, a sale or an extra cost is converted at
// the rate of ITS OWN DAY — Norges Bank's, frozen on the row by the database
// (migration 137) — so 30 000 TRY spent in 2023 keeps its 2023 worth. Until
// that rate is cached the amount is "rate pending": its own currency is known,
// its NOK is not, and today's rate never stands in (a 2023 lira at today's
// rate reads about half its worth). Today's rates are used only for what
// things are worth NOW: "Could sell for", prices to buy, the price watch.
// Pure — scripts/verify-shop-owned.cjs.

import type { UsdRates } from '../settings/subscriptionRules'

export type { UsdRates }

/** NOK for one unit of `currency` under USD-base rates (today's); null when a rate is missing. */
export function nokPerUnit(currency: string, rates: UsdRates | null | undefined): number | null {
  if (currency === 'NOK') return 1
  if (!rates) return null
  const nok = rates.NOK
  const other = currency === 'USD' ? 1 : rates[currency]
  if (!nok || !other || !Number.isFinite(nok) || !Number.isFinite(other)) return null
  return nok / other
}

/** NOK per unit rounded to 6 significant digits — what a typed rate is stored as. */
export function roundRate(rate: number): number {
  return Number(rate.toPrecision(6))
}
