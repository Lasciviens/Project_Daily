import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Skeleton } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { middayIso } from '../../media/watchedWhen'
import { useCreateShopCategory, useCreateShopItem, useDeleteShopItems, useShopCategories, useShopItems, useUpdateShopItem } from '../hooks/useShop'
import { currencyOf, listOf, localDay, storeNames } from '../shopModel'
import { NEW_CATEGORY, ShopItemForm, type ShopDraft } from './ShopItemForm'
import type { ShopCategory, ShopItem, ShopList } from '../types'

export interface ShopItemDefaults { list?: ShopList; title?: string; categoryId?: string; platform?: string }

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
    boughtDay:   item?.status === 'bought' ? localDay(item.bought_at ?? item.updated_at) : todayStr(),
  }
}

interface Props { item?: ShopItem; defaults?: ShopItemDefaults; onClose: () => void }

/**
 * Add or edit one Shop item (both lists). Waits for the categories so the
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
  const { data: items = [] } = useShopItems()
  const createCategory = useCreateShopCategory()
  const createItem = useCreateShopItem()
  const updateItem = useUpdateShopItem()
  const removeItems = useDeleteShopItems()
  const [seed] = useState<ShopDraft>(() => draftOf(item, defaults, categories))
  const [draft, setDraft] = useState<ShopDraft>(seed)
  const [saving, setSaving] = useState(false)
  const stores = useMemo(() => storeNames(items), [items])
  const editing = !!item

  async function resolveCategory(): Promise<string | null> {
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
        const statusChanged = draft.status !== item.status
        const dayChanged = draft.status === 'bought' && draft.boughtDay && draft.boughtDay !== localDay(item.bought_at ?? item.updated_at)
        await updateItem.mutateAsync({
          id: item.id,
          quiet: true,
          patch: {
            ...(categoryTouched ? fields : rest),
            // A price edited by hand is the owner's own, never an AI estimate any more.
            ...(draft.price !== item.price ? { price_source: draft.price != null ? 'manual' : null } : {}),
            ...(statusChanged ? { status: draft.status } : {}),
            ...(draft.status === 'bought' && (statusChanged || dayChanged) && draft.boughtDay ? { bought_at: middayIso(draft.boughtDay) } : {}),
          },
        })
      } else {
        await createItem.mutateAsync({ input: { ...fields, currency: draft.price != null ? draft.currency : null } })
      }
      onClose()
    } catch {
      return
    } finally {
      setSaving(false)
    }
  }

  function remove() {
    if (!item) return
    removeItems.mutate({ ids: [item.id], label: item.title })
    onClose()
  }

  const newTopMissing = draft.topId === NEW_CATEGORY && !draft.newTop.trim()
  const newSubMissing = draft.subId === NEW_CATEGORY && !draft.newSub.trim()

  return (
    <ModalShell
      onClose={onClose}
      title={editing ? 'Edit item' : draft.list === 'quick' ? 'Add to the quick list' : 'Add to the wishlist'}
      size="md"
      dismissible={!saving}
      footer={
        <div className="flex items-center gap-2">
          {editing && (
            <Button variant="ghost" icon={<Trash2 />} onClick={remove} disabled={saving} className="text-danger">Delete</Button>
          )}
          <Button onClick={onClose} disabled={saving} className="ml-auto">Cancel</Button>
          <Button variant="primary" onClick={() => { void save() }} loading={saving} disabled={!draft.title.trim() || newTopMissing || newSubMissing}>
            {editing ? 'Save' : 'Add item'}
          </Button>
        </div>
      }
    >
      <ShopItemForm
        draft={draft}
        onChange={patch => setDraft(d => ({ ...d, ...patch }))}
        categories={categories}
        stores={stores}
        editing={editing}
      />
    </ModalShell>
  )
}
