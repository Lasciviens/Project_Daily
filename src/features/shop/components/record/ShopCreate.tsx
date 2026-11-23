import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, IconButton, SegmentedControl, Skeleton, TonePill, Truncate } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { ReceiptFill } from '../../../ai/claude/featureRules'
import { useCreateShopItem, useShopCategories, useShopItems } from '../../hooks/useShop'
import { useQuietCheck } from '../../hooks/useShopPrices'
import { useCreateShopLink, useFillRatesNow } from '../../hooks/useShopMoney'
import { useShopStores } from '../../hooks/useShopStores'
import { isPossession } from '../../ownModel'
import { categoryPath, currencyOf, listOf } from '../../shopModel'
import { ShopAutofill } from '../ShopItemForm'
import { ReceiptPhoto } from '../purchase/ReceiptPhoto'
import { Toggle } from './factKit'
import { RecordFacts } from './RecordFacts'
import { RecordSection } from './RecordSection'
import { STATE_PILL } from './useShopRecord'
import { newCategoryMissing, type RecordDraftApi } from './useRecordDraft'
import { useSaveCategory } from './useSaveCategory'
import {
  baseItem, blankState, inputOf, isDirty, missingFor, quietSave, shopDraftOf, stateOf, viewOf, withReceipt, withShopPatch,
  type CreateSpec, type CreateState,
} from './createDraft'
import { middayIso } from '../../../media/watchedWhen'
import type { ShopCategory, ShopCurrency, ShopItem } from '../../types'

/** The popup's name for what is being made, until it has a name of its own. */
const LABEL: Record<CreateSpec['preset'], string> = {
  wish: 'Add to the wishlist', general: 'Add a wish', own: 'Add something I own', had: 'Add something I had', accessory: 'Add an accessory', model: 'Add a model',
}

/** Several drafts at once: the lines of a read receipt, each kept while the owner moves between them. */
export interface CreateBatch {
  fills: readonly ReceiptFill[]
  /** Each line's name as the receipt printed it (the stepper's words before a line has its own name). */
  labels: readonly string[]
  /** A line was saved. */
  onSaved?: (index: number) => void
}

/**
 * A new Shop thing in the record's own popup (owner, 23.11.2026: "the same exact popup with every field"): the same
 * header, the same Facts (`RecordFacts`, every editor open) and the same Save, over a draft that writes nothing until Save.
 * The preset says what is made — a wish, a general wish, something you own or had, an accessory, a model — with its own
 * defaults, toast and links. A read receipt's lines are several drafts in one popup: "1 of 3 ‹ ›", each kept while
 * the owner moves, each saved on its own or skipped.
 */
export function ShopCreate(props: { spec: CreateSpec; batch?: CreateBatch; onSaved?: (item: ShopItem) => void; onClose: () => void }) {
  const cats = useShopCategories()
  if (!cats.isSuccess) {
    return (
      <ModalShell onClose={props.onClose} title={cats.isError ? "Can't load the categories" : 'Loading…'} size="xl" mobile="fullscreen">
        {cats.isError
          ? <p className="text-body text-fg-muted">Close this and try again in a moment.</p>
          : <div className="space-y-2"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></div>}
      </ModalShell>
    )
  }
  return <CreateBody {...props} categories={cats.data} />
}

function CreateBody({ spec, batch, onSaved, onClose, categories }: { spec: CreateSpec; batch?: CreateBatch; onSaved?: (item: ShopItem) => void; onClose: () => void; categories: ShopCategory[] }) {
  const modal = useEntityModal()
  const today = todayStr()
  const { data: items = [] } = useShopItems()
  const { data: stores = [] } = useShopStores()
  const create = useCreateShopItem()
  const link = useCreateShopLink({ report: false })
  const check = useQuietCheck()
  const fillRates = useFillRatesNow()
  const saveCategory = useSaveCategory()
  const count = batch ? batch.fills.length : 1
  // Seeded once: a background refetch never overwrites what is being typed.
  const [states, setStates] = useState<CreateState[]>(() => Array.from({ length: count }, (_, i) => {
    const blank = blankState(spec, categories, today)
    return batch ? withReceipt(spec, blank, categories, batch.fills[i], new Date().toISOString()) : blank
  }))
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState({ facts: true, money: true })
  const [added, setAdded] = useState<string[]>([])
  const st = states[index]
  const kind = stateOf(spec, st.had)
  const owns = kind === 'mine' || kind === 'gone'
  const v = viewOf(spec, st)

  const patch = useCallback((change: (s: CreateState) => CreateState) => setStates(all => all.map((s, i) => (i === index ? change(s) : s))), [index])
  const draftApi: RecordDraftApi = {
    draft: st.draft,
    value: k => viewOf(spec, st)[k],
    boughtDay: st.draft.bought_day ?? '',
    set: p => patch(s => ({ ...s, draft: { ...s.draft, ...p } })),
    dirty: isDirty(st),
    discard: () => patch(s => ({ ...blankState(spec, categories, today), receipt: s.receipt })),
    editing, setEditing,
  }
  const view = shopDraftOf(spec, st, categories)
  const onChange = useCallback((p: Partial<typeof view>) => patch(s => withShopPatch(spec, s, categories, p)), [patch, spec, categories])
  // The autofill's answers land later: worked out from the draft as it is then.
  const update = useCallback((change: (d: typeof view) => Partial<typeof view>) => setStates(all => all.map((s, i) => (
    i === index ? withShopPatch(spec, s, categories, change(shopDraftOf(spec, s, categories))) : s))), [index, spec, categories])
  const fromReceipt = useCallback((f: ReceiptFill) => patch(s => withReceipt(spec, s, categories, f, new Date().toISOString())), [patch, spec, categories])

  const parents = useMemo(() => (owns ? items.filter(c => isPossession(c) && !c.accessory_of).sort((a, b) => a.title.localeCompare(b.title)) : undefined), [owns, items])
  const sources = useMemo(() => items.filter(i => isPossession(i) && !i.accessory_of && i.disposal), [items])
  const targets = useMemo(() => items.filter(i => listOf(i) === 'wishlist' && !i.accessory_of && i.kind !== 'general' && (i.status === 'wishlist' || isPossession(i))), [items])
  const money = kind === 'gone' && (v.disposal === 'sold' || v.disposal === 'traded_in' || v.disposal === 'other')

  const path = categoryPath(v.category_id && !v.category_id.startsWith('new:') ? v.category_id : null, categories)
  const named = v.title.trim()
  const pillKey = kind === 'buy' ? 'buy' : kind
  const pill = STATE_PILL[pillKey]
  const subtitle = [batch ? `${named ? LABEL[spec.preset] : batch.labels[index]}` : named ? LABEL[spec.preset] : null,
    spec.parent && spec.preset !== 'wish' ? `${spec.preset === 'model' ? 'A model of' : 'Accessory of'} ${spec.parent.title}` : null,
    path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : null].filter(Boolean).join(' · ') || undefined
  const missing = missingFor(spec, st, today)
  const unsaved = (s: CreateState) => !s.savedId && !s.skipped && isDirty(s)

  /** The next line that is neither saved nor skipped, after this one first and then from the start; null when none is left. */
  const nextOpen = (all: readonly CreateState[], from: number): number | null => {
    for (let k = 1; k <= all.length; k++) { const j = (from + k) % all.length; if (!all[j].savedId && !all[j].skipped) return j }
    return null
  }

  async function close(): Promise<boolean> {
    if (states.some(unsaved) && !(await modal.confirm({
      title: 'Discard your changes?', message: count > 1 ? 'Some lines are not saved yet.' : 'It is not saved yet.', confirmLabel: 'Discard', destructive: true,
    }))) return false
    onClose()
    return true
  }

  async function save(another = false) {
    if (missing || saving || st.savedId) return
    const s = st
    setSaving(true)
    let row: ShopItem
    try {
      // A suggested or new category is made now, with the save (the record's way).
      const categoryId = await saveCategory.resolve(s.draft.category_id, s.draft, categories)
      row = await create.mutateAsync({ quiet: quietSave(spec), input: inputOf(spec, s, categoryId, categories) })
    } catch { setSaving(false); return }
    try {
      if (s.paidFrom) await link.mutateAsync({ from_id: s.paidFrom, to_id: row.id })
      if (s.had && s.moneyTo) await link.mutateAsync({ from_id: row.id, to_id: s.moneyTo })
    } catch { /* the link's own hook toasted it; the thing itself is saved */ }
    // The receipt's other lines as accessories of this thing (the owner ticked it): same store, same day, their own prices.
    if (s.withOthers && s.receipt && s.receipt.currency && s.receipt.others.length) {
      try {
        for (const l of s.receipt.others) {
          await create.mutateAsync({ quiet: true, input: {
            title: l.name, price: l.price, currency: s.receipt.currency as ShopCurrency, platform: row.platform, list: 'wishlist', category_id: row.category_id,
            accessory_of: row.id, status: 'bought', bought_at: middayIso(s.draft.bought_day as string), approx_dates: !!s.draft.approx_dates,
          } })
        }
      } catch { /* the hook toasted it; the thing itself is saved */ }
    }
    onSaved?.(row)
    if (row.url && row.list !== 'quick') check([row.id])
    if (currencyOf(row) !== 'NOK' || (s.had && s.draft.sale_currency && s.draft.sale_currency !== 'NOK')) fillRates()
    setSaving(false)
    batch?.onSaved?.(index)
    if (another) {
      setAdded(a => [...a, row.title])
      setStates(all => all.map((x, i) => (i === index ? blankState(spec, categories, today) : x)))
      setEditing(null)
      return
    }
    const done = states.map((x, i) => (i === index ? { ...x, savedId: row.id } : x))
    setStates(done)
    const next = nextOpen(done, index)
    if (next === null) onClose(); else setIndex(next)
  }

  function skip() {
    const done = states.map((x, i) => (i === index ? { ...x, skipped: true } : x))
    setStates(done)
    const next = nextOpen(done, index)
    if (next === null) onClose(); else setIndex(next)
  }

  const stepper = count > 1 && (
    <div className="flex items-center gap-1.5">
      <IconButton bordered size="sm" label="Previous line" onClick={() => setIndex((index - 1 + count) % count)}><ChevronLeft aria-hidden /></IconButton>
      <span className="min-w-[4.5rem] text-center text-body font-medium tabular-nums text-fg">{index + 1} of {count}</span>
      <IconButton bordered size="sm" label="Next line" onClick={() => setIndex((index + 1) % count)}><ChevronRight aria-hidden /></IconButton>
      <span className="ml-1 flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-meta text-fg-muted">
        {states.map((x, i) => (
          <button key={i} type="button" onClick={() => setIndex(i)} aria-label={`Line ${i + 1}${x.savedId ? ', saved' : x.skipped ? ', skipped' : ''}`}
            className={`rounded-control px-1 tabular-nums ${i === index ? 'font-semibold text-fg' : ''} ${x.savedId ? 'text-success' : ''}`}>
            {i + 1}{x.savedId ? ' ✓' : x.skipped ? ' –' : ''}
          </button>
        ))}
      </span>
    </div>
  )

  const footer = (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-meta text-fg-muted">
        {st.savedId ? <span className="text-success">✓ Saved</span>
          : added.length > 0 ? <>Added: <Truncate as="span">{added.join(', ')}</Truncate></>
          : missing ? `Needs ${missing}` : null}
      </span>
      {count > 1 && !st.savedId && <Button icon={<SkipForward />} onClick={skip} disabled={saving}>Skip</Button>}
      <Button onClick={() => { void close() }} disabled={saving}>{added.length || st.savedId ? 'Done' : 'Cancel'}</Button>
      {spec.preset === 'accessory' && <Button onClick={() => { void save(true) }} disabled={!!missing} loading={saving}>Add another</Button>}
      <Button variant="primary" onClick={() => { void save() }} disabled={!!missing || !!st.savedId || !!newCategoryMissing(st.draft)} loading={saving || saveCategory.busy}>
        {count > 1 && nextOpen(states.map((x, i) => (i === index ? { ...x, savedId: 'x' } : x)), index) !== null ? 'Save and next' : 'Save'}
      </Button>
    </div>
  )

  return (
    <ModalShell onClose={close} title={named || (batch ? batch.labels[index] : LABEL[spec.preset])} subtitle={subtitle} wrapTitle size="xl" mobile="fullscreen" dismissible={!saving}
      headerActions={<TonePill tone={pill.tone} className="shrink-0 max-sm:hidden">{pill.label}</TonePill>}
      footer={footer}>
      <div key={index} className="@container flex flex-col gap-3">
        {stepper}
        {(spec.preset === 'own' || spec.preset === 'had') && (
          <SegmentedControl<'own' | 'had'> size="sm" value={st.had ? 'had' : 'own'} onChange={x => patch(s => ({ ...s, had: x === 'had' }))}
            options={[{ value: 'own', label: 'I still have it' }, { value: 'had', label: 'I had it' }]} />
        )}
        <div className="grid items-start gap-3 @[46rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @[46rem]:gap-5">
          <div className="flex min-w-0 flex-col gap-3">
            {kind !== 'general' && <ShopAutofill draft={view} onChange={onChange} update={update} categories={categories} />}
            {owns && !batch && <ReceiptPhoto stores={stores} onFill={fromReceipt} />}
            {st.receipt && st.receipt.others.length > 0 && st.receipt.currency && !batch && (
              <Toggle checked={st.withOthers} onChange={x => patch(s => ({ ...s, withOthers: x }))}>
                Add the other {st.receipt.others.length === 1 ? 'line' : `${st.receipt.others.length} lines`} as {st.receipt.others.length === 1 ? 'an accessory' : 'accessories'}
              </Toggle>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <RecordSection id="facts" title="Facts" open={open.facts} onToggle={() => setOpen(o => ({ ...o, facts: !o.facts }))} action={null}>
              <RecordFacts item={baseItem(spec, st.had)} d={draftApi} state={kind} categories={categories} today={today} parents={parents}
                create={{ without: kind === 'general' ? [] : ['link'] }} />
            </RecordSection>
            {owns && (sources.length > 0 || (kind === 'gone' && money && targets.length > 0)) && (
              <RecordSection id="money" title="Money" open={open.money} onToggle={() => setOpen(o => ({ ...o, money: !o.money }))} action={null}>
                {sources.length > 0 && (
                  <div>
                    <label htmlFor="create-from" className="field-label">Paid with money from <span className="font-normal text-fg-muted">(optional)</span></label>
                    <select id="create-from" value={st.paidFrom} onChange={e => patch(s => ({ ...s, paidFrom: e.target.value }))} className="select">
                      <option value="">Nothing I sold</option>
                      {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                  </div>
                )}
                {kind === 'gone' && money && targets.length > 0 && (
                  <div>
                    <label htmlFor="create-to" className="field-label">Money went to <span className="font-normal text-fg-muted">(optional)</span></label>
                    <select id="create-to" value={st.moneyTo} onChange={e => patch(s => ({ ...s, moneyTo: e.target.value }))} className="select">
                      <option value="">Nothing in particular</option>
                      {targets.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'wishlist' ? ' (to buy)' : ''}</option>)}
                    </select>
                  </div>
                )}
              </RecordSection>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
