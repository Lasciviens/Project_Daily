// The one currency converter's logic (Home's Money tile and the Currency
// popup/widget share it). Pure and import-free, so
// scripts/verify-currency-convert.cjs checks it through sucrase.
//
// Both fields take input: the field typed in last is the source and keeps its
// text as typed; the other one shows the converted amount. Fields hold plain
// digits (no grouping), so editing a result never fights a thousands separator.

export const CONVERT_CURRENCIES = ['NOK', 'TRY', 'EUR', 'USD'] as const
export type ConvertCurrency = typeof CONVERT_CURRENCIES[number]

// Currency flags are content (they name the currency), not UI chrome.
export const CURRENCY_FLAG: Readonly<Record<string, string>> = { NOK: '🇳🇴', TRY: '🇹🇷', EUR: '🇪🇺', USD: '🇺🇸', XAU: '🥇' }

export type ConvertSide = 'top' | 'bottom'

export interface ConverterState {
  /** The field typed in last; the other field is computed from it. */
  source: ConvertSide
  /** The source field's text, exactly as typed. */
  text: string
  top: ConvertCurrency
  bottom: ConvertCurrency
}

/** Every visit starts here (nothing is stored): 1,000 TRY on top, NOK below. */
export const CONVERTER_START: ConverterState = { source: 'top', text: '1000', top: 'TRY', bottom: 'NOK' }

/** A typed amount: ',' or '.' is the decimal mark and spaces are ignored. Null when it is not a plain non-negative number. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/\s+/g, '').replace(',', '.')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Units of a currency per 1 USD (Open Exchange Rates is USD-based; USD itself is 1). Null when the rate is missing. */
function usdRate(code: string, rates: Readonly<Record<string, number>>): number | null {
  if (code === 'USD') return 1
  const r = rates[code]
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null
}

/** `amount` of `from` in `to`: X → Y = rates[Y] / rates[X]. Null when a rate is missing. */
export function convertAmount(amount: number, from: string, to: string, rates: Readonly<Record<string, number>>): number | null {
  const f = usdRate(from, rates)
  const t = usdRate(to, rates)
  if (f == null || t == null || !Number.isFinite(amount)) return null
  return amount * (t / f)
}

/** A converted amount for a field: at most 2 decimals, plain digits, no grouping ("187.79", "1000", "0.5"). */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2).replace(/\.?0+$/, '')
}

/** What both fields show: the source as typed, the other converted ('' while the source is not a number or a rate is missing). */
export function converterFields(s: ConverterState, rates: Readonly<Record<string, number>>): Record<ConvertSide, string> {
  const other: ConvertSide = s.source === 'top' ? 'bottom' : 'top'
  const amount = parseAmount(s.text)
  const result = amount == null ? null : convertAmount(amount, s[s.source], s[other], rates)
  const computed = result == null ? '' : formatAmount(result)
  return s.source === 'top' ? { top: s.text, bottom: computed } : { top: computed, bottom: s.text }
}

/** Typing in a field makes it the source. */
export function typeIn(s: ConverterState, side: ConvertSide, text: string): ConverterState {
  return { ...s, source: side, text }
}

/** A new currency on one side; the field typed in last keeps its text, so the other side is recomputed from it. */
export function pickCurrency(s: ConverterState, side: ConvertSide, code: ConvertCurrency): ConverterState {
  return { ...s, [side]: code }
}

/** Swap the two currencies; the source keeps its text (1,000 TRY → NOK becomes 1,000 NOK → TRY). */
export function swapCurrencies(s: ConverterState): ConverterState {
  return { ...s, top: s.bottom, bottom: s.top }
}
