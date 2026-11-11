import { useState, type ReactNode } from 'react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, cx } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useAddStoreRule, useEditStoreRule } from '../../hooks/useShopStores'
import { BLANK_RULE } from '../../api/shopStoresApi'
import { RULE_EXCLUSIONS, RULE_KINDS, rulePatchProblem, type StoreRulePatch } from '../../storeRows'
import { EXCLUSION_LABEL, RULE_KIND_LABEL, monthDayOf, monthDayWords } from '../../storeWords'
import { claimedBy, unchecked } from '../../storeRules'
import type { ShopRuleAgainst, ShopRuleExclusion, ShopRulePayout, ShopStore, ShopStoreRule, ShopStoreRuleFacts, ShopStoreRuleKind } from '../../types'

const FACT_KEYS: (keyof ShopStoreRuleFacts)[] = ['kind', 'label', 'days', 'member_tier', 'window_from', 'window_to', 'return_until', 'exclusions', 'payout',
  'against', 'against_stores', 'words', 'source_url', 'read_on', 'off']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A checkbox with its words (the record's Toggle, kept here so this chunk doesn't share the record's kit). */
function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[36px] items-center gap-2 text-body text-fg-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-[18px] w-[18px] shrink-0 accent-accent-500" />
      <span>{children}</span>
    </label>
  )
}

/** One labelled row of the form: a short label beside its field. */
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={htmlFor} className="w-24 shrink-0 text-meta font-medium text-fg-muted">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

/**
 * Edit a store's rule, or add one of the owner's own: the kind's own facts (days; a window and a return-until day
 * for a seasonal return; whom a price match is against), a member tier, what it leaves out, the payout, the
 * store's words and where they come from. Checked before it is sent (storeRows.rulePatchProblem) — the database
 * checks again. An edit is the owner's from then on: never overwritten by a later seed or page read.
 */
export function RuleSheet({ store, stores, rule, onClose }: { store: ShopStore; stores: readonly ShopStore[]; rule: ShopStoreRule | null; onClose: () => void }) {
  const edit = useEditStoreRule()
  const add = useAddStoreRule()
  const start: ShopStoreRuleFacts = rule ?? { ...BLANK_RULE, kind: 'return', days: 30 }
  const [kind, setKind] = useState<ShopStoreRuleKind>(start.kind)
  const [label, setLabel] = useState(start.label ?? '')
  const [days, setDays] = useState(start.days != null ? String(start.days) : '')
  const [tier, setTier] = useState(start.member_tier ?? '')
  const [from, setFrom] = useState(monthDayWords(start.window_from))
  const [to, setTo] = useState(monthDayWords(start.window_to))
  const [until, setUntil] = useState(monthDayWords(start.return_until))
  const [byUntil, setByUntil] = useState(start.kind === 'seasonal_return' ? start.return_until !== null : true)
  const [exclusions, setExclusions] = useState<ShopRuleExclusion[]>(start.exclusions)
  const [payout, setPayout] = useState<ShopRulePayout | ''>(start.payout ?? '')
  const [against, setAgainst] = useState<ShopRuleAgainst>(start.against ?? (start.kind === 'price_protection' ? 'own' : 'listed'))
  const [targets, setTargets] = useState<string[]>(start.against_stores ?? [])
  const [words, setWords] = useState(start.words ?? '')
  const [sourceUrl, setSourceUrl] = useState(start.source_url ?? '')
  const [readOn, setReadOn] = useState(start.read_on ?? '')
  const today = todayStr()
  const others = stores.filter(s => s.id !== store.id && (s.kind === 'shop' || s.kind === 'refurbisher') && !s.hidden)

  const seasonal = kind === 'seasonal_return'
  const n = days.trim() === '' ? null : Number(days)
  const facts: ShopStoreRuleFacts = {
    kind, label: label.trim() || null, member_tier: tier.trim() || null, words: words.trim() || null,
    source_url: sourceUrl.trim() || null, read_on: readOn || null, off: rule?.off ?? false,
    exclusions: [...exclusions].sort(), payout: payout || null,
    days: kind === 'price_match' || (seasonal && byUntil) ? null : n,
    window_from: seasonal ? monthDayOf(from) : null,
    window_to: seasonal ? monthDayOf(to) : null,
    return_until: seasonal && byUntil ? monthDayOf(until) : null,
    against: kind === 'price_match' ? (against === 'any' ? 'any' : 'listed') : kind === 'price_protection' ? (against === 'any' ? 'any' : 'own') : null,
    against_stores: kind === 'price_match' && against !== 'any' ? (targets.length ? targets : []) : null,
  }
  const windowMissing = seasonal && (!facts.window_from || !facts.window_to || (byUntil && !facts.return_until))
  const problem = windowMissing ? 'A seasonal return needs its window and its day, as DD.MM'
    : kind === 'price_match' && facts.against === 'listed' && !targets.length ? 'Pick the stores it matches, or any shop'
    : rulePatchProblem(facts, {})
  const patch: StoreRulePatch = {}
  if (rule) for (const k of FACT_KEYS) if (!same(facts[k], rule[k])) (patch as Record<string, unknown>)[k] = facts[k]
  const changed = !rule || Object.keys(patch).length > 0
  const busy = edit.isPending || add.isPending

  function save() {
    if (problem || !changed) return
    if (rule) edit.mutate({ id: rule.id, patch }, { onSuccess: onClose })
    else add.mutate({ storeId: store.id, facts }, { onSuccess: onClose })
  }
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter(y => y !== x) : [...list, x])

  return (
    <ModalShell onClose={onClose} title={rule ? 'Edit rule' : `New rule for ${store.name}`} subtitle={rule ? store.name : undefined} size="sm" compact dismissible={!busy}
      footer={
        <div className="flex items-center gap-2">
          {problem && <span data-tone="warn" className="tone-text min-w-0 flex-1 text-meta">{problem}</span>}
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto" disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!!problem || !changed} loading={busy}>{rule ? 'Save' : 'Add rule'}</Button>
        </div>
      }>
      <div className="flex flex-col gap-2.5">
        {/* A rule nobody checked decides nothing until it is the owner's (storeRules.unchecked). */}
        {rule && unchecked(rule) && (
          <p className="text-meta text-fg-muted">From {claimedBy(rule)} — saving an edit makes it yours: from then on its days decide your dates.</p>
        )}
        {!rule && (
          <Row label="Kind" htmlFor="rule-kind">
            <select id="rule-kind" value={kind} onChange={e => setKind(e.target.value as ShopStoreRuleKind)} className="select input-sm w-auto">
              {RULE_KINDS.map(k => <option key={k} value={k}>{RULE_KIND_LABEL[k]}</option>)}
            </select>
          </Row>
        )}
        <Row label="Name" htmlFor="rule-label">
          <input id="rule-label" value={label} onChange={e => setLabel(e.target.value)} maxLength={60} placeholder={RULE_KIND_LABEL[kind]} className="input input-sm max-w-xs" />
        </Row>
        {seasonal && (
          <Row label="Bought">
            <input value={from} onChange={e => setFrom(e.target.value)} placeholder="15.11" aria-label="Bought from (DD.MM)" className="input input-sm w-[5.5rem] tabular-nums" />
            <span className="text-meta text-fg-muted">to</span>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="31.12" aria-label="Bought to (DD.MM)" className="input input-sm w-[5.5rem] tabular-nums" />
          </Row>
        )}
        {seasonal && (
          <Row label="Back by">
            <Toggle checked={byUntil} onChange={setByUntil}>A day</Toggle>
            {byUntil && <input value={until} onChange={e => setUntil(e.target.value)} placeholder="15.01" aria-label="Returned by (DD.MM)" className="input input-sm w-[5.5rem] tabular-nums" />}
          </Row>
        )}
        {kind !== 'price_match' && !(seasonal && byUntil) && (
          <Row label="Days" htmlFor="rule-days">
            <input id="rule-days" value={days} onChange={e => setDays(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="input input-sm w-[5.5rem] tabular-nums" />
            <span className="text-meta text-fg-muted">{kind === 'price_protection' ? 'from the purchase day' : 'from the day it arrived'}</span>
          </Row>
        )}
        {kind === 'price_match' && (
          <Row label="Matches">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Matches whom">
              {(['listed', 'any'] as const).map(a => (
                <button key={a} type="button" role="radio" aria-checked={against === a} onClick={() => setAgainst(a)}
                  className={cx('chip px-3', against === a ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface-hover')}>
                  {a === 'any' ? 'Any shop in its country' : 'These stores'}
                </button>
              ))}
            </div>
          </Row>
        )}
        {kind === 'price_match' && against !== 'any' && (
          <div className="flex flex-wrap gap-x-4 pl-0 sm:pl-[6.75rem]">
            {others.map(s => <Toggle key={s.id} checked={targets.includes(s.id)} onChange={() => setTargets(t => toggle(t, s.id))}>{s.name}</Toggle>)}
          </div>
        )}
        {kind === 'price_protection' && (
          <Row label="Against" htmlFor="rule-against">
            <select id="rule-against" value={against} onChange={e => setAgainst(e.target.value as ShopRuleAgainst)} className="select input-sm w-auto">
              <option value="own">Its own price</option>
              <option value="any">Any shop's price</option>
            </select>
          </Row>
        )}
        <Row label="Members" htmlFor="rule-tier">
          <input id="rule-tier" value={tier} onChange={e => setTier(e.target.value)} maxLength={60} placeholder="Everyone" className="input input-sm max-w-xs" />
        </Row>
        <Row label="Not for">
          {RULE_EXCLUSIONS.map(e => <Toggle key={e} checked={exclusions.includes(e)} onChange={() => setExclusions(x => toggle(x, e))}>{EXCLUSION_LABEL[e]}</Toggle>)}
        </Row>
        {kind !== 'open_purchase' && kind !== 'return' && kind !== 'seasonal_return' ? (
          <Row label="Paid as" htmlFor="rule-payout">
            <select id="rule-payout" value={payout} onChange={e => setPayout(e.target.value as ShopRulePayout | '')} className="select input-sm w-auto">
              <option value="">Not said</option>
              <option value="money">Money</option>
              <option value="gift_card">A gift card</option>
            </select>
          </Row>
        ) : null}
        <div>
          <label htmlFor="rule-words" className="field-label">The store's words</label>
          <textarea id="rule-words" value={words} onChange={e => setWords(e.target.value)} rows={2} maxLength={2000} className="input resize-y" />
        </div>
        <Row label="Source" htmlFor="rule-source">
          <input id="rule-source" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://… the store's terms" className="input input-sm min-w-0 flex-1" />
        </Row>
        <Row label="Read on">
          <DateInput value={readOn} onChange={setReadOn} max={today} aria-label="Read on" className="input input-sm w-[8.5rem] tabular-nums" />
        </Row>
      </div>
    </ModalShell>
  )
}
