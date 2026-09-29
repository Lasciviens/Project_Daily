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
    const cur = (s.currency || 'NOK').toUpperCase()
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

/** "12/10/2026" (en-GB). */
export function formatDayGB(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  return `${text} ${currency.toUpperCase()}`
}

const CYCLE_TEXT: Record<BillingCycle, string> = {
  monthly: '/ month', yearly: '/ year', weekly: '/ week', once: 'one-off', free: 'free',
}

/** "99 NOK / month", "Free", "499 NOK one-off", or null with no price. */
export function priceLabel(sub: Pick<ServiceSubscription, 'price' | 'currency' | 'billing_cycle'>): string | null {
  if (sub.billing_cycle === 'free') return 'Free'
  if (sub.price == null) return null
  return `${formatMoney(sub.price, sub.currency || 'NOK')} ${CYCLE_TEXT[sub.billing_cycle]}`
}
