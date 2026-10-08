import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ListChecks, Plus, RotateCcw, X } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, PageBoard, Skeleton, Truncate, cx } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useCreateShopItem, useDeleteShopItems, useUpdateShopItem } from '../hooks/useShop'
import { buyAgain, groupByStore, pickedUpOn, quickOpen, storeNames } from '../shopModel'
import { QUICK_BOARD } from '../shopBoard'
import type { ShopItem } from '../types'

/** The quick list: errands and groceries, by store, ticked off as you go. */
export function QuickListView({ items, isLoading }: { items: ShopItem[]; isLoading: boolean }) {
  const today = todayStr()
  const open = useMemo(() => quickOpen(items), [items])
  const stores = useMemo(() => groupByStore(open), [open])
  const picked = useMemo(() => pickedUpOn(items, today), [items, today])
  const again = useMemo(() => buyAgain(items), [items])
  const storeList = useMemo(() => storeNames(items), [items])

  const list = isLoading ? (
    <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
  ) : open.length === 0 && picked.length === 0 ? (
    <EmptyState bordered className="max-w-md" icon={<ListChecks />} title="Nothing to pick up"
      description="Type what you need above — milk, batteries, a birthday card. Tick it off in the shop." />
  ) : (
    <div className="flex flex-col gap-4">
      {open.length === 0 && <p className="text-body text-fg-muted">Everything is picked up.</p>}
      {/* Stores A–Z read down each column (THEME W2), so a long store never leaves a hole beside it. */}
      <div className="@container">
        <div className="gap-4 @[40rem]:columns-2 @[72rem]:columns-3">
          {stores.map(store => (
            <Card key={store.key} padded={false} className="mb-4 break-inside-avoid">
              {store.title && (
                <div className="flex items-baseline gap-2 border-b border-line px-3.5 py-2">
                  <h2 className="text-ui font-semibold text-fg">{store.title}</h2>
                  <span className="count-badge">{store.items.length}</span>
                </div>
              )}
              <ul className="divide-y divide-line">
                {store.items.map(item => <QuickRow key={item.id} item={item} />)}
              </ul>
            </Card>
          ))}
        </div>
      </div>
      {picked.length > 0 && <PickedUp items={picked} />}
    </div>
  )

  return (
    <PageBoard
      layout={QUICK_BOARD}
      stackGap="gap-4"
      sections={{
        add: <QuickAdd stores={storeList} />,
        again: again.length > 0 && <BuyAgain rows={again} />,
        list,
      }}
    />
  )
}

/** Always visible; only the item clears after Add, so a run of things for one store goes in quickly. */
function QuickAdd({ stores }: { stores: readonly string[] }) {
  const id = useId()
  const create = useCreateShopItem()
  const [title, setTitle] = useState('')
  const [store, setStore] = useState('')
  const input = useRef<HTMLInputElement>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    create.mutate(
      { input: { title: t, platform: store.trim() || null, list: 'quick' }, quiet: true },
      { onSuccess: () => { setTitle(''); input.current?.focus() } },
    )
  }

  return (
    <Card>
      <form onSubmit={submit} className="@container flex flex-col gap-2">
        <label htmlFor={`${id}-title`} className="field-label">Add to the quick list</label>
        <div className="flex max-w-md gap-2">
          <input ref={input} id={`${id}-title`} value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Milk, batteries, a gift card…" className="input min-w-0 flex-1" enterKeyHint="done" />
          <Button type="submit" variant="primary" icon={<Plus />} loading={create.isPending} disabled={!title.trim()} aria-label="Add">
            <span className="max-sm:hidden">Add</span>
          </Button>
        </div>
        <input list={`${id}-stores`} value={store} onChange={e => setStore(e.target.value)} aria-label="Store (optional)"
          placeholder="Store (optional)" title="Kept for the next item, so a run for one shop goes in quickly" className="input max-w-md" />
        <datalist id={`${id}-stores`}>{stores.map(s => <option key={s} value={s} />)}</datalist>
      </form>
    </Card>
  )
}

function QuickRow({ item }: { item: ShopItem }) {
  const modal = useEntityModal()
  const update = useUpdateShopItem()
  const remove = useDeleteShopItems()
  return (
    <li className="flex items-center gap-1 pr-1">
      <button type="button" onClick={() => update.mutate({ id: item.id, patch: { status: 'bought' }, quiet: true })}
        aria-label={`Picked up ${item.title}`} title="Picked up"
        className="group grid h-11 w-11 shrink-0 place-items-center rounded-control">
        <span className="h-5 w-5 rounded-[6px] border-2 border-line-strong transition-colors group-hover:border-success" />
      </button>
      <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: item.id })} className="min-h-[44px] min-w-0 flex-1 py-1.5 text-left">
        <Truncate as="span" className="block text-body font-medium leading-snug text-fg">{item.title}</Truncate>
        {item.notes && <Truncate as="span" className="block text-meta text-fg-muted">{item.notes}</Truncate>}
      </button>
      <button type="button" onClick={() => remove.mutate({ ids: [item.id], label: item.title })} aria-label={`Delete ${item.title}`}
        className="icon-btn shrink-0 text-fg-faint hover:!text-danger">
        <X aria-hidden className="h-4 w-4" />
      </button>
    </li>
  )
}

/** Ticked off today — kept in sight so a mis-tap is one tap to undo. */
function PickedUp({ items }: { items: ShopItem[] }) {
  const update = useUpdateShopItem()
  const [open, setOpen] = useState(false)
  return (
    <section className="max-w-2xl">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] items-center gap-1.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg-2">
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        Picked up today <span className="count-badge">{items.length}</span>
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-line rounded-card border border-line bg-surface">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-1 pr-1">
              <button type="button" onClick={() => update.mutate({ id: item.id, patch: { status: 'wishlist' }, quiet: true })}
                aria-label={`Not picked up: ${item.title}`} title="Not picked up after all"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-success">
                <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-success text-surface"><Check aria-hidden className="h-3.5 w-3.5" /></span>
              </button>
              <Truncate as="span" className="min-w-0 flex-1 text-body text-fg-muted line-through">{item.title}</Truncate>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Things bought from this list before — one tap adds a fresh row (the old
 * ones stay as the record of earlier purchases, which is what ×N counts).
 */
function BuyAgain({ rows }: { rows: ReturnType<typeof buyAgain> }) {
  const create = useCreateShopItem()
  return (
    <Card>
      <CardHeader title="Buy again" />
      <div className="flex flex-wrap gap-1.5">
        {rows.map(r => (
          <button key={r.row.id} type="button"
            onClick={() => create.mutate({ input: { title: r.title, platform: r.row.platform, category_id: r.row.category_id, list: 'quick' }, quiet: true })}
            title={`Put ${r.title} back on the quick list`}
            className="chip min-h-[44px] max-w-full gap-1 hover:bg-surface-hover">
            <RotateCcw aria-hidden className="h-3 w-3 shrink-0 text-fg-faint" />
            <Truncate as="span" className="min-w-0">{r.title}</Truncate>
            {r.count > 1 && <span className="shrink-0 text-fg-faint tabular-nums">×{r.count}</span>}
          </button>
        ))}
      </div>
    </Card>
  )
}
