// Pure subscription rules (service_subscriptions, migration 115). Import-free
// so scripts/verify-subscriptions.cjs can require it through sucrase.

export type BillingCycle = 'monthly' | 'yearly' | 'weekly' | 'once' | 'free'
export type Requirement = 'required' | 'info'

export interface ServiceSubscription {
  id: string
  user_id?: string
  service: string
  name: string | null
  account: string | null
  plan: string | null
  price: number | null
  currency: string
  billing_cycle: BillingCycle
  renews_on: string | null
  requirement: Requirement
  notes: string | null
  active: boolean
  created_at?: string
  updated_at?: string
}

export type SubscriptionInput = Omit<ServiceSubscription, 'id' | 'user_id' | 'created_at' | 'updated_at'>

export const BILLING_CYCLES: BillingCycle[] = ['monthly', 'yearly', 'weekly', 'once', 'free']

/** Service keys with a connection card (plus a few common ones for the picker). */
export const KNOWN_SERVICES: { key: string; label: string }[] = [
  { key: 'google', label: 'Google' },
  { key: 'strava', label: 'Strava' },
  { key: 'playstation', label: 'PlayStation' },
  { key: 'steam', label: 'Steam' },
  { key: 'hevy', label: 'Hevy' },
  { key: 'apple_health', label: 'Apple Health' },
  { key: 'screenscraper', label: 'ScreenScraper' },
  { key: 'supabase', label: 'Supabase' },
  { key: 'gemini', label: 'Gemini' },
]

const ALIASES: Record<string, string> = {
  psn: 'playstation', 'ps plus': 'playstation', 'playstation plus': 'playstation',
  'apple health': 'apple_health', 'health auto export': 'apple_health',
  'google calendar': 'google', 'google tasks': 'google',
}

/** One key per service: lower case, trimmed, known aliases folded. */
export function serviceKey(service: string): string {
  const s = service.trim().toLowerCase().replace(/\s+/g, ' ')
  return ALIASES[s] ?? s
}

export function serviceLabel(service: string): string {
  const key = serviceKey(service)
  return KNOWN_SERVICES.find(k => k.key === key)?.label ?? service.trim()
}

export function subscriptionsFor(subs: readonly ServiceSubscription[], service: string): ServiceSubscription[] {
  const key = serviceKey(service)
  return subs.filter(s => serviceKey(s.service) === key)
}

/** Subscriptions whose service has no card among `cardKeys`. */
export function otherSubscriptions(subs: readonly ServiceSubscription[], cardKeys: readonly string[]): ServiceSubscription[] {
  const keys = new Set(cardKeys.map(serviceKey))
  return subs.filter(s => !keys.has(serviceKey(s.service)))
}

/** Monthly-equivalent cost: yearly / 12, weekly × 52 / 12; once/free/no price → 0. */
export function monthlyCost(sub: Pick<ServiceSubscription, 'price' | 'billing_cycle'>): number {
  const p = sub.price ?? 0
  if (!Number.isFinite(p) || p <= 0) return 0
  switch (sub.billing_cycle) {
    case 'monthly': return p
    case 'yearly': return p / 12
    case 'weekly': return (p * 52) / 12
    default: return 0
  }
}

/** Monthly total per currency over active subscriptions (no FX conversion). */
export function monthlyTotals(subs: readonly ServiceSubscription[]): { currency: string; amount: number }[] {
  const map = new Map<string, number>()
  for (const s of subs) {
    if (!s.active) continue
    const m = monthlyCost(s)
    if (m <= 0) continue
    const cur = normalizeCurrency(s.currency)
    map.set(cur, (map.get(cur) ?? 0) + m)
  }
  return [...map.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
}

/** Whole days from `today` to `date` (both yyyy-MM-dd), UTC-safe. */
export function daysBetween(today: string, date: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  const b = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export type RenewalState = 'none' | 'ok' | 'soon' | 'past'
export const RENEWAL_SOON_DAYS = 7

export function renewalState(renewsOn: string | null, today: string): { state: RenewalState; days: number | null } {
  if (!renewsOn) return { state: 'none', days: null }
  const days = daysBetween(today, renewsOn)
  if (days < 0) return { state: 'past', days }
  if (days <= RENEWAL_SOON_DAYS) return { state: 'soon', days }
  return { state: 'ok', days }
}

/** The earliest renewal on or after today among active subscriptions. */
export function nextRenewal(subs: readonly ServiceSubscription[], today: string): ServiceSubscription | null {
  let best: ServiceSubscription | null = null
  for (const s of subs) {
    if (!s.active || !s.renews_on || s.renews_on < today) continue
    if (!best || s.renews_on < best.renews_on!) best = s
  }
  return best
}

/** A required subscription that is off or past its renewal date: the integration may stop working. */
export function needsAttention(sub: ServiceSubscription, today: string): boolean {
  if (sub.requirement !== 'required') return false
  return !sub.active || renewalState(sub.renews_on, today).state === 'past'
}

/** "12.10.2026" from 'yyyy-MM-dd' (the app's one date format). */
export function formatDay(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

/** "1 234" — thousands grouped with a space, whatever the browser locale. */
function groupThousands(intText: string): string {
  return intText.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const neg = rounded < 0
  const abs = Math.abs(rounded)
  const [int, dec] = (Number.isInteger(abs) ? String(abs) : abs.toFixed(2)).split('.')
  return `${neg ? '-' : ''}${groupThousands(int)}${dec ? '.' + dec : ''} ${currency.toUpperCase()}`
}

// ── Currencies ───────────────────────────────────────────────────────────────
// The four the owner pays in. Rates come from Open Exchange Rates through the
// Home currency widget's query (useCurrencyRates → rawRates: X per 1 USD).

export const SUBSCRIPTION_CURRENCIES = ['NOK', 'TRY', 'USD', 'EUR'] as const
export type SubscriptionCurrency = typeof SUBSCRIPTION_CURRENCIES[number]

const CURRENCY_ALIASES: Record<string, string> = {
  TL: 'TRY', '₺': 'TRY', YTL: 'TRY', KR: 'NOK', NKR: 'NOK', '$': 'USD', US$: 'USD', '€': 'EUR',
}

/** Upper-cased ISO code; common spellings (TL, kr, $, €) folded; blank → NOK. */
export function normalizeCurrency(currency: string | null | undefined): string {
  const c = (currency ?? '').trim().toUpperCase()
  if (!c) return 'NOK'
  return CURRENCY_ALIASES[c] ?? c
}

/** USD-base rates (X per 1 USD), as OXR returns them. */
export type UsdRates = Record<string, number>

/** `amount` in `from` expressed in `to`; null when a rate is missing. */
export function convertAmount(amount: number, from: string, to: string, rates: UsdRates): number | null {
  const f = normalizeCurrency(from)
  const t = normalizeCurrency(to)
  if (f === t) return amount
  const rf = f === 'USD' ? 1 : rates[f]
  const rt = t === 'USD' ? 1 : rates[t]
  if (!rf || !rt || !Number.isFinite(rf) || !Number.isFinite(rt)) return null
  return (amount / rf) * rt
}

/** The amount in each of the other subscription currencies (those with a rate), in list order. */
export function equivalents(amount: number, from: string, rates: UsdRates): { currency: string; amount: number }[] {
  const f = normalizeCurrency(from)
  const out: { currency: string; amount: number }[] = []
  for (const c of SUBSCRIPTION_CURRENCIES) {
    if (c === f) continue
    const v = convertAmount(amount, f, c, rates)
    if (v != null) out.push({ currency: c, amount: v })
  }
  return out
}

/** Rounded for an "≈" line: whole units from 10 up, else two decimals ("0.85"). */
export function formatApproxMoney(amount: number, currency: string): string {
  const v = Math.abs(amount) >= 10 ? Math.round(amount) : Math.round(amount * 100) / 100
  return formatMoney(v, currency)
}

/** "≈ 1 234 TRY · 32 USD · 29 EUR", or null with nothing to show. */
export function approxLine(list: readonly { currency: string; amount: number }[]): string | null {
  if (!list.length) return null
  return `≈ ${list.map(e => formatApproxMoney(e.amount, e.currency)).join(' · ')}`
}

/**
 * Every active subscription's monthly cost converted into `target`.
 * `unconverted` lists the per-currency totals that had no rate (never dropped).
 */
export function monthlyTotalIn(subs: readonly ServiceSubscription[], target: string, rates: UsdRates): {
  amount: number; unconverted: { currency: string; amount: number }[]
} {
  let amount = 0
  const unconverted: { currency: string; amount: number }[] = []
  for (const t of monthlyTotals(subs)) {
    const v = convertAmount(t.amount, t.currency, target, rates)
    if (v == null) unconverted.push(t)
    else amount += v
  }
  return { amount: Math.round(amount * 100) / 100, unconverted }
}

const CYCLE_TEXT: Record<BillingCycle, string> = {
  monthly: '/ month', yearly: '/ year', weekly: '/ week', once: 'one-off', free: 'free',
}

/** "99 NOK / month", "Free", "499 NOK one-off", or null with no price. */
export function priceLabel(sub: Pick<ServiceSubscription, 'price' | 'currency' | 'billing_cycle'>): string | null {
  if (sub.billing_cycle === 'free') return 'Free'
  if (sub.price == null) return null
  return `${formatMoney(sub.price, normalizeCurrency(sub.currency))} ${CYCLE_TEXT[sub.billing_cycle]}`
}
