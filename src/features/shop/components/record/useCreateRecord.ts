import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEntityModal } from '../../../../shared/modals'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { ReceiptFill } from '../../../ai/claude/featureRules'
import { useCreateShopItem, useShopItems } from '../../hooks/useShop'
import { useQuietCheck } from '../../hooks/useShopPrices'
import { useCreateCostsForThing, useCreateShopLink, useFillRatesNow } from '../../hooks/useShopMoney'
import { useProductPicture } from '../../hooks/useProductPicture'
import { pictureFact, type PagePicture } from '../../productPicture'
import { photoLearnReport } from '../../photoFacts'
import { useReportAiSave } from '../../../ai/claude/hooks/useReportAiSave'
import { useLawRules, useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { isPossession } from '../../ownModel'
import { categoryPath, currencyOf, listOf } from '../../shopModel'
import { STATE_PILL } from './useShopRecord'
import { isNewCategory, newPickOf, NEW_CATEGORY, type RecordDraftApi } from './useRecordDraft'
import { useSaveCategory } from './useSaveCategory'
import { purchaseAtCreate, purchaseFormOf, purchaseTouched, purchaseView, type PurchaseForm } from './purchaseDraft'
import {
  applyDraftPatch, applyPreset, baseItem, blankState, costsAtSave, hadFill, linksAtSave, hasMoney, inputOf, isDirty, missingFor, quietSave, shopDraftOf, stateOf, viewOf, withPagePicture, withReceipt, withShopPatch,
  type CreateBatch, type CreateSpec, type CreateState, type DraftCost,
} from './createDraft'
import { middayIso } from '../../../media/watchedWhen'
import type { ShopCategory, ShopCurrency, ShopItem } from '../../types'

/** The popup's name for what is being made, until it has a name of its own. */
const LABEL: Record<CreateSpec['preset'], string> = {
  wish: 'Add to the wishlist', general: 'Add a wish', own: 'Add something I own', had: 'Add something I had', accessory: 'Add an accessory', model: 'Add a model',
}

/**
 * A thing being ADDED — the one body's (RecordBody) mode add: the drafts (one, or a read receipt's lines "1 of 3"), each kept
 * while the owner moves, what the facts, the autofill, the receipt, the picture and the Purchase part change, and the save
 * through the Shop's own hooks (`useCreateShopItem`, the money links, the costs), each line its own toast with Undo.
 * Nothing is written until Save.
 */
export function useCreateRecord({ spec, batch, onSaved, onClose, categories }: { spec: CreateSpec; batch?: CreateBatch; onSaved?: (item: ShopItem) => void; onClose: () => void; categories: ShopCategory[] }) {
  const modal = useEntityModal()
  const today = todayStr()
  const { data: items = [] } = useShopItems()
  const { data: stores = [], isLoading: storesLoading } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  const { data: law = [] } = useLawRules()
  const create = useCreateShopItem()
  const link = useCreateShopLink({ report: false })
  const check = useQuietCheck()
  const fillRates = useFillRatesNow()
  const saveCategory = useSaveCategory()
  const costsOf = useCreateCostsForThing()
  const readPicture = useProductPicture()
  const { mutate: reportSave } = useReportAiSave()
  const count = batch ? batch.fills.length : 1
  // Seeded once: a background refetch never overwrites what is being typed.
  const [states, setStates] = useState<CreateState[]>(() => Array.from({ length: count }, (_, i) => {
    const kept = batch?.restore?.[i]
    // After "Undo all": the draft as it was saved, to edit again (nothing of it is saved now).
    if (kept) return { ...kept, savedId: null, skipped: false }
    const blank = blankState(spec, categories, today)
    if (!batch) return blank
    const preset = batch.presets?.[i]
    const had = applyPreset(blank, preset?.had ? { had: preset.had } : undefined)
    const filled = withReceipt(spec, had, categories, preset?.had ? hadFill(batch.fills[i]) : batch.fills[i], new Date().toISOString())
    return applyPreset(filled, preset ? { paidFrom: preset.paidFrom, moneyTo: preset.moneyTo } : undefined)
  }))
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState<string[]>([])
  const st = states[index]
  // A receipt line's product page (a link the AI's own search returned) is read through shop-price, once per page; the picture is a
  // fact "product page (host)" the owner sees and can untick. No picture says why, in the shared words.
  const pictures = useRef(new Map<string, PagePicture>())
  const reading = useRef(new Set<string>())
  const [pictureNotes, setPictureNotes] = useState<Record<number, string>>({})
  const pageUrls = st.receipt?.pageUrls
  const pageKey = pageUrls?.join(' ') ?? ''
  const hasPageFact = st.facts.some(f => f.source.origin === 'page')
  const hasPicture = !!st.draft.image_url
  useEffect(() => {
    if (!pageUrls?.length || st.savedId || st.skipped || hasPageFact) return
    const at = index
    const apply = (p: PagePicture) => {
      const fact = pictureFact(p, new Date().toISOString())
      setStates(all => all.map((s, i) => (i === at && s.receipt?.pageUrls?.join(' ') === pageKey ? withPagePicture(spec, s, categories, fact) : s)))
      setPictureNotes(n => ({ ...n, [at]: p.note ?? '' }))
    }
    const known = pictures.current.get(pageKey)
    if (known) { if (known.image && !hasPicture) apply(known); return }
    // A picture the owner already has (or typed) is never read over.
    if (hasPicture || reading.current.has(pageKey)) return
    reading.current.add(pageKey)
    void readPicture(pageUrls, st.draft.title?.trim() || batch?.labels[index] || '', st.receipt?.pageNamed).then(p => { pictures.current.set(pageKey, p); reading.current.delete(pageKey); apply(p) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pages and the picture decide; the title only names the product being matched
  }, [pageKey, hasPageFact, hasPicture, index, st.savedId, st.skipped, spec, categories, readPicture])
  // The latest drafts, for what runs after an await (an answer that lands while a save is out must not be overwritten).
  const latest = useRef(states)
  useLayoutEffect(() => { latest.current = states }, [states])
  const kind = stateOf(spec, st.had, st.general)
  const owns = kind === 'mine' || kind === 'gone'
  const v = viewOf(spec, st)

  const patch = useCallback((change: (s: CreateState) => CreateState) => setStates(all => all.map((s, i) => (i === index ? change(s) : s))), [index])
  const draftApi: RecordDraftApi = {
    draft: st.draft,
    value: k => viewOf(spec, st)[k],
    boughtDay: st.draft.bought_day ?? '',
    set: p => patch(s => ({ ...s, draft: applyDraftPatch(s.draft, p) })),
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
  /** Find picture's suggestion, taken: a fact "Picture · product page (host)", filling the picture while it is empty or the page's. */
  const takePicture = (p: PagePicture) => patch(s => withPagePicture(spec, s, categories, pictureFact(p, new Date().toISOString())))

  const parents = useMemo(() => (owns ? items.filter(c => isPossession(c) && !c.accessory_of).sort((a, b) => a.title.localeCompare(b.title)) : undefined), [owns, items])
  const sources = useMemo(() => items.filter(i => isPossession(i) && !i.accessory_of && i.disposal), [items])
  const targets = useMemo(() => items.filter(i => listOf(i) === 'wishlist' && !i.accessory_of && i.kind !== 'general' && (i.status === 'wishlist' || isPossession(i))), [items])
  const money = hasMoney(spec, st)

  // The Purchase part (a thing you still own): its day is the add's own "Bought" fact, its store the add's own Store fact.
  const purchaseItem: ShopItem = useMemo(() => ({ ...v, bought_at: st.draft.bought_day ? middayIso(st.draft.bought_day) : null } as ShopItem), [v, st.draft.bought_day])
  const purchaseCtx = { stores, rules, law, categories, today }
  const purchaseForm: PurchaseForm | null = st.purchase ? { ...st.purchase, day: st.draft.bought_day || today } : null
  const purchase = purchaseForm ? purchaseView(purchaseItem, purchaseForm, purchaseCtx) : null
  const setPurchase = (f: PurchaseForm | null) => patch(s => ({ ...s, purchase: f }))
  const openPurchase = () => {
    if (st.purchase) return
    const seed = purchaseFormOf(purchaseItem, purchaseCtx)
    patch(s => ({ ...s, purchase: seed, purchaseSeed: seed }))
  }
  // A changed Purchase that does not hold (an arrival before the purchase day, a note too long) holds Save back.
  const purchaseWrong = kind === 'mine' && !!purchase && purchaseTouched(purchaseForm, st.purchaseSeed ?? null) && !purchase.valid

  const path = categoryPath(v.category_id && !v.category_id.startsWith('new:') ? v.category_id : null, categories)
  const named = v.title.trim()
  const pill = STATE_PILL[kind === 'buy' ? 'buy' : kind]
  // "Something I own" or "I had" follows this draft's own switch (a sold line of a receipt starts as "I had it").
  const label = spec.preset === 'own' || spec.preset === 'had' ? (st.had ? LABEL.had : LABEL.own) : LABEL[spec.preset]
  const title = named || (batch ? batch.labels[index] : label)
  const subtitle = [batch ? `${named ? label : batch.labels[index]}` : named ? label : null,
    spec.parent && spec.preset !== 'wish' ? `${spec.preset === 'model' ? 'A model of' : 'Accessory of'} ${spec.parent.title}` : null,
    path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : null].filter(Boolean).join(' · ') || undefined
  const missing = missingFor(spec, st, today) ?? (purchaseWrong ? 'an arrival on or after the day it was bought' : null)
  const unsaved = (s: CreateState) => !s.savedId && !s.skipped && isDirty(s)

  /** The next line that is neither saved nor skipped, after this one first and then from the start; null when none is left. */
  const nextOpen = (all: readonly CreateState[], from: number): number | null => {
    for (let k = 1; k <= all.length; k++) { const j = (from + k) % all.length; if (!all[j].savedId && !all[j].skipped) return j }
    return null
  }

  const finish = () => { batch?.onClosed?.(); onClose() }

  async function close(): Promise<boolean> {
    if (states.some(unsaved) && !(await modal.confirm({
      title: 'Discard your changes?', message: count > 1 ? 'Some lines are not saved yet.' : 'It is not saved yet.', confirmLabel: 'Discard', destructive: true,
    }))) return false
    finish()
    return true
  }

  /** The words of a category this save makes ("new category Photography › Cameras"), for the toast. */
  const madeCategory = (s: CreateState): string | undefined => {
    const id = s.draft.category_id
    if (!isNewCategory(id)) return undefined
    const p = newPickOf(id)
    const top = p.topId === NEW_CATEGORY ? s.draft.new_top?.trim() : categoryPath(p.topId, categories).topName
    const sub = (p.subId === NEW_CATEGORY || p.topId === NEW_CATEGORY) ? s.draft.new_sub?.trim() : ''
    return top ? `new category ${[top, sub].filter(Boolean).join(' › ')}` : undefined
  }

  async function save(another = false) {
    if (missing || saving || st.savedId) return
    const s = st
    const at = index
    setSaving(true)
    let row: ShopItem
    try {
      // A suggested or new category is made now, with the save (the record's way).
      const categoryId = await saveCategory.resolve(s.draft.category_id, s.draft, categories)
      const n = s.costs.filter(c => c.on).length
      // The Purchase part only when the owner opened it, and only for a thing still owned (one that left has no deadlines to keep).
      const bought = kind === 'mine' ? purchaseAtCreate(purchaseForm, purchase, s.purchaseSeed ?? null) : {}
      row = await create.mutateAsync({ quiet: quietSave(spec, another), note: [madeCategory(s), n ? `${n} extra ${n === 1 ? 'cost' : 'costs'}` : undefined].filter(Boolean).join(' · ') || undefined, input: { ...inputOf(spec, s, categoryId, categories), ...bought } })
    } catch { setSaving(false); return }
    try {
      // Only to what the popup itself offers (a preset or an old draft may name a thing that is gone, sold again or not a target).
      const ok = linksAtSave(s, hasMoney(spec, s), new Set(sources.map(x => x.id)), new Set(targets.map(x => x.id)))
      if (ok.from) await link.mutateAsync({ from_id: ok.from, to_id: row.id })
      if (ok.to) await link.mutateAsync({ from_id: row.id, to_id: ok.to })
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
    // The extra costs ticked on this draft (a receipt's, or typed): written with the thing, on its day; a failure toasts, the thing stays saved.
    const wanted = s.costs.filter(c => c.on)
    if (wanted.length) {
      try { await costsOf.mutateAsync(costsAtSave(s, row.id, today)) } catch { /* the hook toasted it */ }
    }
    onSaved?.(row)
    // A 📷✨ draft: what this Save kept of it goes to the function's learning (a background note; the save already reported).
    const learnReport = photoLearnReport(s.facts, row)
    if (learnReport) reportSave(learnReport)
    if (row.url && row.list !== 'quick') check([row.id])
    if (currencyOf(row) !== 'NOK' || wanted.some(c => c.currency !== 'NOK') || (s.had && s.draft.sale_currency && s.draft.sale_currency !== 'NOK')) fillRates()
    batch?.onSaved?.(at, row, { ...s, savedId: row.id })
    setSaving(false)
    if (another) {
      setAdded(a => [...a, row.title])
      setStates(all => all.map((x, i) => (i === at ? blankState(spec, categories, today) : x)))
      setEditing(null)
      return
    }
    // Marked by function, so nothing else changed on any line meanwhile is lost; the next line is worked out from the latest drafts.
    setStates(all => all.map((x, i) => (i === at ? { ...x, savedId: row.id } : x)))
    const next = nextOpen(latest.current.map((x, i) => (i === at ? { ...x, savedId: row.id } : x)), at)
    if (next === null) finish(); else setIndex(next)
  }

  /** Moves a cost to another draft (the owner decides which thing it belongs to); it keeps its tick. */
  function moveCost(id: string, to: number) {
    if (to === index) return
    setStates(all => {
      const cost = all[index]?.costs.find(c => c.id === id)
      if (!cost) return all
      return all.map((s, i) => (i === index ? { ...s, costs: s.costs.filter(c => c.id !== id) } : i === to ? { ...s, costs: [...s.costs, { ...cost, id: `m:${id}` }] } : s))
    })
  }

  function skip() {
    const at = index
    const next = nextOpen(latest.current.map((x, i) => (i === at ? { ...x, skipped: true } : x)), at)
    // The receipt's costs on a skipped line go on to the next open draft (the owner moves them from there): none is lost with a skip.
    setStates(all => all.map((x, i) => (i === at ? { ...x, skipped: true, costs: [] } : i === next ? { ...x, costs: [...x.costs, ...all[at].costs.map(c => ({ ...c, id: `m:${c.id}` }))] } : x)))
    if (next === null) finish(); else setIndex(next)
  }

  /** The drafts a cost may move to (a receipt's lines), by name. */
  const costTargets = count > 1
    ? states.map((x, i) => ((!x.savedId && !x.skipped) || i === index ? { value: i, label: x.draft.title?.trim() || batch?.labels[i] || `Line ${i + 1}` } : null)).filter((x): x is { value: number; label: string } => !!x)
    : []

  return {
    spec, batch, count, index, setIndex, st, states, kind, owns, v, draftApi, view, onChange, update, fromReceipt, takePicture,
    base: baseItem(spec, st.had, st.general), parents, sources, targets, money, title, subtitle, pill, missing, saving, categoryBusy: saveCategory.busy,
    added, pictureNote: pictureNotes[index] ?? '', save, close, skip, moveCost, costTargets, patch, today, categories, stores, storesLoading,
    setCosts: (costs: DraftCost[]) => patch(s => ({ ...s, costs })),
    purchaseItem, purchaseForm, purchase, setPurchase, openPurchase,
    /** Whether "Save and next" goes on to another line. */
    hasNext: count > 1 && nextOpen(states.map((x, i) => (i === index ? { ...x, savedId: 'x' } : x)), index) !== null,
    /** Close without asking when nothing was typed (the receipt hand-off). */
    closeIfClean: () => { if (!isDirty(st)) onClose() },
  }
}

export type CreateRecordModel = ReturnType<typeof useCreateRecord>
