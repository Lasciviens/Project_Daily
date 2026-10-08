import { useMemo } from 'react'
import { ArrowRight, Ban, CalendarPlus, Check, HandCoins, ListPlus, Plus, Trash2, Undo2 } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, TonePill, type Tone } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { toast } from '../../../../app/store'
import { useBuyNow, useDeleteShopItems, useShopCategories, useShopItems, useUpdateShopItem } from '../../hooks/useShop'
import { useFillRatesNow, useShopLinks, useShopMoney, useUndoSale } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { categoryPath, planDefaults, storeNames } from '../../shopModel'
import { boughtOn, DISPOSAL_LABEL, durationLabel, isPossession } from '../../ownModel'
import { chainFor } from '../../chainModel'
import { ItemThumb } from '../shopKit'
import { imageOf } from '../shopFormat'
import { RecordFacts } from './RecordFacts'
import { recordState } from './recordState'
import { RecordStrip } from './RecordStrip'
import { RecordPriceWatch } from './RecordPriceWatch'
import { RecordAccessories } from './RecordAccessories'
import { RecordMoney } from './RecordMoney'
import { RecordCosts } from './RecordCosts'
import { RecordModels } from './RecordModels'
import { patchOf, useRecordDraft } from './useRecordDraft'
import type { ShopItem } from '../../types'

const STATE_PILL: Record<string, { label: string; tone: Tone }> = {
  buy: { label: 'To buy', tone: 'info' }, general: { label: 'A wish · any model', tone: 'info' }, mine: { label: 'Mine', tone: 'success' },
  gone: { label: 'Sold or gone', tone: 'neutral' }, returned: { label: 'Returned', tone: 'neutral' }, dropped: { label: 'Not any more', tone: 'neutral' },
  fulfilled: { label: 'Fulfilled', tone: 'success' }, notKept: { label: 'Not mine to keep', tone: 'neutral' },
}

/**
 * A wishlist-side row as a record (xl): what it is, four numbers for where it
 * is in its life, the facts (tap to edit, Save only when something changed),
 * and its price watch, models, accessories, money links and extra costs.
 */
export function ShopRecord({ item, onClose }: { item: ShopItem; onClose: () => void }) {
  const modal = useEntityModal()
  const today = todayStr()
  const { data: items = [] } = useShopItems()
  const { data: categories = [] } = useShopCategories()
  const { ctx, costs } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const watches = useWatchMap()
  const update = useUpdateShopItem()
  const remove = useDeleteShopItems()
  const undoSale = useUndoSale()
  const fillNow = useFillRatesNow()
  const buy = useBuyNow()
  const d = useRecordDraft(item)
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
  const parent = item.accessory_of ? items.find(i => i.id === item.accessory_of) : item.option_for ? items.find(i => i.id === item.option_for) : null
  const pillKey = item.status === 'dropped' ? 'dropped' : item.status === 'fulfilled' ? 'fulfilled' : item.disposal === 'returned' ? 'returned' : item.status === 'bought' && item.kept === false ? 'notKept' : state
  const pill = STATE_PILL[pillKey] ?? STATE_PILL.buy
  const path = categoryPath(item.category_id, categories)

  async function save(): Promise<boolean> {
    if (!d.dirty) return true
    const patch = patchOf(item, d.draft)
    try {
      await update.mutateAsync({ id: item.id, patch, quiet: true })
    } catch { return false }
    toast.success('Saved')
    d.discard()
    if ('currency' in patch || 'bought_at' in patch || 'fx_nok' in patch || 'sale_currency' in patch || 'disposed_on' in patch || 'price' in patch) fillNow()
    return true
  }
  const then = (fn: () => void) => async () => { if (await save()) fn() }

  async function close() {
    if (d.dirty && !(await modal.confirm({ title: 'Discard your changes?', message: 'They are not saved yet.', confirmLabel: 'Discard', destructive: true }))) return
    onClose()
  }

  function plan() {
    modal.open({
      kind: 'task', config: { heading: 'Plan this purchase' },
      defaults: { ...planDefaults(item), domain: 'personal' },
      onSaved: r => { if (r.taskId) update.mutate({ id: item.id, patch: { task_id: r.taskId }, quiet: true }) },
    })
  }

  const actions = (
    <div className="flex flex-wrap gap-1.5">
      {state === 'buy' && <>
        <Button size="sm" variant="primary" icon={<Check />} onClick={then(() => buy(item))}>Bought</Button>
        {item.task_id
          ? <Button size="sm" icon={<ArrowRight />} onClick={() => modal.open({ kind: 'task', id: item.task_id as string })}>Open the task</Button>
          : <Button size="sm" icon={<CalendarPlus />} onClick={then(plan)}>Plan it</Button>}
        {!item.option_for && !item.accessory_of && <Button size="sm" variant="ghost" icon={<ListPlus />} onClick={then(() => update.mutate({ id: item.id, patch: { errand: !item.errand }, quiet: true }))}>{item.errand ? 'Off the errand list' : 'On the next errand'}</Button>}
        <Button size="sm" variant="ghost" icon={<Ban />} onClick={then(() => update.mutate({ id: item.id, patch: { status: 'dropped' } }))}>{item.option_for ? 'Not chosen' : 'Not any more'}</Button>
      </>}
      {state === 'general' && item.status === 'wishlist' && <>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={() => modal.open({ kind: 'shop-model', wishId: item.id })}>Add a model</Button>
        <Button size="sm" variant="ghost" icon={<Ban />} onClick={then(() => update.mutate({ id: item.id, patch: { status: 'dropped' } }))}>Not any more</Button>
      </>}
      {state === 'mine' && <>
        <Button size="sm" variant="primary" icon={<HandCoins />} onClick={then(() => modal.open({ kind: 'shop-sell', id: item.id }))}>Sell or give away</Button>
        {!item.accessory_of && <Button size="sm" icon={<Plus />} onClick={() => modal.open({ kind: 'shop-accessory', itemId: item.id })}>Accessory</Button>}
      </>}
      {(state === 'gone' || item.disposal === 'returned') && (
        <Button size="sm" icon={<Undo2 />} onClick={() => undoSale.mutate(item.id)}>Undo: still mine</Button>
      )}
      {item.status === 'dropped' && (
        <Button size="sm" icon={<Undo2 />} onClick={() => update.mutate({ id: item.id, patch: { status: 'wishlist' } })}>Back on the wishlist</Button>
      )}
    </div>
  )

  return (
    <ModalShell
      onClose={() => { void close() }}
      title={item.title}
      subtitle={[path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : null, item.disposal ? `${DISPOSAL_LABEL[item.disposal]}` : null].filter(Boolean).join(' · ') || undefined}
      headerActions={<TonePill tone={pill.tone} className="shrink-0 max-sm:hidden">{pill.label}</TonePill>}
      size="xl"
      mobile="fullscreen"
      dismissible={!update.isPending}
      footer={d.dirty ? (
        <div className="flex items-center gap-2">
          <span className="text-meta text-fg-muted">Unsaved changes</span>
          <Button onClick={d.discard} className="ml-auto">Discard</Button>
          <Button variant="primary" onClick={() => { void save() }} loading={update.isPending}>Save</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<Trash2 />} className="text-danger"
            onClick={() => { remove.mutate({ ids: [item.id, ...accessories.filter(a => a.status === 'bought').map(a => a.id)], label: item.title }); onClose() }}>Delete</Button>
          <Button onClick={onClose} className="ml-auto">Close</Button>
        </div>
      )}
    >
      <div className="@container flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <ItemThumb src={imageOf(item, watches.get(item.id))} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <TonePill tone={pill.tone} className="w-fit sm:hidden">{pill.label}</TonePill>
            {parent && (
              <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: parent.id })} className="w-fit text-left text-meta text-fg-muted hover:text-fg-2">
                {item.accessory_of ? 'Accessory of' : 'A model of'} <span className="font-semibold text-accent-600 hover:underline">{parent.title}</span>
              </button>
            )}
            {state === 'mine' && boughtOn(item) && (
              <p className="text-meta tabular-nums text-fg-muted">
                Yours for {durationLabel(boughtOn(item) as string, today)} · since {item.approx_dates ? '≈ ' : ''}{formatDate(boughtOn(item))}
              </p>
            )}
            {actions}
          </div>
        </div>
        <RecordStrip item={item} state={state} ctx={ctx} chain={chain} watch={watches.get(item.id) ?? null} models={models} watches={watches} accessories={accessories} today={today} />
        <div className="grid items-start gap-3 @[46rem]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <RecordFacts item={item} d={d} state={state} categories={categories} stores={stores} watch={watches.get(item.id) ?? null} today={today} parents={parents} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {state === 'general' && <RecordModels wish={item} models={models} watches={watches} />}
            <RecordPriceWatch item={item} watch={watches.get(item.id) ?? null} owned={owned} today={today} />
            {!item.accessory_of && state !== 'general' && <RecordAccessories item={item} accessories={accessories} ctx={ctx} canAdd={state === 'mine'} />}
            <RecordMoney item={item} items={items} links={links} ctx={ctx} chain={chain} />
            {(owned || item.status === 'bought') && <RecordCosts itemId={item.id} costs={ctx.costs.get(item.id) ?? costs.filter(c => c.item_id === item.id)} />}
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
