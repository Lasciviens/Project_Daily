import { useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { IconButton, cx } from '../../../../shared/ui'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { categoryPath } from '../../shopModel'
import { newShopId } from '../../api/shopApi'
import type { DraftAccessory, DraftStep } from '../../chainDraft'
import { Toggle } from '../record/factKit'
import type { SetStep } from './StepFields'
import type { ShopCategory, ShopRegion } from '../../types'

/** How many of the folded details are filled — shown on the fold. */
function filled(s: DraftStep): number {
  return [s.categoryId, s.platform.trim(), s.region, s.approx, s.used, s.gift, s.forResale, s.notes.trim(), s.url.trim(), s.accessories.length].filter(Boolean).length
}

/**
 * Everything else the record knows, folded: category, store, country, the
 * yes/no facts, notes, a link and accessories bought with it (same day and
 * currency; they leave with it). Editing a copied fact makes it this step's own.
 */
export function StepMore({ s, set, categories, stores, listId }: {
  s: DraftStep
  set: SetStep
  categories: readonly ShopCategory[]
  stores: readonly string[]
  listId: string
}) {
  const [open, setOpen] = useState(false)
  const path = categoryPath(s.categoryId, categories)
  const tops = categories.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  const subs = path.topId ? categories.filter(c => c.parent_id === path.topId).sort((a, b) => a.name.localeCompare(b.name)) : []
  const count = filled(s)
  const setAcc = (key: string, patch: Partial<DraftAccessory>) => set({ accessories: s.accessories.map(a => (a.key === key ? { ...a, ...patch } : a)) })
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-2 hover:text-fg">
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        More details{count > 0 && <span className="count-badge">{count}</span>}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 @[30rem]:grid-cols-2">
            <select value={path.topId ?? ''} onChange={e => set({ categoryId: e.target.value || null })} aria-label="Category" className="select">
              <option value="">No category</option>
              {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={s.categoryId && s.categoryId !== path.topId ? s.categoryId : ''} onChange={e => set({ categoryId: e.target.value || path.topId })}
              disabled={!path.topId} aria-label="Subcategory" className="select disabled:opacity-50">
              <option value="">{path.topId ? 'No subcategory' : 'Subcategory'}</option>
              {subs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input list={listId} value={s.platform} onChange={e => set({ platform: e.target.value })} placeholder="Bought at (store)" aria-label="Bought at" className="input" />
            <datalist id={listId}>{stores.map(x => <option key={x} value={x} />)}</datalist>
            <select value={s.region ?? ''} onChange={e => set({ region: (e.target.value || null) as ShopRegion | null })} aria-label="Bought in" className="select">
              <option value="">Bought anywhere</option><option value="NO">🇳🇴 Norway</option><option value="TR">🇹🇷 Turkey</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-x-4">
            <Toggle checked={s.approx} onChange={approx => set({ approx })}>The days are a guess (≈)</Toggle>
            <Toggle checked={s.used} onChange={used => set({ used })}>Bought used</Toggle>
            <Toggle checked={s.gift} onChange={gift => set({ gift })}>A gift to me</Toggle>
            <Toggle checked={s.forResale} onChange={forResale => set({ forResale })}>Bought to sell later</Toggle>
          </div>
          <textarea value={s.notes} onChange={e => set({ notes: e.target.value })} rows={2} placeholder="Notes" aria-label="Notes" className="input resize-y" />
          <input type="url" inputMode="url" value={s.url} onChange={e => set({ url: e.target.value })} placeholder="Link (https://…)" aria-label="Link" className="input max-w-md" />
          <div>
            <span className="field-label">Accessories bought with it <span className="font-normal normal-case tracking-normal text-fg-faint">(they leave with it)</span></span>
            {s.accessories.length > 0 && (
              <ul className="mb-2 flex flex-col gap-2">
                {s.accessories.map(a => (
                  <li key={a.key} className="flex items-center gap-2">
                    <input value={a.title} onChange={e => setAcc(a.key, { title: e.target.value })} placeholder="Case, dock, grip…" aria-label="Accessory" className="input min-w-0 flex-1" />
                    <DecimalInput value={a.price} onValue={price => setAcc(a.key, { price })} placeholder="0" aria-label={`${a.title || 'Accessory'} price, ${s.currency}`} className="input w-[6.5rem] shrink-0 tabular-nums" />
                    <span className="w-9 shrink-0 text-meta text-fg-muted">{s.currency}</span>
                    <IconButton label={`Remove ${a.title || 'accessory'}`} onClick={() => set({ accessories: s.accessories.filter(x => x.key !== a.key) })}><X /></IconButton>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => set({ accessories: [...s.accessories, { key: newShopId(), title: '', price: null }] })}
              className="btn-ghost btn-sm gap-1"><Plus aria-hidden className="h-4 w-4" /> Accessory</button>
          </div>
        </div>
      )}
    </div>
  )
}
