import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SegmentedControl, cx } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { defaultCurrencyFor } from '../shopModel'
import type { Fact } from '../autofillModel'
import type { ShopCategory, ShopCurrency, ShopDiscountReason, ShopList, ShopPriority, ShopReason, ShopRegion, ShopStatus } from '../types'
import { CategoryPicker } from './CategoryPicker'
import { MoneyEditor } from './shopEditors'
import { StoreNameField } from './shopPickers'

export const NEW_CATEGORY = '__new__'

/** What the form edits; category ids are '' for none and NEW_CATEGORY for "make one". */
export interface ShopDraft {
  title: string
  list: ShopList
  topId: string
  newTop: string
  subId: string
  newSub: string
  notes: string
  price: number | null
  currency: ShopCurrency
  platform: string
  url: string
  priority: ShopPriority
  region: ShopRegion | ''
  plannedDate: string
  status: ShopStatus
  /** Unused here since the sheet edits only quick-list rows; Add something I own still sets it. */
  boughtDay?: string
  /** A general wish ("any model") instead of one product — new wishlist rows only. */
  general: boolean
  priceMin: number | null
  priceMax: number | null
  requirements: string
  reason: ShopReason | ''
  image: string | null
  /** What the receipt took off (the create popup's Discount fact); the paid price is already after it. */
  discountAmount?: number | null
  discountReason?: ShopDiscountReason | null
  /** What the add sheet's autofill filled in, each with its source (autofillModel) — new one-product wishes only. */
  facts: Fact[]
}

const PRIORITIES: { value: ShopPriority; label: string }[] = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
]

/**
 * The quick list's errand form (`ShopItemSheet`): what, where, a note — the rest under More details. An errand is not a
 * thing: a wish or something you own is added in the one body (RecordBody, mode add), never here. The List switch moves
 * an errand to the wishlist; on a new row the sheet hands "Wishlist" over to that body (`onWish`).
 */
export function ShopItemForm({ draft, onChange, categories, editing, onWish }: {
  draft: ShopDraft
  onChange: (patch: Partial<ShopDraft>) => void
  categories: readonly ShopCategory[]
  editing: boolean
  /** A new row asked to be a wish: the sheet opens the one body with what was typed. */
  onWish?: () => void
}) {
  const id = useId()
  const [more, setMore] = useState(false)

  // The owner's own categories, then suggested ones (picking one adds it at once); a typed new one is made on save.
  const category = (
    <div>
      <span className="field-label">Category</span>
      <div className="grid grid-cols-2 gap-2">
        <CategoryPicker categories={categories} value={{ topId: draft.topId, subId: draft.subId }} newValue={NEW_CATEGORY}
          onChange={p => onChange({ topId: p.topId, subId: p.subId })}
          sub={draft.topId === NEW_CATEGORY
            ? <input value={draft.newTop} onChange={e => onChange({ newTop: e.target.value })} placeholder="New category" aria-label="New category name" className="input" />
            : undefined} />
      </div>
      {(draft.subId === NEW_CATEGORY || draft.topId === NEW_CATEGORY) && (
        <input value={draft.newSub} onChange={e => onChange({ newSub: e.target.value })}
          placeholder={draft.topId === NEW_CATEGORY ? 'Subcategory (optional)' : 'New subcategory'}
          aria-label="New subcategory name" className="input mt-2" />
      )}
    </div>
  )

  const price = (
    <div>
      <span className="field-label">Price</span>
      <MoneyEditor label="Price" amount={draft.price} currency={draft.currency} onAmount={v => onChange({ price: v })} onCurrency={c => onChange({ currency: c })} />
    </div>
  )

  // A grocery store is seldom in Stores: the quick list opens on the typed name.
  const store = (
    <div>
      <span className="field-label">Store</span>
      <StoreNameField label="Store" value={draft.platform} onChange={platform => onChange({ platform })} typing
        placeholder="Pick a store" />
    </div>
  )

  const priority = (
    <div>
      <span className="field-label">Priority</span>
      <SegmentedControl<ShopPriority> size="sm" options={PRIORITIES} value={draft.priority} onChange={p => onChange({ priority: p })} />
    </div>
  )

  const buyOn = (
    <div>
      <span className="field-label">Buy on</span>
      <DateInput value={draft.plannedDate} onChange={v => onChange({ plannedDate: v })} aria-label="Buy on" className="input w-[10rem] tabular-nums" />
    </div>
  )

  const notes = (
    <div>
      <label htmlFor={`${id}-notes`} className="field-label">Amount or note</label>
      <textarea id={`${id}-notes`} value={draft.notes} onChange={e => onChange({ notes: e.target.value })}
        placeholder="2 packs, the lactose-free one…" rows={2} className="input resize-none" />
    </div>
  )

  const region = (
    <div>
      <label htmlFor={`${id}-region`} className="field-label">Buy it in</label>
      <select id={`${id}-region`} value={draft.region}
        onChange={e => {
          const r = e.target.value as ShopRegion | ''
          // A price typed before picking Turkey is most likely in lira, and back.
          onChange({ region: r, ...(draft.price == null ? { currency: defaultCurrencyFor(r || null) } : {}) })
        }} className="select">
        <option value="">Anywhere</option>
        <option value="NO">🇳🇴 Norway</option>
        <option value="TR">🇹🇷 Turkey</option>
      </select>
    </div>
  )

  const link = (
    <div>
      <label htmlFor={`${id}-url`} className="field-label">Link</label>
      <input id={`${id}-url`} value={draft.url} onChange={e => onChange({ url: e.target.value })} type="url" inputMode="url" placeholder="Optional" className="input" />
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={`${id}-title`} className="field-label">Item</label>
        <input id={`${id}-title`} value={draft.title} onChange={e => onChange({ title: e.target.value })}
          placeholder="Milk, batteries, a gift card…" autoFocus={!editing} className="input" />
      </div>

      {draft.status === 'wishlist' && <div>
        <span className="field-label">List</span>
        <SegmentedControl<ShopList> size="sm" value={draft.list} onChange={l => (l === 'wishlist' && !editing && onWish ? onWish() : onChange({ list: l }))}
          options={[{ value: 'wishlist', label: 'Wishlist' }, { value: 'quick', label: 'Quick list' }]} />
      </div>}

      {store}{notes}

      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore(m => !m)}
          className="flex min-h-[44px] items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
          <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', more && 'rotate-180')} /> More details
        </button>
        {more && (
          <div className="mt-1 flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-3">
            {category}{price}{priority}{buyOn}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{region}{link}</div>
          </div>
        )}
      </div>
    </div>
  )
}
