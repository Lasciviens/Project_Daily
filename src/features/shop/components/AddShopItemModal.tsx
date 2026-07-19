import { useState, useEffect } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useShopCategories, useCreateShopCategory, useCreateShopItem } from '../hooks/useShop'
import { DateInput } from '../../../shared/components/DateInput'
import type { ShopPriority, ShopRegion } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

const NEW_TOP    = '__new_top__'
const NEW_SUB    = '__new_sub__'
const PRIORITIES: ShopPriority[] = ['low', 'medium', 'high']
const REGIONS: ShopRegion[]      = ['TR', 'NO']
const REGION_LABEL: Record<ShopRegion, string> = { TR: '🇹🇷 Turkey', NO: '🇳🇴 Norway' }

export function AddShopItemModal({ open, onClose }: Props) {
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

  useEffect(() => {
    if (!open) return
    setTopId(''); setNewTop(''); setSubId(''); setNewSub('')
    setTitle(''); setNotes(''); setPrice(''); setPlatform(''); setUrl('')
    setPriority('medium'); setRegion(''); setPlannedDate('')
  }, [open])

  const subsOfTop = topId && topId !== NEW_TOP
    ? categories.filter(c => c.parent_id === topId)
    : []

  async function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    const topName = topId === NEW_TOP ? newTop.trim() : ''
    // A brand-new top category has no existing subcategories to pick from,
    // so its subcategory name also comes from the `newSub` field.
    const subName = (subId === NEW_SUB || topId === NEW_TOP) ? newSub.trim() : ''
    if (topId === NEW_TOP && !topName) { toast.error('Enter a name for the new top category'); return }
    if ((subId === NEW_SUB || !subId) && !subName && topId !== NEW_TOP) { toast.error('Choose or name a subcategory'); return }
    if (topId === NEW_TOP && !subName) { toast.error('A new top category needs a subcategory name too'); return }

    setSaving(true)
    const tid = toast.loading('Saving…')
    try {
      let resolvedTopId = topId !== NEW_TOP ? topId : ''
      if (topId === NEW_TOP) {
        const created = await createCategory.mutateAsync({ name: topName })
        resolvedTopId = created.id
      }

      let resolvedSubId = subId !== NEW_SUB ? subId : ''
      if (subId === NEW_SUB || (topId === NEW_TOP)) {
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

      toast.dismiss(tid); toast.success('Added ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900">Add wishlist item</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-3">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What do you want to buy?" autoFocus className={inputCls} />

            <div className="grid grid-cols-2 gap-2">
              <select value={topId} onChange={e => { setTopId(e.target.value); setSubId('') }} className={inputCls}>
                <option value="">Top category…</option>
                {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value={NEW_TOP}>+ New top category</option>
              </select>
              {topId === NEW_TOP ? (
                <input value={newTop} onChange={e => setNewTop(e.target.value)} placeholder="New top category name" className={inputCls} />
              ) : (
                <select value={subId} onChange={e => setSubId(e.target.value)} disabled={!topId} className={inputCls}>
                  <option value="">Subcategory…</option>
                  {subsOfTop.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value={NEW_SUB}>+ New subcategory</option>
                </select>
              )}
            </div>
            {(subId === NEW_SUB || topId === NEW_TOP) && (
              <input value={newSub} onChange={e => setNewSub(e.target.value)} placeholder="New subcategory name" className={inputCls} />
            )}

            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
              className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm text-ink-900 resize-none focus:outline-none focus:ring-2 focus:ring-accent-400" />

            <div className="grid grid-cols-2 gap-2">
              <input value={price} onChange={e => setPrice(e.target.value)} type="number" min="0" placeholder="Price" className={inputCls} />
              <input value={platform} onChange={e => setPlatform(e.target.value)} placeholder="Platform (optional)" className={inputCls} />
            </div>

            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Link (optional)" className={inputCls} />

            <div className="grid grid-cols-3 gap-2">
              <select value={priority} onChange={e => setPriority(e.target.value as ShopPriority)} className={inputCls}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={region} onChange={e => setRegion(e.target.value as ShopRegion | '')} className={inputCls}>
                <option value="">Region…</option>
                {REGIONS.map(r => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
              </select>
              <DateInput value={plannedDate} onChange={setPlannedDate} className={inputCls} />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
            <button onClick={onClose} className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !title.trim()} className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add item'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
