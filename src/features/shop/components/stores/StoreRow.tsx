import { useState, type ReactNode } from 'react'
import { ChevronDown, Eye, EyeOff, Plus, RotateCcw } from 'lucide-react'
import { Button, MetaLine, Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useEditShopStore, useResetShopStore } from '../../hooks/useShopStores'
import { storePatchProblem, type StorePatch } from '../../api/shopStoresApi'
import { storeSitePolicy } from '../../storeRules'
import { STORE_KIND_LABEL } from '../../storeWords'
import { SourceLink } from '../purchase/purchaseKit'
import { RuleRow } from './RuleRow'
import type { ShopStore, ShopStoreRule } from '../../types'

/** A fact of the store the owner may change in place: its value as text, Edit → a field, Save / Cancel. */
function EditableFact({ label, value, placeholder, store, field, hint }: {
  label: string; value: string | null; placeholder: string; store: ShopStore; field: 'member_tier' | 'search_url'; hint?: ReactNode
}) {
  const edit = useEditShopStore()
  const [draft, setDraft] = useState<string | null>(null)
  const next = draft?.trim() || null
  const patch: StorePatch = { [field]: next }
  const problem = draft !== null ? storePatchProblem(store, patch) : null
  const save = () => {
    if (problem) return
    const done = field === 'member_tier'
      ? (next ? `${store.name}: ${next} member — its rules for members count` : `${store.name}: no member tier`)
      : (next ? `${store.name}'s search link saved` : `${store.name}'s search link taken off`)
    edit.mutate({ id: store.id, patch, done }, { onSuccess: () => setDraft(null) })
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-meta font-medium text-fg-muted">{label}</span>
        {draft === null && <Truncate className="min-w-0 text-body text-fg-2">{value ?? 'None'}</Truncate>}
        {draft === null && (
          <button type="button" onClick={() => setDraft(value ?? '')} className="text-meta font-semibold text-accent-600 hover:underline">
            {value ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
      {draft !== null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={placeholder} aria-label={label} autoFocus
            className="input input-sm min-w-0 max-w-md flex-1" onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setDraft(null) }} />
          <Button size="sm" variant="primary" onClick={save} disabled={!!problem} loading={edit.isPending}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          {problem && <span data-tone="warn" className="tone-text basis-full text-meta">{problem}</span>}
        </div>
      )}
      {hint && draft !== null && <p className="text-meta text-fg-muted">{hint}</p>}
    </div>
  )
}

/**
 * One store or marketplace: its kind and addresses on one line; open, the owner's member tier (editable — a rule
 * for that tier then counts), its search link (FINN and Tise get one here), whether apps may read it (188's list),
 * where its facts come from, its rules and + Rule, and Hide (a seeded store is hidden, never deleted).
 */
export function StoreRow({ store, stores, rules, policyHosts, open, onToggle, onRule }: {
  store: ShopStore
  stores: readonly ShopStore[]
  rules: readonly ShopStoreRule[]
  policyHosts: readonly string[]
  open: boolean
  onToggle: () => void
  /** Edit a rule, or add one (null). */
  onRule: (rule: ShopStoreRule | null) => void
}) {
  const edit = useEditShopStore()
  const reset = useResetShopStore()
  const mine = rules.filter(r => r.store_id === store.id)
  const on = mine.filter(r => !r.off).length
  const refused = storeSitePolicy(store, policyHosts)
  const meta = [
    STORE_KIND_LABEL[store.kind],
    store.hosts[0] + (store.hosts.length > 1 ? ` +${store.hosts.length - 1}` : ''),
    store.member_tier ? `${store.member_tier} member` : null,
    mine.length ? `${on} rule${on === 1 ? '' : 's'}${mine.length > on ? ` · ${mine.length - on} off` : ''}` : 'no rules yet',
  ].filter((x): x is string => !!x)

  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-row px-2 py-2 text-left transition-colors hover:bg-surface-hover">
        <span className="min-w-0 flex-1">
          <Truncate as="span" className="block text-body font-medium text-fg">{store.name}</Truncate>
          <MetaLine as="span" className="block text-meta text-fg-muted" items={meta} />
        </span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-2 pb-3">
          <p className="text-meta text-fg-muted">
            {[STORE_KIND_LABEL[store.kind], store.country, store.currency].join(' · ')} · {store.hosts.join(', ')}
          </p>
          {refused && <p data-tone="neutral" className="tone-text text-meta">{refused} doesn't let apps read its pages — the app only links to it.</p>}
          <EditableFact label="Your member tier" value={store.member_tier} placeholder="Kundeklubb, Plus…" store={store} field="member_tier" />
          <EditableFact label="Search link" value={store.search_url} placeholder={`https://www.${store.hosts[0]}/search?q={q}`} store={store} field="search_url"
            hint={<>Its own search page, with <span className="font-mono">{'{q}'}</span> where the words go — on {store.hosts.join(' or ')}. Opened by you, never read by the app.</>} />
          <p className="text-meta text-fg-muted">
            {store.origin === 'owner' ? 'Added by you' : store.owner_edited ? 'You edited its facts' : `From ${store.read_on ? `its page, read ${formatDate(store.read_on)}` : 'its own address only'}`}
            {store.source_url && <> · <SourceLink url={store.source_url} /></>}
          </p>
          {mine.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {mine.map(r => <RuleRow key={r.id} rule={r} store={store} stores={stores} onEdit={() => onRule(r)} />)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" icon={<Plus />} onClick={() => onRule(null)}>Rule</Button>
            {store.owner_edited && store.source && (
              <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => reset.mutate({ id: store.id })}>Reset to its source</Button>
            )}
            <Button size="sm" variant="ghost" icon={store.hidden ? <Eye /> : <EyeOff />} className="ml-auto"
              onClick={() => edit.mutate({ id: store.id, patch: { hidden: !store.hidden }, done: store.hidden ? `${store.name} shown again` : `${store.name} hidden` })}>
              {store.hidden ? 'Show' : 'Hide'}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
