import { useState } from 'react'
import { toast } from '../../../app/store'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { useShopCategories, useCreateShopCategory, useCreateShopItem } from '../hooks/useShop'
import { DateInput } from '../../../shared/components/DateInput'
import type { ShopPriority, ShopRegion } from '../types'

const NEW_TOP    = '__new_top__'
const NEW_SUB    = '__new_sub__'
const PRIORITIES: ShopPriority[] = ['low', 'medium', 'high']
const REGIONS: ShopRegion[]      = ['TR', 'NO']
const REGION_LABEL: Record<ShopRegion, string> = { TR: '🇹🇷 Turkey', NO: '🇳🇴 Norway' }

/** Add a wishlist item. Mounted only while open, so every open starts blank. */
export function AddShopItemModal({ onClose }: { onClose: () => void }) {
  const { data: categories = [] } = useShopCategories()
  const createCategory = useCreateShopCategory()
  const createItem     = useCreateShopItem()

  const tops = categories.filter(c => !c.parent_id)

  const [topId,    setTopId]    = useState('')
  const [newTop,   setNewTop]   = useState('')
  const [subId,    setSubId]    = useState('')
  const [newSub,   setNewSub]   = useState('')
  const [title,    setTitle]    = useState('')
  const [notes,    setNotes]    = useState('')
  const [price,    setPrice]    = useState('')
  const [platform, setPlatform] = useState('')
  const [url,      setUrl]      = useState('')
  const [priority, setPriority] = useState<ShopPriority>('medium')
  const [region,   setRegion]   = useState<ShopRegion | ''>('')
  const [plannedDate, setPlannedDate] = useState('')
  const [saving,   setSaving]   = useState(false)

  const subsOfTop = topId && topId !== NEW_TOP
    ? categories.filter(c => c.parent_id === topId)
    : []

  async function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    const topName = topId === NEW_TOP ? newTop.trim() : ''
    // A brand-new top category has no subcategories to pick from, so its
    // subcategory name also comes from the `newSub` field.
    const subName = (subId === NEW_SUB || topId === NEW_TOP) ? newSub.trim() : ''
    if (topId === NEW_TOP && !topName) { toast.error('Enter a name for the new top category'); return }
    if ((subId === NEW_SUB || !subId) && !subName && topId !== NEW_TOP) { toast.error('Choose or name a subcategory'); return }
    if (topId === NEW_TOP && !subName) { toast.error('A new top category needs a subcategory name too'); return }

    // Each step's hook toasts its own failure; the catch only stops the flow.
    setSaving(true)
    try {
      let resolvedTopId = topId !== NEW_TOP ? topId : ''
      if (topId === NEW_TOP) {
        const created = await createCategory.mutateAsync({ name: topName })
        resolvedTopId = created.id
      }

      let resolvedSubId = subId !== NEW_SUB ? subId : ''
      if (subId === NEW_SUB || topId === NEW_TOP) {
        const created = await createCategory.mutateAsync({ name: subName, parent_id: resolvedTopId })
        resolvedSubId = created.id
      }

      await createItem.mutateAsync({
        category_id:  resolvedSubId,
        title:        title.trim(),
        notes:        notes.trim() || null,
        price:        price ? Number(price) : null,
        platform:     platform.trim() || null,
        url:          url.trim() || null,
        priority,
        region:       region || null,
        planned_date: plannedDate || null,
      })
      onClose()
    } catch {
      return
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Add wishlist item"
      size="sm"
      dismissible={!saving}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} disabled={saving} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!title.trim()} className="w-full sm:w-auto">Add item</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="shop-title" className="field-label">Item</label>
          <input id="shop-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="What do you want to buy?" autoFocus className="input" />
        </div>

        <div>
          <span className="field-label">Category</span>
          <div className="grid grid-cols-2 gap-2">
            <select value={topId} onChange={e => { setTopId(e.target.value); setSubId('') }} aria-label="Top category" className="select">
              <option value="">Top category…</option>
              {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value={NEW_TOP}>+ New top category</option>
            </select>
            {topId === NEW_TOP ? (
              <input value={newTop} onChange={e => setNewTop(e.target.value)} placeholder="New top category" aria-label="New top category name" className="input" />
            ) : (
              <select value={subId} onChange={e => setSubId(e.target.value)} disabled={!topId} aria-label="Subcategory" className="select disabled:opacity-50">
                <option value="">Subcategory…</option>
                {subsOfTop.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NEW_SUB}>+ New subcategory</option>
              </select>
            )}
          </div>
          {(subId === NEW_SUB || topId === NEW_TOP) && (
            <input value={newSub} onChange={e => setNewSub(e.target.value)} placeholder="New subcategory name" aria-label="New subcategory name" className="input mt-2" />
          )}
        </div>

        <div>
          <label htmlFor="shop-notes" className="field-label">Notes</label>
          <textarea id="shop-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" rows={2} className="input resize-none" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="shop-price" className="field-label">Price</label>
            <input id="shop-price" value={price} onChange={e => setPrice(e.target.value)} type="number" min="0" inputMode="decimal" placeholder="0" className="input" />
          </div>
          <div>
            <label htmlFor="shop-platform" className="field-label">Platform</label>
            <input id="shop-platform" value={platform} onChange={e => setPlatform(e.target.value)} placeholder="Optional" className="input" />
          </div>
        </div>

        <div>
          <label htmlFor="shop-url" className="field-label">Link</label>
          <input id="shop-url" value={url} onChange={e => setUrl(e.target.value)} type="url" inputMode="url" placeholder="Optional" className="input" />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label htmlFor="shop-priority" className="field-label">Priority</label>
            <select id="shop-priority" value={priority} onChange={e => setPriority(e.target.value as ShopPriority)} className="select capitalize">
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="shop-region" className="field-label">Region</label>
            <select id="shop-region" value={region} onChange={e => setRegion(e.target.value as ShopRegion | '')} className="select">
              <option value="">Any</option>
              {REGIONS.map(r => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <span className="field-label">Planned for</span>
            <DateInput value={plannedDate} onChange={setPlannedDate} className="input" />
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
