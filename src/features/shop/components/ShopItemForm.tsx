import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SegmentedControl, cx } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { DecimalInput } from '../../recipes/components/foodLogKit'
import { SHOP_CURRENCIES, defaultCurrencyFor } from '../shopModel'
import type { ShopCategory, ShopCurrency, ShopList, ShopPriority, ShopReason, ShopRegion, ShopStatus } from '../types'
import { LinkReader } from './LinkReader'

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
  boughtDay: string
  /** A general wish ("any model") instead of one product — new wishlist rows only. */
  general: boolean
  priceMin: number | null
  priceMax: number | null
  requirements: string
  reason: ShopReason | ''
  image: string | null
}

const PRIORITIES: { value: ShopPriority; label: string }[] = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
]

/**
 * The item form for both lists. The quick list keeps to what an errand needs
 * (what, where, a note); everything else folds under More details there,
 * while the wishlist shows its planning fields up front.
 */
export function ShopItemForm({ draft, onChange, categories, stores, editing }: {
  draft: ShopDraft
  onChange: (patch: Partial<ShopDraft>) => void
  categories: readonly ShopCategory[]
  stores: readonly string[]
  editing: boolean
}) {
  const id = useId()
  const quick = draft.list === 'quick'
  const [more, setMore] = useState(false)
  const tops = categories.filter(c => !c.parent_id)
  const subs = draft.topId && draft.topId !== NEW_CATEGORY ? categories.filter(c => c.parent_id === draft.topId) : []

  const category = (
    <div>
      <span className="field-label">Category</span>
      <div className="grid grid-cols-2 gap-2">
        <select value={draft.topId} onChange={e => onChange({ topId: e.target.value, subId: '' })} aria-label="Category" className="select">
          <option value="">No category</option>
          {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value={NEW_CATEGORY}>+ New category…</option>
        </select>
        {draft.topId === NEW_CATEGORY ? (
          <input value={draft.newTop} onChange={e => onChange({ newTop: e.target.value })} placeholder="New category" aria-label="New category name" className="input" />
        ) : (
          <select value={draft.subId} onChange={e => onChange({ subId: e.target.value })} disabled={!draft.topId} aria-label="Subcategory" className="select disabled:opacity-50">
            <option value="">{draft.topId ? 'No subcategory' : 'Subcategory'}</option>
            {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            {draft.topId && <option value={NEW_CATEGORY}>+ New subcategory…</option>}
          </select>
        )}
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
      <label htmlFor={`${id}-price`} className="field-label">Price</label>
      <div className="flex gap-2">
        <DecimalInput id={`${id}-price`} value={draft.price} onValue={v => onChange({ price: v })} placeholder="0" className="input min-w-0 flex-1 tabular-nums" />
        <select value={draft.currency} onChange={e => onChange({ currency: e.target.value as ShopCurrency })} aria-label="Currency" className="select w-[6.5rem] shrink-0">
          {SHOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  )

  const store = (
    <div>
      <label htmlFor={`${id}-store`} className="field-label">Store</label>
      <input id={`${id}-store`} list={`${id}-stores`} value={draft.platform} onChange={e => onChange({ platform: e.target.value })}
        placeholder={quick ? 'Rema, Kiwi, pharmacy…' : 'Where to buy it'} className="input" />
      <datalist id={`${id}-stores`}>{stores.map(s => <option key={s} value={s} />)}</datalist>
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
      <label htmlFor={`${id}-notes`} className="field-label">{quick ? 'Amount or note' : 'Notes'}</label>
      <textarea id={`${id}-notes`} value={draft.notes} onChange={e => onChange({ notes: e.target.value })}
        placeholder={quick ? '2 packs, the lactose-free one…' : 'Optional'} rows={2} className="input resize-none" />
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

  const reason = !quick && (
    <div>
      <span className="field-label">Why</span>
      <SegmentedControl<ShopReason | ''> size="sm" value={draft.reason} onChange={r => onChange({ reason: r })}
        options={[{ value: 'need', label: 'Need it' }, { value: 'fun', label: 'Just for fun' }, { value: '', label: 'Not set' }]} />
    </div>
  )

  // The quick list has its own tick (bought) and ✕ (delete with Undo), so its
  // rows get no status here: a quick row set to "Not any more", or ticked with
  // an earlier day, would land in no view. Moving between lists is for open
  // rows only — a bought or dropped row lives in its own list's history.
  const status = editing && !quick && (
    <div>
      <span className="field-label">Status</span>
      <SegmentedControl<ShopStatus> size="sm" value={draft.status} onChange={s => onChange({ status: s })}
        options={[{ value: 'wishlist', label: 'To buy' }, { value: 'bought', label: 'Bought' }, { value: 'dropped', label: 'Not any more' }]} />
      {draft.status === 'bought' && (
        <div className="mt-2">
          <span className="field-label">Bought on</span>
          <DateInput value={draft.boughtDay} onChange={v => onChange({ boughtDay: v })} aria-label="Bought on" className="input w-[10rem] tabular-nums" />
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={`${id}-title`} className="field-label">Item</label>
        <input id={`${id}-title`} value={draft.title} onChange={e => onChange({ title: e.target.value })}
          placeholder={quick ? 'Milk, batteries, a gift card…' : draft.general ? 'A tablet with a pen for notes' : 'What do you want to buy?'} autoFocus={!editing} className="input" />
      </div>

      {draft.status === 'wishlist' && <div>
        <span className="field-label">List</span>
        <SegmentedControl<ShopList> size="sm" value={draft.list} onChange={l => onChange({ list: l })}
          options={[{ value: 'wishlist', label: 'Wishlist' }, { value: 'quick', label: 'Quick list' }]} />
      </div>}

      {!quick && !editing && (
        <SegmentedControl<'one' | 'any'> size="sm" value={draft.general ? 'any' : 'one'} onChange={v => onChange({ general: v === 'any' })}
          options={[{ value: 'one', label: 'One product' }, { value: 'any', label: 'Any model that fits' }]} />
      )}

      {!quick && !editing && !draft.general && <LinkReader url={draft.url} onUrl={url => onChange({ url })} onRead={r => onChange({
        ...(r.title && !draft.title.trim() ? { title: r.title } : {}),
        ...(r.price != null ? { price: r.price } : {}),
        ...(r.currency ? { currency: r.currency } : {}),
        ...(r.image ? { image: r.image } : {}),
      })} />}

      {quick ? <>{store}{notes}</> : draft.general ? <>
        {category}
        <div>
          <span className="field-label">Price range</span>
          <div className="flex max-w-sm items-center gap-2">
            <DecimalInput value={draft.priceMin} onValue={v => onChange({ priceMin: v })} placeholder="From" aria-label="From" className="input min-w-0 flex-1 tabular-nums" />
            <span className="text-fg-faint">–</span>
            <DecimalInput value={draft.priceMax} onValue={v => onChange({ priceMax: v })} placeholder="To" aria-label="To" className="input min-w-0 flex-1 tabular-nums" />
            <select value={draft.currency} onChange={e => onChange({ currency: e.target.value as ShopCurrency })} aria-label="Currency" className="select w-[6rem] shrink-0">
              {SHOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-req`} className="field-label">Must have <span className="font-normal text-fg-faint">(one per line)</span></label>
          <textarea id={`${id}-req`} value={draft.requirements} onChange={e => onChange({ requirements: e.target.value })} rows={3}
            placeholder={'Pen support\n11 inch or bigger'} className="input resize-none" />
        </div>
        {reason}{priority}{notes}
      </> : <>{category}<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{price}{store}</div>{reason}{priority}{buyOn}{notes}</>}

      {status}

      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore(m => !m)}
          className="flex min-h-[44px] items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
          <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', more && 'rotate-180')} /> More details
        </button>
        {more && (
          <div className="mt-1 flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-3">
            {quick ? <>{category}{price}{priority}{buyOn}</> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{region}{(quick || editing || draft.general) && link}</div>
          </div>
        )}
      </div>
    </div>
  )
}
