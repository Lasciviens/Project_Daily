import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SideDrawer } from '../../../../shared/modals/SideDrawer'
import { SegmentedControl, Skeleton, cx } from '../../../../shared/ui'
import { useShopStores, useSitePolicyHosts, useStoreRules } from '../../hooks/useShopStores'
import { StoreRow } from './StoreRow'
import { RuleSheet } from './RuleSheet'
import { DealDaysList } from './DealDaysList'
import type { ShopStore, ShopStoreKind, ShopStoreRule } from '../../types'

const KIND_ORDER: Record<ShopStoreKind, number> = { shop: 0, refurbisher: 1, marketplace: 2, price_site: 3 }
const byKindName = (a: ShopStore, b: ShopStore) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'en')

/** The stores, each opening in place; the hidden ones folded under one line. */
function StoresList() {
  const storesQ = useShopStores()
  const rulesQ = useStoreRules()
  const policyQ = useSitePolicyHosts()
  const [open, setOpen] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [editing, setEditing] = useState<{ store: ShopStore; rule: ShopStoreRule | null } | null>(null)
  const stores = useMemo(() => [...(storesQ.data ?? [])].sort(byKindName), [storesQ.data])
  const shown = stores.filter(s => !s.hidden)
  const hidden = stores.filter(s => s.hidden)

  if (storesQ.isLoading || rulesQ.isLoading) {
    return <div aria-hidden className="flex flex-col gap-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-11 w-full" rounded="rounded-row" />)}</div>
  }
  if (storesQ.isError || rulesQ.isError) {
    return (
      <p className="text-body text-fg-muted">
        Couldn't load the stores.{' '}
        <button type="button" onClick={() => { void storesQ.refetch(); void rulesQ.refetch() }} className="font-semibold text-accent-600 hover:underline">Try again</button>
      </p>
    )
  }
  const row = (s: ShopStore) => (
    <StoreRow key={s.id} store={s} stores={stores} rules={rulesQ.data ?? []} policyHosts={policyQ.data ?? []}
      open={open === s.id} onToggle={() => setOpen(o => (o === s.id ? null : s.id))} onRule={rule => setEditing({ store: s, rule })} />
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-fg-muted">Their rules count your return, complaint and claim days. A rule you edit is yours — never overwritten.</p>
      {!stores.length && <p className="text-body text-fg-muted">No stores yet.</p>}
      <ul className="-mx-2 flex flex-col">{shown.map(row)}</ul>
      {hidden.length > 0 && (
        <div>
          <button type="button" aria-expanded={showHidden} onClick={() => setShowHidden(v => !v)}
            className="flex min-h-[36px] items-center gap-1 text-meta font-medium text-fg-muted hover:text-fg-2">
            <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', showHidden && 'rotate-180')} />
            {hidden.length} hidden
          </button>
          {showHidden && <ul className="-mx-2 flex flex-col">{hidden.map(row)}</ul>}
        </div>
      )}
      {editing && <RuleSheet store={editing.store} stores={stores} rule={editing.rule} onClose={() => setEditing(null)} />}
    </div>
  )
}

/**
 * Stores and rules (a drawer from the Shop header's ⋯; owner's plan, 10.11.2026): every store and marketplace
 * with its kind, addresses, the owner's member tier and its rules — each with its source, link, read date and
 * words, edited, reset or turned off with Undo, a conflict with its source shown — and the deal days.
 */
export function StoresDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'stores' | 'deals'>('stores')
  return (
    <SideDrawer open onClose={onClose} title="Stores and rules" widthClassName="w-[30rem]"
      headerExtra={
        <div className="px-4 pb-2.5 sm:px-5">
          <SegmentedControl<'stores' | 'deals'> size="sm" fullWidth value={tab} onChange={setTab}
            options={[{ value: 'stores', label: 'Stores' }, { value: 'deals', label: 'Deal days' }]} />
        </div>
      }>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
        {tab === 'stores' ? <StoresList /> : <DealDaysList />}
      </div>
    </SideDrawer>
  )
}
