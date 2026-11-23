import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEntityModal } from '../../../../shared/modals'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../../shared/query'
import type { ReceiptFill, ReceiptRead } from '../../../ai/claude/featureRules'
import { deleteShopItems, deleteShopLinks, undoSale } from '../../api/shopApi'
import { SHOP_ROWS, useBuyNow, useShopCategories, useShopItems } from '../../hooks/useShop'
import { useCreateShopLinks, useShopLinks } from '../../hooks/useShopMoney'
import { useShopStores } from '../../hooks/useShopStores'
import { isMine } from '../../ownModel'
import { sidePreset, type MergedLine } from '../../receiptBatch'
import { chainPlan, linksToMake, pairKey, suggestChainPairs, type ChainLine, type ChainPlan } from '../../receiptChain'
import { addFillFor, saleFor, soldThingForLine, thingForLine, wishForLine, type ReceiptSide } from '../../receiptRead'
import { categoryPath } from '../../shopModel'
import type { ShopItem } from '../../types'
import type { CreateBatch, CreateState, LinePreset } from '../record/createDraft'

/** How a sold line is written: a sale of one of your things, a link to a thing already sold in the app, or "Something I had". */
export type SoldWay = 'owned' | 'in-app' | 'had'

export interface LineInfo {
  m: MergedLine
  side: ReceiptSide
  included: boolean
  /** The wish a Bought line is (its own Bought button), or null. */
  wish: ShopItem | null
  /** A Sold line: its way and, for the first two, the thing's id. */
  way: SoldWay
  thingId: string
  /** Bought lines of this kind are chain targets. */
  target: boolean
}

/** What this session wrote — and only this: Undo all takes back exactly these ids, from the writes' own answers. */
export interface Written {
  created: { key: string; id: string; label: string; had: boolean; state: CreateState }[]
  sales: { key: string; id: string; label: string }[]
  links: string[]
  /** Pairs (`pairKey`) linked by any write: the sale's own link, a saved thing's, a paid-from, or a link made here. */
  pairs: string[]
  /** Wishes bought here (their own Undo is the toast's). */
  wishes: Record<string, string>
}
const EMPTY: Written = { created: [], sales: [], links: [], pairs: [], wishes: {} }

const labelOf = (m: MergedLine): string => m.line.product ?? m.line.name

/**
 * The review of every read receipt as one list (owner, 23.11.2026): each line's side, tick and match, the money chain between the
 * sold and the bought ones, and the saves — each in its own popup with its own toast and Undo. The primary button does the next
 * save in an order that has every id it needs: the bought things first (a sale's money goes to them), then the sales, then the
 * sold things that match nothing ("Something I had"), and the links nothing else made. Nothing is written without the owner's tap.
 */
export function useReceiptFlow(merged: readonly MergedLine[]) {
  const modal = useEntityModal()
  const qc = useQueryClient()
  const { data: items = [] } = useShopItems()
  const { data: stores = [] } = useShopStores()
  const { data: categories = [] } = useShopCategories()
  const { data: links = [] } = useShopLinks()
  const linker = useCreateShopLinks()
  const [sides, setSides] = useState<Record<string, ReceiptSide>>({})
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [written, setWritten] = useState<Written>(EMPTY)
  const latest = useRef({ items, links })
  useEffect(() => { latest.current = { items, links } }, [items, links])

  const mine = useMemo(() => items.filter(t => isMine(t) && !t.accessory_of).sort((a, b) => a.title.localeCompare(b.title)), [items])
  const soldInApp = useMemo(() => items.filter(t => t.disposal && t.disposal !== 'returned' && t.status === 'bought' && !t.accessory_of).sort((a, b) => a.title.localeCompare(b.title)), [items])

  const info = useMemo(() => {
    const out = new Map<string, LineInfo>()
    for (const m of merged) {
      const side = sides[m.key] ?? sidePreset(m.read)
      const wish = side === 'bought' ? wishForLine(m.line, items) : null
      const auto = thingForLine(m.line, items)
      const sold = auto ? null : soldThingForLine(m.line, items)
      const pick = picked[m.key]
      let way: SoldWay = auto ? 'owned' : sold ? 'in-app' : 'had'
      let thingId = auto?.id ?? sold?.id ?? ''
      if (pick !== undefined) {
        if (pick === '') { way = 'had'; thingId = '' }
        else if (mine.some(t => t.id === pick)) { way = 'owned'; thingId = pick }
        else if (soldInApp.some(t => t.id === pick)) { way = 'in-app'; thingId = pick }
      }
      const included = ticks[m.key] ?? !m.duplicate
      out.set(m.key, { m, side, included, wish, way, thingId, target: side === 'bought' && (!!wish || included) })
    }
    return out
  }, [merged, sides, ticks, picked, items, mine, soldInApp])

  const doneKeys = useMemo(() => new Set([...written.created.map(c => c.key), ...written.sales.map(s => s.key), ...Object.keys(written.wishes)]), [written])
  const keys = useMemo(() => merged.map(m => m.key), [merged])
  const soldKeys = useMemo(() => keys.filter(k => { const i = info.get(k); return i?.side === 'sold' && i.included }), [keys, info])
  const boughtKeys = useMemo(() => keys.filter(k => info.get(k)?.target), [keys, info])

  // The chain's suggestion: sold line → one bought line, by code only (the model is never asked).
  const chainLine = useCallback((k: string): ChainLine => {
    const i = info.get(k) as LineInfo
    const { line, read } = i.m
    const cat = i.side === 'sold' ? items.find(t => t.id === i.thingId)?.category_id ?? line.category_id : line.category_id
    return {
      key: k, file: i.m.file, day: read.date ?? null, topCategory: cat ? categoryPath(cat, categories).topId || null : null,
      brand: line.brand, text: [line.product ?? line.name, line.model].filter(Boolean).join(' '), amount: line.price, currency: read.currency ?? null,
    }
  }, [info, items, categories])
  const suggestion = useMemo(() => suggestChainPairs(soldKeys.map(chainLine), boughtKeys.map(chainLine)), [soldKeys, boughtKeys, chainLine])
  /** The bought lines a sold line's money went to: the owner's own ticks once touched, else the suggestion. Never a line that is not there. */
  const ticksOf = useCallback((soldKey: string): ReadonlySet<string> => {
    const own = chosen[soldKey]
    const list = own ?? (suggestion.get(soldKey) ? [suggestion.get(soldKey) as string] : [])
    return new Set(list.filter(b => boughtKeys.includes(b) && b !== soldKey))
  }, [chosen, suggestion, boughtKeys])
  const toggleTarget = (soldKey: string, boughtKey: string) => setChosen(c => {
    const now = new Set(ticksOf(soldKey))
    if (now.has(boughtKey)) now.delete(boughtKey); else now.add(boughtKey)
    return { ...c, [soldKey]: [...now] }
  })
  const allTicks = useMemo(() => new Map(soldKeys.map(k => [k, ticksOf(k)] as const)), [soldKeys, ticksOf])
  const inApp = useMemo(() => new Set(soldKeys.filter(k => info.get(k)?.way === 'in-app')), [soldKeys, info])
  const plan: ChainPlan = useMemo(() => chainPlan(allTicks, boughtKeys, inApp), [allTicks, boughtKeys, inApp])

  /** The id a line's thing has now: a thing of yours, a wish, or a row this session saved. */
  const idOf = useCallback((k: string): string | undefined => {
    const created = written.created.find(c => c.key === k)
    if (created) return created.id
    const i = info.get(k)
    if (!i) return undefined
    if (i.side === 'bought') return i.wish?.id ?? written.wishes[k]
    return i.way === 'had' ? undefined : i.thingId || undefined
  }, [written, info])

  // What is still to save, in the order that has every id it needs.
  const pendingBought = useMemo(() => boughtKeys.filter(k => { const i = info.get(k) as LineInfo; return !i.wish && i.included && !doneKeys.has(k) }), [boughtKeys, info, doneKeys])
  const pendingSales = useMemo(() => soldKeys.filter(k => info.get(k)?.way === 'owned' && !doneKeys.has(k)), [soldKeys, info, doneKeys])
  const pendingHad = useMemo(() => soldKeys.filter(k => info.get(k)?.way === 'had' && !doneKeys.has(k)), [soldKeys, info, doneKeys])
  const pending = pendingBought.length + pendingSales.length + pendingHad.length
  const wishesLeft = boughtKeys.filter(k => info.get(k)?.wish && !doneKeys.has(k)).length

  const addPair = (w: Written, soldKey: string | undefined, boughtId: string | null | undefined, resolve: (id: string) => string | undefined): Written => {
    if (!soldKey || !boughtId) return w
    const b = resolve(boughtId)
    return b ? { ...w, pairs: [...new Set([...w.pairs, pairKey(soldKey, b)])] } : w
  }
  /** The line (a bought one) whose thing has this id, now or as saved. */
  const boughtKeyOfId = (id: string, w: Written): string | undefined => boughtKeys.find(k => (w.created.find(c => c.key === k)?.id ?? info.get(k)?.wish?.id ?? w.wishes[k]) === id)
  const soldKeyOfId = (id: string): string | undefined => soldKeys.find(k => info.get(k)?.thingId === id)

  function stepper(stepKeys: readonly string[], restore?: readonly (CreateState | undefined)[]) {
    if (!stepKeys.length) return
    const fills: ReceiptFill[] = stepKeys.map(k => { const m = (info.get(k) as LineInfo).m; return addFillFor(m.read, m.index, stores) })
    const presets: (LinePreset | undefined)[] = stepKeys.map(k => {
      const i = info.get(k) as LineInfo
      if (i.side === 'sold') {
        const first = plan.first.get(k)
        const to = first ? idOf(first) : undefined
        return { had: saleFor(i.m.read, i.m.line, stores), moneyTo: to }
      }
      const src = plan.paidFrom.get(k)
      const from = src ? idOf(src) : undefined
      return from ? { paidFrom: from } : undefined
    })
    const batch: CreateBatch = {
      fills, labels: stepKeys.map(k => labelOf((info.get(k) as LineInfo).m)), presets, restore,
      onSaved: (n, row, state) => setWritten(w => {
        const key = stepKeys[n]
        const had = (info.get(key) as LineInfo).side === 'sold'
        let next: Written = { ...w, created: [...w.created.filter(c => c.key !== key), { key, id: row.id, label: row.title, had, state }] }
        if (state.paidFrom) next = addPair(next, soldKeyOfId(state.paidFrom), row.id, id => boughtKeyOfId(id, next))
        if (state.moneyTo && had) next = addPair(next, key, state.moneyTo, id => boughtKeyOfId(id, next))
        return next
      }),
    }
    modal.open({ kind: 'shop-own', batch })
  }

  function openSale(k: string) {
    const i = info.get(k) as LineInfo
    if (!i.thingId) return
    const first = plan.first.get(k)
    const moneyTo = first ? idOf(first) : undefined
    modal.open({
      kind: 'shop-sell', id: i.thingId, sale: { ...saleFor(i.m.read, i.m.line, stores), ...(moneyTo ? { moneyTo } : {}) },
      onSold: ({ id, to }) => setWritten(w => {
        let next: Written = { ...w, sales: [...w.sales.filter(s => s.key !== k), { key: k, id, label: items.find(t => t.id === id)?.title ?? labelOf(i.m) }] }
        if (to) next = addPair(next, k, to, b => boughtKeyOfId(b, next))
        return next
      }),
    })
  }

  const buying = useRef<{ key: string; fill: ReceiptFill; read: ReceiptRead } | null>(null)
  const buyNow = useBuyNow(id => {
    const b = buying.current
    if (!b) return
    setWritten(w => ({ ...w, wishes: { ...w.wishes, [b.key]: id } }))
    modal.open({ kind: 'shop-just-bought', id, receipt: { fill: b.fill, read: b.read } })
  }, { thenDetails: true })
  function buyWish(k: string) {
    const i = info.get(k) as LineInfo
    if (!i.wish) return
    buying.current = { key: k, fill: addFillFor(i.m.read, i.m.index, stores), read: i.m.read }
    buyNow(i.wish)
  }

  /** The primary button: the next save, in the order that has every id it needs. */
  function go() {
    if (pendingBought.length) stepper(pendingBought)
    else if (pendingSales.length) openSale(pendingSales[0])
    else if (pendingHad.length) stepper(pendingHad)
  }

  // Once nothing is left to save, the links no write made are made: one toast, one Undo (exactly these links).
  const tried = useRef(new Set<string>())
  const ids = useMemo(() => {
    const m = new Map<string, string>()
    for (const k of keys) { const id = idOf(k); if (id && (info.get(k)?.side === 'bought' || doneKeys.has(k) || info.get(k)?.way === 'in-app')) m.set(k, id) }
    return m
  }, [keys, idOf, info, doneKeys])
  const toLink = useMemo(() => linksToMake(allTicks, ids, new Set(written.pairs), links), [allTicks, ids, written.pairs, links])
  useEffect(() => {
    if (pending > 0 || written.created.length + written.sales.length === 0 || linker.isPending) return
    const fresh = toLink.make.filter(l => !tried.current.has(pairKey(l.soldKey, l.boughtKey)))
    if (!fresh.length) return
    for (const l of fresh) tried.current.add(pairKey(l.soldKey, l.boughtKey))
    linker.mutate(fresh.map(l => ({ from_id: l.from_id, to_id: l.to_id })), {
      onSuccess: r => setWritten(w => ({ ...w, links: [...w.links, ...r.made], pairs: [...w.pairs, ...fresh.map(l => pairKey(l.soldKey, l.boughtKey))] })),
    })
  }, [pending, written, toLink, linker])
  const linkNote = pending === 0 && toLink.missing > 0 && written.created.length + written.sales.length > 0
    ? `${toLink.missing} ${toLink.missing === 1 ? 'link was' : 'links were'} not made: a line it needs was not saved.` : null

  const undo = useMutationWithFeedback<void, Written>({
    action: 'undo_receipt_session',
    successMessage: 'Taken back — the things you added are open again to edit',
    mutationFn: async w => {
      const now = latest.current.items
      // Newest sale first; a thing that is not sold any more is left alone.
      for (const s of [...w.sales].reverse()) { if (now.find(t => t.id === s.id)?.disposal) await undoSale(s.id) }
      await deleteShopLinks(w.links)
      const exist = w.created.map(c => c.id).filter(id => now.some(t => t.id === id))
      if (exist.length) await deleteShopItems(exist)
    },
    invalidates: [...SHOP_ROWS],
  })
  async function undoAll() {
    const total = written.sales.length + written.created.length + written.links.length
    if (!total) return
    const ok = await modal.confirm({
      title: 'Undo all from these receipts?',
      message: `Takes back ${written.sales.length} ${written.sales.length === 1 ? 'sale' : 'sales'}, ${written.links.length} ${written.links.length === 1 ? 'link' : 'links'} and removes the ${written.created.length} ${written.created.length === 1 ? 'thing' : 'things'} added here. Then the things you added open again, filled in, to edit. A wish you bought here keeps its own Undo.`,
      confirmLabel: 'Undo all', destructive: true,
    })
    if (!ok) return
    const snapshot = written
    try { await undo.mutateAsync(snapshot) } catch { return }
    tried.current = new Set()
    setWritten({ ...EMPTY, wishes: snapshot.wishes })
    const redo = snapshot.created
    // The drafts as they were saved, without the money links (their things are gone).
    stepper(redo.map(c => c.key), redo.map(c => ({ ...c.state, paidFrom: '', moneyTo: '' })))
    void qc.invalidateQueries({ queryKey: qk.shop.links() })
  }

  const firstLinked = written.sales[0]?.id ?? written.created.find(c => c.had)?.id ?? [...inApp].map(k => info.get(k)?.thingId).find(Boolean) ?? null
  return {
    info, keys, soldKeys, boughtKeys, mine, soldInApp, plan, suggestion, ticksOf, toggleTarget,
    setSide: (k: string, s: ReceiptSide) => setSides(x => ({ ...x, [k]: s })),
    setIncluded: (k: string, v: boolean) => setTicks(x => ({ ...x, [k]: v })),
    setPick: (k: string, id: string) => setPicked(x => ({ ...x, [k]: id })),
    written, doneKeys, pending, wishesLeft, go, openSale, openHad: (k: string) => stepper([k]), buyWish,
    undoAll, undoing: undo.isPending, linking: linker.isPending, linkNote,
    /** The thing whose chain "Open the chain" shows: the first sold thing of this session. */
    chainId: written.pairs.length || written.links.length ? firstLinked : null,
    hasChain: soldKeys.length > 0 && [...allTicks.values()].some(s => s.size > 0),
  }
}
