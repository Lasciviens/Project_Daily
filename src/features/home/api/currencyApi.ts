// open.er-api.com — free, no API key, CORS-enabled, updates every 24h
// Returns all rates relative to a base currency.
// We fetch USD as base and derive all needed cross-rates from it.
const BASE_URL = 'https://open.er-api.com/v6'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrossRate {
  pair:    string   // e.g. 'NOK-TRY'
  base:    string
  quote:   string
  rate:    number
}

export interface CurrencyChange {
  code:    string
  rate:    number   // units of this currency per 1 USD
  prev:    number   // yesterday's rate
  change:  number   // percentage change vs yesterday
}

export interface CurrencyData {
  crossRates:  CrossRate[]
  changes:     CurrencyChange[]
  updatedAt:   string
}

// Pairs we care about — all derivable from USD base rates
const PAIRS: [string, string][] = [
  ['NOK', 'TRY'],
  ['EUR', 'NOK'],
  ['USD', 'NOK'],
  ['EUR', 'TRY'],
  ['USD', 'TRY'],
]

// Currencies to track for value-change mode
const TRACKED = ['TRY', 'NOK', 'USD', 'EUR']

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchRates(date?: string): Promise<Record<string, number>> {
  // 'latest' returns today; a date string returns historical snapshot
  const segment = date ?? 'latest'
  const res = await fetch(`${BASE_URL}/${segment}/USD`)
  if (!res.ok) throw new Error(`Currency API ${res.status}`)
  const data = await res.json()
  if (data.result !== 'success') throw new Error('Currency API error')
  return data.rates as Record<string, number>
}

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ─── Exported function ────────────────────────────────────────────────────────

/**
 * Fetches today's and yesterday's USD-base rates, then derives:
 *   1. Cross-rates for configured PAIRS (NOK-TRY, EUR-NOK, etc.)
 *   2. 24h percentage change for TRACKED currencies (TRY, NOK, USD, EUR)
 *
 * Cross-rate formula: quote_per_base = quote_per_USD / base_per_USD
 * e.g. NOK-TRY = TRY_rate / NOK_rate
 */
export async function fetchCurrencyData(): Promise<CurrencyData> {
  const [today, yesterday] = await Promise.all([
    fetchRates(),
    fetchRates(yesterdayISO()),
  ])

  const crossRates: CrossRate[] = PAIRS.map(([base, quote]) => ({
    pair:  `${base}-${quote}`,
    base,
    quote,
    rate: today[quote] / today[base],
  }))

  const changes: CurrencyChange[] = TRACKED.map(code => {
    const rate   = today[code]     ?? 1
    const prev   = yesterday[code] ?? rate
    const change = prev !== 0 ? ((rate - prev) / prev) * 100 : 0
    return { code, rate, prev, change }
  })

  return { crossRates, changes, updatedAt: new Date().toISOString() }
}
