import { useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { IconButton, cx } from '../../../../shared/ui'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { newShopId } from '../../api/shopApi'
import type { DraftAccessory, DraftStep } from '../../chainDraft'
import { Toggle } from '../record/factKit'
import { CategoryPicker } from '../CategoryPicker'
import { StoreNameField } from '../shopPickers'
import { SUGGESTED, categoryIdOf, isSuggested, pickOf, type CategoryPick } from '../../shopModel'
import { categoryKey, suggestedSubs, suggestedTops } from '../../shopTaxonomy'
import type { SetStep } from './StepFields'
import type { ShopCategory, ShopRegion } from '../../types'

const NEW = '__new__'
/** A name typed after "+ New category…" / "+ New subcategory…"; null where nothing is typed. */
interface Typed { top: string | null; sub: string | null }

/** The typed names a step's category holds (a restored draft): a suggestion's name the taxonomy doesn't offer was typed. */
function typedOf(p: CategoryPick, categories: readonly ShopCategory[]): Typed {
  const name = (v: string) => v.slice(SUGGESTED.length)
  const offered = (names: readonly string[], v: string) => names.some(n => categoryKey(n) === categoryKey(name(v)))
  if (isSuggested(p.topId) && !offered(suggestedTops(categories), p.topId)) return { top: name(p.topId), sub: isSuggested(p.subId) ? name(p.subId) : '' }
  if (isSuggested(p.subId) && !offered(suggestedSubs(categories, p.topId), p.subId)) return { top: null, sub: name(p.subId) }
  return { top: null, sub: null }
}

/**
 * The step's category with "+ New category…", as the add sheet: a typed name rides in the step as a
 * suggestion's name, and Save makes it with the chain (useResolveCategory: one of that name is reused).
 */
function StepCategory({ value, onChange, categories }: { value: string | null; onChange: (id: string | null) => void; categories: readonly ShopCategory[] }) {
  const pick = pickOf(value, categories)
  const [typed, setTyped] = useState<Typed>(() => typedOf(pick, categories))
  function type(t: Typed, topId: string) {
    setTyped(t)
    const sub = t.sub?.trim() ? `${SUGGESTED}${t.sub.trim()}` : ''
    const top = t.top === null ? topId : t.top.trim() ? `${SUGGESTED}${t.top.trim()}` : ''
    onChange(top ? categoryIdOf({ topId: top, subId: sub }) : null)
  }
  const shown: CategoryPick = typed.top !== null ? { topId: NEW, subId: '' } : typed.sub !== null ? { topId: pick.topId, subId: NEW } : pick
  return (
    <>
      <CategoryPicker categories={categories} value={shown} newValue={NEW}
        onChange={p => {
          if (p.topId === NEW) type({ top: '', sub: null }, '')
          else if (p.subId === NEW) type({ top: null, sub: '' }, p.topId)
          else { setTyped({ top: null, sub: null }); onChange(categoryIdOf(p)) }
        }}
        sub={typed.top !== null
          ? <input value={typed.top} onChange={e => type({ ...typed, top: e.target.value }, '')} placeholder="New category" aria-label="New category name" className="input" />
          : undefined} />
      {typed.sub !== null || typed.top !== null ? (
        <input value={typed.sub ?? ''} onChange={e => type({ ...typed, sub: e.target.value }, pick.topId)}
          placeholder={typed.top !== null ? 'Subcategory (optional)' : 'New subcategory'} aria-label="New subcategory name" className="input" />
      ) : null}
    </>
  )
}

/** How many of the folded details are filled — shown on the fold. */
function filled(s: DraftStep): number {
  return [s.categoryId, s.platform.trim(), s.region, s.approx, s.used, s.gift, s.forResale, s.notes.trim(), s.url.trim(), s.accessories.length].filter(Boolean).length
}

/**
 * Everything else the record knows, folded: category, store, country, the
 * yes/no facts, notes, a link and accessories bought with it (same day and
 * currency; they leave with it). Editing a copied fact makes it this step's own.
 */
export function StepMore({ s, set, categories }: {
  s: DraftStep
  set: SetStep
  categories: readonly ShopCategory[]
}) {
  const [open, setOpen] = useState(false)
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
            <StepCategory value={s.categoryId} onChange={categoryId => set({ categoryId })} categories={categories} />
            <StoreNameField label="Bought at" placeholder="Bought at (store)" value={s.platform} onChange={platform => set({ platform })} />
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
            <span className="field-label">Accessories bought with it <span className="font-normal normal-case tracking-normal text-fg-muted">(they leave with it)</span></span>
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
