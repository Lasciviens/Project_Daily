import { useCallback, useState } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { useCreateShopItem, useShopCategories } from '../../hooks/useShop'
import { useQuietCheck } from '../../hooks/useShopPrices'
import { useResolveCategory } from '../../hooks/useCategorySuggestions'
import { currencyOf } from '../../shopModel'
import { factsToSave } from '../../factsKept'
import { ShopAutofill, type ShopDraft } from '../ShopItemForm'
import { MoneyEditor } from '../record/factKit'
import { CategoryPicker } from '../CategoryPicker'
import { StoreNameField } from '../shopPickers'
import type { ShopCategory, ShopItem } from '../../types'

/** The wish's own category as a picker's pair: the model starts in it. */
function categoryOf(wish: ShopItem, categories: readonly ShopCategory[]): Pick<ShopDraft, 'topId' | 'subId'> {
  const cat = wish.category_id ? categories.find(c => c.id === wish.category_id) : undefined
  return { topId: cat ? (cat.parent_id ?? cat.id) : '', subId: cat?.parent_id ? cat.id : '' }
}

/** The fields this sheet shares with the Wishlist's add: one draft, so the same autofill fills them. */
function draftOf(wish: ShopItem, categories: readonly ShopCategory[]): ShopDraft {
  return {
    title: '', list: 'wishlist', ...categoryOf(wish, categories), newTop: '', newSub: '', notes: '', price: null, currency: currencyOf(wish),
    platform: '', url: '', priority: 'medium', region: wish.region ?? '', plannedDate: '', status: 'wishlist', boughtDay: '', general: false,
    priceMin: null, priceMax: null, requirements: '', reason: '', image: null, facts: [],
  }
}

/**
 * Add a model to a general wish. It has the Wishlist add's tools (owner, 12.11.2026: same job, same features): the
 * link reader, barcode scan, facts with their sources, Find it, the picture and "You may already have this"
 * (`ShopAutofill`), the store picked from your Stores and the category (the wish's to start with). The morning
 * check keeps its price fresh where the site lets apps read it.
 */
export function ModelSheet({ wish, onClose }: { wish: ShopItem; onClose: () => void }) {
  const create = useCreateShopItem()
  const check = useQuietCheck()
  const suggested = useResolveCategory()
  const { data: categories = [] } = useShopCategories()
  const [draft, setDraft] = useState<ShopDraft>(() => draftOf(wish, categories))
  // Categories that land after the sheet opened still start it in the wish's category (unless one was picked).
  const [seeded, setSeeded] = useState(categories.length > 0)
  if (!seeded && categories.length) {
    setSeeded(true)
    setDraft(d => (d.topId || d.subId ? d : { ...d, ...categoryOf(wish, categories) }))
  }
  const onChange = useCallback((patch: Partial<ShopDraft>) => setDraft(d => ({ ...d, ...patch })), [])
  // The autofill's answers land later: worked out from the draft as it is then.
  const update = useCallback((change: (d: ShopDraft) => Partial<ShopDraft>) => setDraft(d => {
    const patch = change(d)
    return Object.keys(patch).length ? { ...d, ...patch } : d
  }), [])
  const { title, topId, subId, price, currency } = draft

  async function save() {
    const t = title.trim()
    if (!t) return
    let row: ShopItem
    try {
      // A suggested category picked here is made now, with the save.
      const categoryId = await suggested.resolve({ topId, subId }, categories)
      const kept = factsToSave(draft.facts, draft)
      row = await create.mutateAsync({ input: {
        title: t, price, currency, url: draft.url.trim() || null, image_url: draft.image, platform: draft.platform.trim() || null,
        list: 'wishlist', category_id: categoryId, region: wish.region, option_for: wish.id,
        ...(kept.ean ? { ean: kept.ean } : {}),
        ...(kept.facts ? { facts: kept.facts } : {}),
      } })
    } catch { return }
    if (row.url) check([row.id])
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title="Add a model" subtitle={wish.title} size="md" dismissible={!create.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose} className="ml-auto" disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => { void save() }} disabled={!title.trim()} loading={suggested.busy || create.isPending}>Add model</Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="model-title" className="field-label">Model</label>
          <input id="model-title" value={title} onChange={e => onChange({ title: e.target.value })} placeholder="iPad Air 11&quot; M3 128 GB" autoFocus className="input" />
        </div>
        <ShopAutofill draft={draft} onChange={onChange} update={update} categories={categories} />
        <div>
          <span className="field-label">Category</span>
          <div className="grid grid-cols-2 gap-2">
            <CategoryPicker categories={categories} value={{ topId, subId }} onChange={p => onChange({ topId: p.topId, subId: p.subId })} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="field-label">Price</span>
            <MoneyEditor label="Price" amount={price} currency={currency} onAmount={v => onChange({ price: v })} onCurrency={c => onChange({ currency: c })} />
          </div>
          <div>
            <span className="field-label">Store <span className="font-normal text-fg-muted">(optional)</span></span>
            <StoreNameField label="Store" value={draft.platform} onChange={platform => onChange({ platform })} />
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
