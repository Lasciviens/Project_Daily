import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../shared/modals'
import { Button, Skeleton } from '../../../shared/ui'
import { useCreateShopCategory, useCreateShopItem, useDeleteShopItems, useShopCategories, useUpdateShopItem } from '../hooks/useShop'
import { useQuietCheck } from '../hooks/useShopPrices'
import { useResolveCategory } from '../hooks/useCategorySuggestions'
import { categoryIdOf, currencyOf, isSuggested, listOf } from '../shopModel'
import { NEW_CATEGORY, ShopItemForm, type ShopDraft } from './ShopItemForm'
import type { ShopCategory, ShopItem, ShopList } from '../types'

export interface ShopItemDefaults { list?: ShopList; title?: string; categoryId?: string; platform?: string; general?: boolean }

function draftOf(item: ShopItem | undefined, defaults: ShopItemDefaults, categories: readonly ShopCategory[]): ShopDraft {
  const cat = categories.find(c => c.id === (item ? item.category_id : defaults.categoryId))
  const topId = cat ? (cat.parent_id ?? cat.id) : ''
  const subId = cat?.parent_id ? cat.id : ''
  return {
    title:       item?.title ?? defaults.title ?? '',
    list:        item ? listOf(item) : defaults.list ?? 'wishlist',
    topId, newTop: '', subId, newSub: '',
    notes:       item?.notes ?? '',
    price:       item?.price ?? null,
    currency:    item ? currencyOf(item) : 'NOK',
    platform:    item?.platform ?? defaults.platform ?? '',
    url:         item?.url ?? '',
    priority:    item?.priority ?? 'medium',
    region:      item?.region ?? '',
    plannedDate: item?.planned_date ?? '',
    status:      item?.status ?? 'wishlist',
    general:     item ? item.kind === 'general' : !!defaults.general,
    priceMin:    item?.price_min ?? null,
    priceMax:    item?.price_max ?? null,
    requirements: item?.requirements ?? '',
    reason:      item?.reason ?? '',
    image:       item?.image_url ?? null,
    facts:       [],
  }
}

interface Props { item?: ShopItem; defaults?: ShopItemDefaults; onClose: () => void }

/**
 * Add a Shop item (both lists) or edit a quick-list row (a wishlist row opens its record). Waits for the categories so the
 * draft is seeded with the row's real category — seeding before they load
 * would save the row back with none.
 */
export function ShopItemSheet(props: Props) {
  const cats = useShopCategories()
  if (!cats.isSuccess) {
    return (
      <ModalShell onClose={props.onClose} title={cats.isError ? "Can't load the categories" : 'Loading…'} size="md">
        {cats.isError
          ? <p className="text-body text-fg-muted">Close this and try again in a moment.</p>
          : <div className="space-y-2"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></div>}
      </ModalShell>
    )
  }
  return <ShopItemEditor {...props} categories={cats.data} />
}

/**
 * Seeded once — a background refetch never overwrites what is being typed.
 * New categories are made as steps of the one save; each step's hook
 * reports its own failure.
 */
function ShopItemEditor({ item, defaults = {}, onClose, categories }: Props & { categories: ShopCategory[] }) {
  const createCategory = useCreateShopCategory()
  const suggested = useResolveCategory()
  const createItem = useCreateShopItem()
  const updateItem = useUpdateShopItem()
  const removeItems = useDeleteShopItems()
  const check = useQuietCheck()
  const [seed] = useState<ShopDraft>(() => draftOf(item, defaults, categories))
  const [draft, setDraft] = useState<ShopDraft>(seed)
  const [saving, setSaving] = useState(false)
  const editing = !!item
  const modal = useEntityModal()
  // A new row that is to be a wish is added in the one body (RecordBody, mode add), with what was typed here.
  function asWish() {
    const top = draft.topId && !isSuggested(draft.topId) && draft.topId !== NEW_CATEGORY ? draft.topId : ''
    const sub = draft.subId && !isSuggested(draft.subId) && draft.subId !== NEW_CATEGORY ? draft.subId : ''
    const categoryId = top ? categoryIdOf({ topId: top, subId: sub }) ?? undefined : undefined
    onClose()
    modal.open({ kind: 'shop-item', defaults: { list: 'wishlist', title: draft.title.trim() || undefined, categoryId, platform: draft.platform.trim() || undefined } })
  }

  async function resolveCategory(): Promise<string | null> {
    // A suggestion picked in the form is made now, with the save (never on the pick).
    if (isSuggested(draft.topId) || isSuggested(draft.subId)) return suggested.resolve({ topId: draft.topId, subId: draft.subId }, categories)
    let topId = draft.topId
    if (topId === NEW_CATEGORY) {
      const name = draft.newTop.trim()
      if (!name) return null
      topId = (await createCategory.mutateAsync({ name })).id
    }
    if (!topId) return null
    if (draft.subId === NEW_CATEGORY || (draft.topId === NEW_CATEGORY && draft.newSub.trim())) {
      const name = draft.newSub.trim()
      if (!name) return topId
      return (await createCategory.mutateAsync({ name, parent_id: topId })).id
    }
    return draft.subId || topId
  }

  async function save() {
    const title = draft.title.trim()
    if (!title) return
    setSaving(true)
    try {
      const categoryId = await resolveCategory()
      const fields = {
        title,
        list:         draft.list,
        category_id:  categoryId,
        notes:        draft.notes.trim() || null,
        price:        draft.price,
        currency:     draft.price != null ? draft.currency : null,
        platform:     draft.platform.trim() || null,
        url:          draft.url.trim() || null,
        priority:     draft.priority,
        region:       draft.region || null,
        planned_date: draft.plannedDate || null,
      }
      if (item) {
        // The category is written only when its controls changed: a category
        // made on another device and not loaded here yet seeds as "No
        // category", and saving a typo fix must not clear it.
        const categoryTouched = draft.topId !== seed.topId || draft.subId !== seed.subId
        const rest: Partial<typeof fields> = { ...fields }
        delete rest.category_id
        await updateItem.mutateAsync({
          id: item.id,
          quiet: true,
          patch: {
            ...(categoryTouched ? fields : rest),
            // A price edited by hand is the owner's own, never an AI estimate any more.
            ...(draft.price !== item.price ? { price_source: draft.price != null ? 'manual' : null } : {}),
          },
        })
      } else {
        // A new row here is an errand (a wish is added in the one body): what, where, a note.
        const row = await createItem.mutateAsync({ input: { ...fields, currency: draft.price != null ? draft.currency : null } })
        if (row.url && row.list !== 'quick') check([row.id])
      }
      onClose()
    } catch {
      return
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!item) return
    const r = await removeItems.run(item)
    if (r === 'deleted' || r === 'gone') onClose()
  }

  const newTopMissing = draft.topId === NEW_CATEGORY && !draft.newTop.trim()
  const newSubMissing = draft.subId === NEW_CATEGORY && !draft.newSub.trim()

  return (
    <ModalShell
      onClose={onClose}
      title={editing ? 'Edit item' : 'Add to the quick list'}
      size="md"
      dismissible={!saving}
      footer={
        <div className="flex items-center gap-2">
          {editing && (
            <Button variant="ghost" icon={<Trash2 />} onClick={remove} disabled={saving} className="text-danger">Delete</Button>
          )}
          <Button onClick={onClose} disabled={saving} className="ml-auto">Cancel</Button>
          <Button variant="primary" onClick={() => { void save() }} loading={saving} disabled={!draft.title.trim() || newTopMissing || newSubMissing}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </div>
      }
    >
      <ShopItemForm
        draft={draft}
        onChange={patch => setDraft(d => ({ ...d, ...patch }))}
        categories={categories}
        editing={editing}
        onWish={asWish}
      />
    </ModalShell>
  )
}
