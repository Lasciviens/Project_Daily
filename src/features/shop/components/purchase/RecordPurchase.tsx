import { useMemo } from 'react'
import { PackageCheck, ReceiptText } from 'lucide-react'
import { useEntityModal } from '../../../../shared/modals'
import { Button, MetaLine, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useLawRules, useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { useSavePurchase } from '../../hooks/usePurchase'
import { complaintYearsOf, dateSource, deadlinesOf, protectionOf, type StoreCtx } from '../../purchaseModel'
import { DateFact, DeadlineWords } from './purchaseKit'
import type { PurchasePatch } from '../../api/shopPurchaseApi'
import type { Deadline } from '../../storeRules'
import type { ShopItem } from '../../types'

/** A stored date against the rules' one: their words, the owner's own date with the rules' beside it, or what the rules give. */
function Why({ stored, rules, notes = [] }: { stored: string | null | undefined; rules: Deadline | null; notes?: readonly string[] }) {
  const source = dateSource(stored, rules?.day)
  if (source === 'rules') return <DeadlineWords deadline={rules} notes={notes} />
  if (source === 'own') {
    return <p className="text-meta text-fg-muted">Your own date{rules ? ` — the rules give ${formatDate(rules.day)}: ${rules.words.replace(/^\S+ by \S+ — /, '')}` : ''}.</p>
  }
  return rules ? <p className="text-meta text-fg-muted">Not set — the rules give {formatDate(rules.day)}: {rules.words.replace(/^\S+ by \S+ — /, '')}.</p> : null
}

/** The Purchase section's action: Just bought again, to change how and where it was bought. */
export function PurchaseDetailsButton({ item }: { item: ShopItem }) {
  const modal = useEntityModal()
  return <Button size="sm" variant="ghost" icon={<ReceiptText />} onClick={() => modal.open({ kind: 'shop-just-bought', id: item.id })}>Details</Button>
}

/**
 * The record's Purchase section — a thing you have, as it was bought: online or in a shop, where, Arrived, and its
 * return and complaint days with their reasons (each date explains itself; a date the owner set is theirs, the
 * rules' named beside it), the extra warranty and the receipt note. Arrived counts the days from today.
 */
export function RecordPurchase({ item, today }: { item: ShopItem; today: string }) {
  const modal = useEntityModal()
  const { data: stores = [] } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  const { data: law = [] } = useLawRules()
  const save = useSavePurchase()
  const ctx: StoreCtx = useMemo(() => ({ stores, rules, law }), [stores, rules, law])
  const { store, deadlines } = useMemo(() => deadlinesOf(item, ctx), [item, ctx])
  const protection = useMemo(() => protectionOf(item, store, rules, today), [item, store, rules, today])

  const how = [
    item.bought_channel === 'online' ? 'Online' : item.bought_channel === 'in_store' ? 'In a shop' : null,
    store?.name ?? item.platform ?? null,
    item.bought_channel === 'online' ? (item.arrived_on ? `arrived ${formatDate(item.arrived_on)}` : 'not arrived yet') : null,
  ].filter((x): x is string => !!x)

  function arrivedToday() {
    const next = deadlinesOf({ ...item, arrived_on: today }, ctx).deadlines
    const patch: PurchasePatch = { arrived_on: today }
    // A date the rules gave moves with arrival; one the owner set stays theirs.
    if (dateSource(item.return_by, deadlines?.returnBy?.day) !== 'own' && next?.returnBy) patch.return_by = next.returnBy.day
    if (complaintYearsOf(item) != null && next?.complaintBy) patch.warranty_until = next.complaintBy.day
    const back = patch.return_by ? ` — return by ${formatDate(patch.return_by)}` : ''
    save.mutate({ id: item.id, patch, done: `Arrived ${formatDate(today)}${back}` })
  }

  return (
    <div className="flex flex-col gap-2">
      {protection && (
        <p className="flex flex-wrap items-center gap-x-2 text-meta text-fg-muted">
          <span>Price protection to {formatDate(protection.until)} — {protection.words}</span>
          <button type="button" onClick={() => modal.open({ kind: 'shop-claim', id: item.id })} className="font-semibold text-accent-600 hover:underline">Got money back</button>
        </p>
      )}
      {how.length > 0 && <MetaLine className="text-meta text-fg-muted" items={how} />}
      {item.bought_channel === 'online' && !item.arrived_on && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<PackageCheck />} onClick={arrivedToday} loading={save.isPending}>Arrived today</Button>
          <span className="text-meta text-fg-muted">Until then every day counts from the purchase day.</span>
        </div>
      )}
      <DateFact label="Return by" day={item.return_by ?? null} today={today}>
        <Why stored={item.return_by} rules={deadlines?.returnBy ?? null} notes={deadlines?.notes} />
      </DateFact>
      <DateFact label="Complain by" day={item.warranty_until ?? null} today={today}>
        <Why stored={item.warranty_until} rules={deadlines?.complaintBy ?? null} />
      </DateFact>
      {item.extra_warranty_until && <DateFact label="Extra warranty until" day={item.extra_warranty_until} today={today} />}
      {item.receipt_note && (
        <div className="flex flex-col gap-0.5">
          <span className="text-meta font-medium text-fg-muted">Receipt</span>
          <Truncate lines={3} reveal="more" className="whitespace-pre-line text-body text-fg-2">{item.receipt_note}</Truncate>
        </div>
      )}
    </div>
  )
}
