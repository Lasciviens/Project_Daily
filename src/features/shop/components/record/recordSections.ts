import { useCallback, useState } from 'react'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { complete, DISPOSAL_LABEL, isPossession, valueAgeDays, valueNowOf, VALUE_STALE_DAYS, type MoneyCtx } from '../../ownModel'
import { currencyOf } from '../../shopModel'
import { mixedWords } from '../../watchWords'
import { money } from '../shopFormat'
import type { MarketSearch } from '../../purchaseModel'
import type { ShopItem, ShopPriceWatch } from '../../types'

// The record's sections that open in place (RecordSection): which ones are
// open, which ones a row has, and what each says while it is folded.

/** The sections, in their order. */
export type SectionId = 'models' | 'purchase' | 'price' | 'market' | 'resale' | 'facts' | 'money'

// Which sections the owner keeps open, remembered on this device (a UI
// choice like the folded categories; a private window simply starts folded).
const KEY = 'lasci.shop.recordOpen'
const IDS: readonly SectionId[] = ['models', 'purchase', 'price', 'market', 'resale', 'facts', 'money']

function read(): Set<SectionId> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) return null
    const list: unknown = JSON.parse(raw)
    return new Set(Array.isArray(list) ? list.filter((x): x is SectionId => IDS.includes(x as SectionId)) : [])
  } catch { return null }
}

/**
 * The open sections: what the owner left open last time on this device
 * (none remembered: `fallback` — a general wish's models), plus `force` — the
 * one a record opened at (an old "Could sell for": Resale) — open, but not
 * remembered until it is toggled.
 */
export function useOpenSections(fallback: readonly SectionId[], force: SectionId | null) {
  const [open, setOpen] = useState<Set<SectionId>>(() => {
    const s = read() ?? new Set(fallback)
    if (force) s.add(force)
    return s
  })
  const toggle = useCallback((id: SectionId) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* storage unavailable: kept for this record */ }
    return next
  }), [])
  /** Open one (a nudge that edits a fact in it); never folds one. */
  const show = useCallback((id: SectionId) => setOpen(prev => (prev.has(id) ? prev : new Set(prev).add(id))), [])
  return { open, toggle, show }
}

/** Whether a row has money links to show: a thing you have or had (not an accessory — it rides with its item), or a wish. */
export function hasMoneyLinks(item: ShopItem): boolean {
  if (item.accessory_of) return false
  if (item.kind === 'general') return item.status === 'wishlist'
  return isPossession(item) || item.status === 'wishlist'
}

/** The Price section folded: the price read and its day, or why there is none. */
export function priceSummary(item: ShopItem, watch: ShopPriceWatch | null): string {
  const w = watch && watch.url === item.url ? watch : null
  if (!w) return 'not checked yet'
  if (w.low == null) return w.status === 'not_allowed' ? 'apps may not read it' : 'no price read'
  return `${money(w.low, (w.currency ?? currencyOf(item)).toUpperCase())}${mixedWords(w)} · ${formatDate(w.last_ok_at ?? w.checked_at)}`
}

/** The Resale section folded: the estimate and whether it is old, or how it left. */
export function resaleSummary(item: ShopItem, ctx: MoneyCtx, today: string): string {
  if (item.disposal) return `${DISPOSAL_LABEL[item.disposal]}${item.disposed_on ? ` ${formatDate(item.disposed_on)}` : ''}`
  const value = valueNowOf(item, ctx)
  if (!value || !complete(value)) return item.value_now != null ? 'rate pending' : 'no estimate yet'
  const age = valueAgeDays(item, today)
  return `≈ ${money(value.nok)}${age != null && age > VALUE_STALE_DAYS ? ' · old' : ''}`
}

/** The Purchase section folded: not arrived yet, else the next of return by and complain by still ahead. */
export function purchaseSummary(item: ShopItem, today: string): string | undefined {
  if (item.bought_channel === 'online' && !item.arrived_on) return 'not arrived yet'
  if (item.return_by && item.return_by >= today) return `return by ${formatDate(item.return_by)}`
  if (item.warranty_until && item.warranty_until >= today) return `complain by ${formatDate(item.warranty_until)}`
  return undefined
}

/** The Used market section folded: the day a search was last opened, else where it can look. */
export function marketSummary(item: ShopItem, searches: readonly MarketSearch[]): string {
  return item.search_opened_on ? `Search opened ${formatDate(item.search_opened_on)}` : searches.map(s => s.store.name).join(' · ')
}
