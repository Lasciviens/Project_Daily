import { useMemo, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowRight, Ban, CalendarPlus, Check, HandCoins, ListPlus, MoreHorizontal, Plus, Trash2, Undo2 } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, TonePill, type Tone } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { toast } from '../../../../app/store'
import { useBuyNow, useDeleteShopItems, useShopCategories, useShopItems, useUpdateShopItem } from '../../hooks/useShop'
import { useFillRatesNow, useShopLinks, useShopMoney, useUndoSale } from '../../hooks/useShopMoney'
import { useWatchMap } from '../../hooks/useShopPrices'
import { useResolveCategory } from '../../hooks/useCategorySuggestions'
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
import { RecordPurchase } from '../purchase/RecordPurchase'
import { LookElsewhere } from '../purchase/LookElsewhere'
import { patchOf, useRecordDraft } from './useRecordDraft'
import type { ShopItem } from '../../types'

/** One of the record's actions; `more` ones sit behind ⋯ on a phone. */
interface RecordAction { key: string; label: string; icon: ReactNode; onClick: () => void; primary?: boolean; ghost?: boolean; more?: boolean }

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
export function ShopRecord({ item, openFact, onClose }: { item: ShopItem; openFact?: 'value'; onClose: () => void }) {
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
  const buy = useBuyNow(id => modal.open({ kind: 'shop-just-bought', id }), { thenDetails: true })
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
  const parent = item.accessory_of ? items.find(i => i.id === item.accessory_of) : item.option_for ? items.find(i => i.id === item.option_for) : null
  const pillKey = item.status === 'dropped' ? 'dropped' : item.status === 'fulfilled' ? 'fulfilled' : item.disposal === 'returned' ? 'returned' : item.status === 'bought' && item.kept === false ? 'notKept' : state
  const pill = STATE_PILL[pillKey] ?? STATE_PILL.buy
  const path = categoryPath(item.category_id, categories)

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

  // One row of actions. On a phone it keeps one line: the first ones as buttons, the rest behind ⋯.
  const list: RecordAction[] = []
  if (state === 'buy') {
    list.push({ key: 'bought', label: 'Bought', icon: <Check />, primary: true, onClick: then(() => buy(item)) })
    list.push(item.task_id
      ? { key: 'task', label: 'Open the task', icon: <ArrowRight />, onClick: () => modal.open({ kind: 'task', id: item.task_id as string }) }
      : { key: 'plan', label: 'Plan it', icon: <CalendarPlus />, onClick: then(plan) })
    if (!item.option_for && !item.accessory_of) {
      list.push({ key: 'errand', label: item.errand ? 'Off the errand list' : 'On the next errand', icon: <ListPlus />, ghost: true, more: true,
        onClick: then(() => update.mutate({ id: item.id, patch: { errand: !item.errand }, quiet: true })) })
    }
    list.push({ key: 'drop', label: item.option_for ? 'Not chosen' : 'Not any more', icon: <Ban />, ghost: true, more: true, onClick: then(() => update.mutate({ id: item.id, patch: { status: 'dropped' } })) })
  }
  if (state === 'general' && item.status === 'wishlist') {
    list.push({ key: 'model', label: 'Add a model', icon: <Plus />, primary: true, onClick: () => modal.open({ kind: 'shop-model', wishId: item.id }) })
    list.push({ key: 'drop', label: 'Not any more', icon: <Ban />, ghost: true, more: true, onClick: then(() => update.mutate({ id: item.id, patch: { status: 'dropped' } })) })
  }
  if (state === 'mine') {
    list.push({ key: 'sell', label: 'Sell or give away', icon: <HandCoins />, primary: true, onClick: then(() => modal.open({ kind: 'shop-sell', id: item.id })) })
    if (!item.accessory_of) list.push({ key: 'acc', label: 'Accessory', icon: <Plus />, onClick: () => modal.open({ kind: 'shop-accessory', itemId: item.id }) })
  }
  if (state === 'gone' || item.disposal === 'returned') list.push({ key: 'undo', label: 'Undo: still mine', icon: <Undo2 />, onClick: () => undoSale.mutate(item.id) })
  if (item.status === 'dropped') list.push({ key: 'back', label: 'Back on the wishlist', icon: <Undo2 />, onClick: () => update.mutate({ id: item.id, patch: { status: 'wishlist' } }) })
  const more = list.filter(a => a.more)
  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map(a => (
        <Button key={a.key} size="sm" variant={a.primary ? 'primary' : a.ghost ? 'ghost' : 'secondary'} icon={a.icon} onClick={a.onClick} className={a.more ? 'max-sm:hidden' : undefined}>
          {a.label}
        </Button>
      ))}
      {more.length > 0 && (
        <Menu as="div" className="sm:hidden">
          <MenuButton className="icon-btn icon-btn-bordered" aria-label="More actions" title="More actions">
            <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
          </MenuButton>
          <MenuItems anchor={{ to: 'bottom end', gap: 4, padding: 12 }} className="menu z-toast w-56">
            {more.map(a => (
              <MenuItem key={a.key}>
                <button type="button" onClick={a.onClick} className="menu-item"><span aria-hidden className="[&_svg]:h-4 [&_svg]:w-4">{a.icon}</span> {a.label}</button>
              </MenuItem>
            ))}
          </MenuItems>
        </Menu>
      )}
    </div>
  )
  const picture = imageOf(item, watches.get(item.id))

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
            onClick={async () => { const r = await remove.run(item); if (r === 'deleted' || r === 'gone') onClose() }}>Delete</Button>
          <Button onClick={onClose} className="ml-auto">Close</Button>
        </div>
      )}
    >
      <div className="@container flex flex-col gap-3">
        <div className="flex items-start gap-3">
          {/* Only a real picture: an empty box took 80px beside the actions. Smaller on a phone. */}
          {picture && <ItemThumb src={picture} size="lg" className="max-sm:h-12 max-sm:w-12" />}
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
            {state === 'mine' && <RecordPurchase item={item} today={today} />}
            <RecordPriceWatch item={item} watch={watches.get(item.id) ?? null} owned={owned} today={today} />
            {state === 'buy' && <LookElsewhere item={item} today={today} />}
            {!item.accessory_of && state !== 'general' && <RecordAccessories item={item} accessories={accessories} ctx={ctx} canAdd={state === 'mine'} />}
            <RecordMoney item={item} items={items} links={links} ctx={ctx} chain={chain} />
            {(owned || item.status === 'bought') && <RecordCosts itemId={item.id} costs={ctx.costs.get(item.id) ?? costs.filter(c => c.item_id === item.id)} />}
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
