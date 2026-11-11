import { useMemo, type ReactNode } from 'react'
import { ArrowRight, Ban, CalendarPlus, Check, HandCoins, ListPlus, Plus, Undo2 } from 'lucide-react'
import { useEntityModal } from '../../../../shared/modals'
import type { Tone } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { toast } from '../../../../app/store'
import { useBuyNow, useDeleteShopItems, useShopCategories, useShopItems, useUpdateShopItem } from '../../hooks/useShop'
import { useFillRatesNow, useShopLinks, useShopMoney, useUndoSale } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { useResolveCategory } from '../../hooks/useCategorySuggestions'
import { categoryPath, planDefaults, storeNames } from '../../shopModel'
import { DISPOSAL_LABEL, isPossession } from '../../ownModel'
import { chainFor } from '../../chainModel'
import { recordState } from './recordState'
import { patchOf, useRecordDraft } from './useRecordDraft'
import type { ShopItem } from '../../types'

/** One of the record's actions; `more` ones sit behind ⋯ where the record is narrow (a phone, the side pane). */
export interface RecordAction { key: string; label: string; icon: ReactNode; onClick: () => void; primary?: boolean; ghost?: boolean; more?: boolean }

const STATE_PILL: Record<string, { label: string; tone: Tone }> = {
  buy: { label: 'To buy', tone: 'info' }, general: { label: 'A wish · any model', tone: 'info' }, mine: { label: 'Mine', tone: 'success' },
  gone: { label: 'Sold or gone', tone: 'neutral' }, returned: { label: 'Returned', tone: 'neutral' }, dropped: { label: 'Not any more', tone: 'neutral' },
  fulfilled: { label: 'Fulfilled', tone: 'success' }, notKept: { label: 'Not mine to keep', tone: 'neutral' },
}

/**
 * A record's state and behaviour, the same in the popup (phones, the
 * Wishlist) and in Owned's side pane: the live row's neighbours (its chain,
 * accessories, models, the things it can belong to), the draft of its facts
 * (Save only when something changed; closing with changes asks first), and
 * its one row of actions.
 */
export function useShopRecord(item: ShopItem, openFact: 'value' | undefined, onClose: () => void) {
  const modal = useEntityModal()
  const today = todayStr()
  const { data: items = [] } = useShopItems()
  const { data: categories = [] } = useShopCategories()
  const { ctx, costs } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const watches = useWatchMap()
  const update = useUpdateShopItem()
  const suggested = useResolveCategory()
  const remove = useDeleteShopItems()
  const undoSale = useUndoSale()
  const fillNow = useFillRatesNow()
  const buy = useBuyNow()
  const d = useRecordDraft(item, openFact ?? null)
  const state = recordState(item)
  const owned = state === 'mine' || state === 'gone'
  const stores = useMemo(() => storeNames(items), [items])
  const chain = useMemo(() => (owned || (state === 'other' && item.status === 'bought') ? chainFor(item.id, items, links, ctx) : null), [owned, state, item, items, links, ctx])
  const accessories = useMemo(() => items.filter(i => i.accessory_of === item.id), [items, item.id])
  const models = useMemo(() => (state === 'general' ? items.filter(i => i.option_for === item.id) : []), [state, items, item.id])
  // It can move under another thing unless it has accessories or money links of its own (one level; a link never starts at an accessory).
  const parents = useMemo(() => (owned && item.kind !== 'general' && !accessories.length && !links.some(l => l.from_id === item.id || l.to_id === item.id)
    ? items.filter(c => isPossession(c) && !c.accessory_of && c.id !== item.id).sort((a, b) => a.title.localeCompare(b.title))
    : undefined), [owned, item, accessories.length, links, items])
  const parent = item.accessory_of ? items.find(i => i.id === item.accessory_of) ?? null : item.option_for ? items.find(i => i.id === item.option_for) ?? null : null
  const pillKey = item.status === 'dropped' ? 'dropped' : item.status === 'fulfilled' ? 'fulfilled' : item.disposal === 'returned' ? 'returned' : item.status === 'bought' && item.kept === false ? 'notKept' : state
  const pill = STATE_PILL[pillKey] ?? STATE_PILL.buy
  const path = categoryPath(item.category_id, categories)
  const subtitle = [path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : null, item.disposal ? DISPOSAL_LABEL[item.disposal] : null].filter(Boolean).join(' · ') || undefined

  async function save(): Promise<boolean> {
    if (!d.dirty) return true
    const patch = patchOf(item, d.draft)
    try {
      // A suggested category picked in the record is made now, with the save.
      if (patch.category_id !== undefined) patch.category_id = await suggested.resolve(patch.category_id, categories)
      await update.mutateAsync({ id: item.id, patch, quiet: true })
    } catch { return false }
    toast.success('Saved')
    d.discard()
    if ('currency' in patch || 'bought_at' in patch || 'fx_nok' in patch || 'sale_currency' in patch || 'disposed_on' in patch || 'price' in patch) fillNow()
    return true
  }
  const then = (fn: () => void) => async () => { if (await save()) fn() }

  /** Close, asking first when there are changes; false when the owner kept them. */
  async function close(): Promise<boolean> {
    if (d.dirty && !(await modal.confirm({ title: 'Discard your changes?', message: 'They are not saved yet.', confirmLabel: 'Discard', destructive: true }))) return false
    onClose()
    return true
  }

  async function del() {
    const r = await remove.run(item)
    if (r === 'deleted' || r === 'gone') onClose()
  }

  function plan() {
    modal.open({
      kind: 'task', config: { heading: 'Plan this purchase' },
      defaults: { ...planDefaults(item), domain: 'personal' },
      onSaved: r => { if (r.taskId) update.mutate({ id: item.id, patch: { task_id: r.taskId }, quiet: true }) },
    })
  }

  // One row of actions. Where the record is narrow it keeps one line: the first ones as buttons, the rest behind ⋯.
  const actions: RecordAction[] = []
  if (state === 'buy') {
    actions.push({ key: 'bought', label: 'Bought', icon: <Check />, primary: true, onClick: then(() => buy(item)) })
    actions.push(item.task_id
      ? { key: 'task', label: 'Open the task', icon: <ArrowRight />, onClick: () => modal.open({ kind: 'task', id: item.task_id as string }) }
      : { key: 'plan', label: 'Plan it', icon: <CalendarPlus />, onClick: then(plan) })
    if (!item.option_for && !item.accessory_of) {
      actions.push({ key: 'errand', label: item.errand ? 'Off the errand list' : 'On the next errand', icon: <ListPlus />, ghost: true, more: true,
        onClick: then(() => update.mutate({ id: item.id, patch: { errand: !item.errand }, quiet: true })) })
    }
    actions.push({ key: 'drop', label: item.option_for ? 'Not chosen' : 'Not any more', icon: <Ban />, ghost: true, more: true, onClick: then(() => update.mutate({ id: item.id, patch: { status: 'dropped' } })) })
  }
  if (state === 'general' && item.status === 'wishlist') {
    actions.push({ key: 'model', label: 'Add a model', icon: <Plus />, primary: true, onClick: () => modal.open({ kind: 'shop-model', wishId: item.id }) })
    actions.push({ key: 'drop', label: 'Not any more', icon: <Ban />, ghost: true, more: true, onClick: then(() => update.mutate({ id: item.id, patch: { status: 'dropped' } })) })
  }
  if (state === 'mine') {
    actions.push({ key: 'sell', label: 'Sell or give away', icon: <HandCoins />, primary: true, onClick: then(() => modal.open({ kind: 'shop-sell', id: item.id })) })
    if (!item.accessory_of) actions.push({ key: 'acc', label: 'Accessory', icon: <Plus />, onClick: () => modal.open({ kind: 'shop-accessory', itemId: item.id }) })
  }
  if (state === 'gone' || item.disposal === 'returned') actions.push({ key: 'undo', label: 'Undo: still mine', icon: <Undo2 />, onClick: () => undoSale.mutate(item.id) })
  if (item.status === 'dropped') actions.push({ key: 'back', label: 'Back on the wishlist', icon: <Undo2 />, onClick: () => update.mutate({ id: item.id, patch: { status: 'wishlist' } }) })

  return {
    item, today, items, categories, ctx, costs, links, watches, stores, d, state, owned, chain, accessories, models, parents, parent,
    pill, subtitle, actions, save, close, del, saving: update.isPending, buy: () => buy(item),
  }
}

export type ShopRecordModel = ReturnType<typeof useShopRecord>
