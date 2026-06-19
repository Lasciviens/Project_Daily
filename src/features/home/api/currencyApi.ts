// Open Exchange Rates — free tier, hourly updates, USD base.
// Docs: https://docs.openexchangerates.org/reference/latest-json
// Key stored in VITE_OXR_APP_ID (GitHub Secret).
const OXR_BASE = 'https://openexchangerates.org/api'
const APP_ID   = import.meta.env.VITE_OXR_APP_ID as string | undefined

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrossRate {
  pair:  string
  base:  string
  quote: string
  rate:  number
}

export interface CurrencyChange {
  code:   string
  change: number   // percentage change vs yesterday (positive = currency gained vs USD)
}

export interface CurrencyData {
  crossRates: CrossRate[]
  changes:    CurrencyChange[]
  date:       string
  rawRates:   Record<string, number>  // USD-base rates; converter uses these
}

// Currency pairs to display
const PAIRS: [string, string][] = [
  ['NOK', 'TRY'],
  ['EUR', 'NOK'],
  ['USD', 'NOK'],
  ['EUR', 'TRY'],
  ['USD', 'TRY'],
]

const TRACKED = ['TRY', 'NOK', 'USD', 'EUR']

// ─── Fetch helpers ────────────────────────────────────────────────────────────

interface OXRResponse {
  timestamp: number
  base:      string
  rates:     Record<string, number>
}

async function fetchLatest(): Promise<OXRResponse> {
  if (!APP_ID) throw new Error('VITE_OXR_APP_ID is not configured')
  const symbols = [...new Set(PAIRS.flat().concat(TRACKED))].join(',')
  const res = await fetch(`${OXR_BASE}/latest.json?app_id=${APP_ID}&symbols=${symbols}&prettyprint=false`)
  if (!res.ok) throw new Error(`OXR latest ${res.status}`)
  return res.json()
}

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function fetchHistorical(date: string): Promise<OXRResponse> {
  if (!APP_ID) throw new Error('VITE_OXR_APP_ID is not configured')
  const symbols = TRACKED.join(',')
  const res = await fetch(`${OXR_BASE}/historical/${date}.json?app_id=${APP_ID}&symbols=${symbols}&prettyprint=false`)
  if (!res.ok) throw new Error(`OXR historical ${res.status}`)
  return res.json()
}

// ─── Exported function ────────────────────────────────────────────────────────

export async function fetchCurrencyData(): Promise<CurrencyData> {
  const [today, yesterday] = await Promise.all([
    fetchLatest(),
    fetchHistorical(yesterdayISO()),
  ])

  // OXR free tier uses USD as base; all rates are X per 1 USD
  const r: Record<string, number> = { ...today.rates, USD: 1 }

  const crossRates: CrossRate[] = PAIRS.map(([base, quote]) => {
    const b = r[base] ?? 1
    const q = r[quote] ?? 1
    // How many QUOTE units per 1 BASE
    return { pair: `${base}/${quote}`, base, quote, rate: q / b }
  })

  const changes: CurrencyChange[] = TRACKED.map(code => {
    const now  = today.rates[code]     ?? 1
    const prev = yesterday.rates[code] ?? now
    // Higher rate = weaker currency vs USD, so invert the direction
    const change = prev !== 0 ? -((now - prev) / prev) * 100 : 0
    return { code, change }
  })

  const date = new Date(today.timestamp * 1000).toISOString().slice(0, 10)
  return { crossRates, changes, date, rawRates: r }
}
