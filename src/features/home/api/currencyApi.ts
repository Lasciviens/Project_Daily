// Open Exchange Rates — free tier, hourly updates, USD base.
// Docs: https://docs.openexchangerates.org/reference/latest-json
// Key stored in VITE_OXR_APP_ID (GitHub Secret).
const OXR_BASE = 'https://openexchangerates.org/api'
const APP_ID   = import.meta.env.VITE_OXR_APP_ID as string | undefined

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrossRate {
  pair:      string
  base:      string
  quote:     string
  rate:      number
  changePct: number   // this pair's own % move since yesterday (not vs a 3rd currency)
}

export interface GoldPrice {
  usdPerOz:   number
  nokPerGram: number
  changePct:  number   // vs yesterday, on the USD/oz price
}

export interface CurrencyChange {
  code:   string
  change: number   // percentage change vs yesterday (positive = currency gained vs USD)
}

export interface CurrencyData {
  // The user's two home currencies, shown first and biggest — NOT run through
  // a 3rd currency, so "NOK vs TRY" reads as one clear number, not a jumble.
  primary:   CrossRate   // NOK/TRY
  // USD and EUR "in their own parity" — the EUR/USD rate itself, independent
  // of NOK/TRY (previously the widget only ever showed USD/EUR THROUGH NOK/TRY
  // cross rates, e.g. "EUR/NOK", which doesn't answer "how is EUR doing vs USD").
  secondary: CrossRate   // EUR/USD
  gold:      GoldPrice
  changes:   CurrencyChange[]   // each tracked currency's own 24h move vs USD
  date:      string
  rawRates:  Record<string, number>  // USD-base rates; converter uses these
}

const GRAMS_PER_TROY_OUNCE = 31.1034768

// Tracked for the "change" tab (each currency's own day move) — XAU (gold) is
// tracked the same way as a currency here since OXR quotes it that way (units
// of XAU per 1 USD), which is what makes the shared %-change math work for it too.
const TRACKED = ['NOK', 'TRY', 'EUR', 'USD', 'XAU']

// ─── Fetch helpers ────────────────────────────────────────────────────────────

interface OXRResponse {
  timestamp: number
  base:      string
  rates:     Record<string, number>
}

async function fetchLatest(): Promise<OXRResponse> {
  if (!APP_ID) throw new Error('VITE_OXR_APP_ID is not configured')
  const symbols = TRACKED.join(',')
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

// A cross-rate's own day-over-day % change — e.g. NOK/TRY's move, independent
// of any other currency (not "how NOK moved vs USD" or "how TRY moved vs USD").
function pairChange(base: string, quote: string, rNow: Record<string, number>, rPrev: Record<string, number>): CrossRate {
  const nowRate  = (rNow[quote]  ?? 1) / (rNow[base]  ?? 1)
  const prevRate = (rPrev[quote] ?? 1) / (rPrev[base] ?? 1)
  const changePct = prevRate !== 0 ? ((nowRate - prevRate) / prevRate) * 100 : 0
  return { pair: `${base}/${quote}`, base, quote, rate: nowRate, changePct }
}

// ─── Exported functions ───────────────────────────────────────────────────────

export async function fetchCurrencyData(): Promise<CurrencyData> {
  const [today, yesterday] = await Promise.all([
    fetchLatest(),
    fetchHistorical(yesterdayISO()),
  ])

  // OXR free tier uses USD as base; all rates are X per 1 USD
  const r:    Record<string, number> = { ...today.rates,     USD: 1 }
  const rYst: Record<string, number> = { ...yesterday.rates, USD: 1 }

  const primary   = pairChange('NOK', 'TRY', r, rYst)
  const secondary = pairChange('EUR', 'USD', r, rYst)

  const usdPerOz     = r.XAU ? 1 / r.XAU : 0
  const usdPerOzYst   = rYst.XAU ? 1 / rYst.XAU : usdPerOz
  const gold: GoldPrice = {
    usdPerOz,
    nokPerGram: (usdPerOz * (r.NOK ?? 1)) / GRAMS_PER_TROY_OUNCE,
    changePct:  usdPerOzYst !== 0 ? ((usdPerOz - usdPerOzYst) / usdPerOzYst) * 100 : 0,
  }

  const changes: CurrencyChange[] = TRACKED.map(code => {
    const now  = today.rates[code]     ?? 1
    const prev = yesterday.rates[code] ?? now
    // Higher rate = weaker currency (or cheaper gold) vs USD, so invert the direction
    const change = prev !== 0 ? -((now - prev) / prev) * 100 : 0
    return { code, change }
  })

  const date = new Date(today.timestamp * 1000).toISOString().slice(0, 10)
  return { primary, secondary, gold, changes, date, rawRates: r }
}
