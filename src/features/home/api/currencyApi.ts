// @fawazahmed0/currency-api served via jsDelivr CDN.
// CDN guarantees CORS from any origin — no API key, completely free.
// Format: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{base}.min.json
// Rates object: { "usd": { "try": 32.5, "nok": 10.8, "eur": 0.92, ... } }
const CDN = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrossRate {
  pair:  string
  base:  string
  quote: string
  rate:  number
}

export interface CurrencyChange {
  code:   string
  change: number   // percentage change vs yesterday (positive = gained value vs USD)
}

export interface CurrencyData {
  crossRates: CrossRate[]
  changes:    CurrencyChange[]
  date:       string
}

// Pairs to show in Mode 1.
// Cross-rate formula: quote_per_base = rates[quote] / rates[base]  (both vs USD)
const PAIRS: [string, string][] = [
  ['NOK', 'TRY'],
  ['EUR', 'NOK'],
  ['USD', 'NOK'],
  ['EUR', 'TRY'],
  ['USD', 'TRY'],
]

const TRACKED = ['TRY', 'NOK', 'USD', 'EUR']

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchRates(date: 'latest' | string): Promise<{ date: string; rates: Record<string, number> }> {
  const url = `${CDN}@${date}/v1/currencies/usd.min.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Currency CDN ${res.status}`)
  const json = await res.json()
  // Rates are nested under the base currency key ("usd")
  return { date: json.date as string, rates: json.usd as Record<string, number> }
}

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ─── Exported function ────────────────────────────────────────────────────────

export async function fetchCurrencyData(): Promise<CurrencyData> {
  const [today, yesterday] = await Promise.all([
    fetchRates('latest'),
    fetchRates(yesterdayISO()),
  ])

  const r: Record<string, number> = today.rates

  // USD = 1 by definition since rates are USD-based; add it explicitly
  const rWithUSD: Record<string, number> = { ...r, usd: 1 }

  const crossRates: CrossRate[] = PAIRS.map(([base, quote]) => {
    const b = rWithUSD[base.toLowerCase()] ?? 1
    const q = rWithUSD[quote.toLowerCase()] ?? 1
    return {
      pair:  `${base}/${quote}`,
      base,
      quote,
      // How many QUOTE units per 1 BASE
      rate:  q / b,
    }
  })

  const changes: CurrencyChange[] = TRACKED.map(code => {
    const key  = code.toLowerCase()
    const now  = today.rates[key]     ?? 1
    const prev = yesterday.rates[key] ?? now
    // A higher rate (more units per USD) means the currency LOST value vs USD.
    // We invert: if rate went UP (weaker), change is negative for the currency.
    const change = prev !== 0 ? -((now - prev) / prev) * 100 : 0
    return { code, change }
  })

  return { crossRates, changes, date: today.date }
}
