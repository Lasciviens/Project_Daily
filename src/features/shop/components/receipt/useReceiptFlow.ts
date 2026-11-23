import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../../app/store'
import { useEntityModal } from '../../../../shared/modals'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../../shared/query'
import type { ReceiptFill, ReceiptRead } from '../../../ai/claude/featureRules'
import { deleteShopItems, deleteShopLinks, restoreShopItems, undoSale, type ShopSnapshot } from '../../api/shopApi'
import { SHOP_ROWS, useBuyNow, useShopCategories, useShopItems, useUpdateShopItem } from '../../hooks/useShop'
import { useCreateShopLinks, useShopLinks } from '../../hooks/useShopMoney'
import { useShopStores } from '../../hooks/useShopStores'
import { isMine } from '../../ownModel'
import { sidePreset, type MergedLine } from '../../receiptBatch'
import { chainPlan, linksToMake, pairKey, suggestChainPairs, type ChainLine, type ChainPlan } from '../../receiptChain'
import { addFillFor, saleFor, soldThingForLine, thingForLine, wishForLine, type ReceiptSide, type SaleDefaults } from '../../receiptRead'
import { categoryPath } from '../../shopModel'
import type { ShopItem } from '../../types'
import type { SoldDone } from '../owned/SellSheet'
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

/**
 * What this session wrote — and only this: Undo all takes back exactly these ids, from the writes' own answers. It is a record of
 * the writes; what the screen shows and what Undo all acts on is `live`, the part of it that still holds in the live data (a toast's
 * own Undo changes the list at once, and a deleted id is never linked).
 */
export interface Written {
  created: { key: string; id: string; label: string; had: boolean; state: CreateState }[]
  /** `done` is what the sale said it wrote (how, day, amount): Undo all takes the sale back only while the thing still looks like it. */
  sales: { key: string; id: string; label: string; done: SoldDone }[]
  links: string[]
  /** Pairs (`pairKey`) that a write handled: a planned first link counts as handled whatever target was really saved, so a changed or cleared "Money goes to" is never linked again behind the owner's back. */
  handled: string[]
  /** Wishes bought here, with the row as it was (the way `useBuyNow` puts it back). */
  wishes: Record<string, { id: string; row: ShopItem }>
}
const EMPTY: Written = { created: [], sales: [], links: [], handled: [], wishes: {} }

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
  const update = useUpdateShopItem()
  const [sides, setSides] = useState<Record<string, ReceiptSide>>({})
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [written, setWritten] = useState<Written>(EMPTY)
  /** What the owner typed in Sell, per line: kept through "Undo all", so Sell starts with it next time. */
  const [lastSale, setLastSale] = useState<Record<string, SaleDefaults>>({})
  const latest = useRef({ items, links })
  useEffect(() => { latest.current = { items, links } }, [items, links])
  /** A sale's group as first seen after it was saved: Undo all takes a sale back only while the row still carries it. */
  const groupSeen = useRef<Record<string, string | null>>({})
  useEffect(() => {
    for (const sale of written.sales) {
      const it = items.find(t => t.id === sale.id)
      if (it && it.disposal === sale.done.how && it.disposed_on === sale.done.on && !(sale.id in groupSeen.current)) groupSeen.current[sale.id] = it.sale_group ?? null
    }
  }, [written.sales, items])

  const mine = useMemo(() => items.filter(t => isMine(t) && !t.accessory_of).sort((a, b) => a.title.localeCompare(b.title)), [items])
  const soldInApp = useMemo(() => items.filter(t => t.disposal && t.disposal !== 'returned' && t.status === 'bought' && !t.accessory_of).sort((a, b) => a.title.localeCompare(b.title)), [items])

  // What is matched is only what was there when the popup opened: a thing this popup saves must never become the match of another line
  // (a new "Something I had" would otherwise turn into "already sold in the app" the moment it is saved).
  const ready = items.length > 0
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a snapshot of the things there when the popup opened, never refreshed
  const known = useMemo(() => new Set(items.map(t => t.id)), [ready])
  const pool = useMemo(() => items.filter(t => known.has(t.id)), [items, known])

  // What this popup wrote, as the live data says it stands now: a thing a toast's Undo removed is no longer "added", a sale that was
  // taken back is no longer "sold", a link that is gone is no longer "linked". The sale is the one this popup made: same way and day.
  const live = useMemo(() => {
    const byId = new Map(items.map(t => [t.id, t]))
    const linkIds = new Set(links.map(l => l.id))
    return {
      created: written.created.filter(c => byId.has(c.id)),
      sales: written.sales.filter(x => { const it = byId.get(x.id); return !!it && it.disposal === x.done.how && it.disposed_on === x.done.on }),
      links: written.links.filter(id => linkIds.has(id)),
      wishes: Object.fromEntries(Object.entries(written.wishes).filter(([, w]) => byId.get(w.id)?.status === 'bought')),
    }
  }, [written, items, links])

  const info = useMemo(() => {
    const out = new Map<string, LineInfo>()
    for (const m of merged) {
      const side = sides[m.key] ?? sidePreset(m.read)
      const wish = side === 'bought' ? wishForLine(m.line, pool) : null
      const auto = thingForLine(m.line, pool)
      const sold = auto ? null : soldThingForLine(m.line, pool)
      const pick = picked[m.key]
      let way: SoldWay = auto ? 'owned' : sold ? 'in-app' : 'had'
      let thingId = auto?.id ?? sold?.id ?? ''
      if (pick !== undefined) {
        if (pick === '') { way = 'had'; thingId = '' }
        else if (mine.some(t => t.id === pick)) { way = 'owned'; thingId = pick }
        else if (soldInApp.some(t => t.id === pick)) { way = 'in-app'; thingId = pick }
      }
      // A line that has been written stays what it was: matching again after the sale (the thing is sold now) could pick another thing.
      const sale = written.sales.find(x => x.key === m.key)
      if (sale) { way = 'owned'; thingId = sale.id }
      else if (written.created.some(x => x.key === m.key && x.had)) { way = 'had'; thingId = '' }
      const included = ticks[m.key] ?? !m.duplicate
      out.set(m.key, { m, side, included, wish, way, thingId, target: side === 'bought' && included })
    }
    return out
  }, [merged, sides, ticks, picked, pool, mine, soldInApp, written])

  const doneKeys = useMemo(() => new Set([...live.created.map(c => c.key), ...live.sales.map(s => s.key), ...Object.keys(live.wishes)]), [live])
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

  /** The id a line's thing has now: a thing of yours, a wish, or a row this session saved and that is still there. */
  const idOf = useCallback((k: string): string | undefined => {
    const created = live.created.find(c => c.key === k)
    if (created) return created.id
    const i = info.get(k)
    if (!i) return undefined
    if (i.side === 'bought') return i.wish?.id ?? live.wishes[k]?.id
    return i.way === 'had' ? undefined : i.thingId || undefined
  }, [live, info])

  // What is still to save, in the order that has every id it needs.
  const pendingBought = useMemo(() => boughtKeys.filter(k => { const i = info.get(k) as LineInfo; return !i.wish && i.included && !doneKeys.has(k) }), [boughtKeys, info, doneKeys])
  const pendingSales = useMemo(() => soldKeys.filter(k => info.get(k)?.way === 'owned' && !doneKeys.has(k)), [soldKeys, info, doneKeys])
  const pendingHad = useMemo(() => soldKeys.filter(k => info.get(k)?.way === 'had' && !doneKeys.has(k)), [soldKeys, info, doneKeys])
  const pending = pendingBought.length + pendingSales.length + pendingHad.length
  const wishesLeft = boughtKeys.filter(k => info.get(k)?.wish && !doneKeys.has(k)).length

  /** The line (a bought one) whose thing has this id, now or as saved. */
  const boughtKeyOfId = (id: string, w: Written): string | undefined => boughtKeys.find(k => (w.created.find(c => c.key === k)?.id ?? info.get(k)?.wish?.id ?? w.wishes[k]?.id) === id)
  const soldKeyOfId = (id: string): string | undefined => soldKeys.find(k => info.get(k)?.thingId === id)
  /** The pairs a write of this line settles: the planned first link of a sold line, or the paid-from of a bought one — whatever was really saved. */
  const plannedPairs = (k: string): string[] => {
    const first = plan.first.get(k)
    const src = plan.paidFrom.get(k)
    return [first ? pairKey(k, first) : '', src ? pairKey(src, k) : ''].filter(Boolean)
  }
  const handle = (w: Written, pairs: string[]): Written => ({ ...w, handled: [...new Set([...w.handled, ...pairs])] })
  const pairOf = (w: Written, soldKey: string | undefined, boughtId: string | null | undefined): string[] => {
    const b = soldKey && boughtId ? boughtKeyOfId(boughtId, w) : undefined
    return soldKey && b ? [pairKey(soldKey, b)] : []
  }

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
        const next: Written = { ...w, created: [...w.created.filter(c => c.key !== key), { key, id: row.id, label: row.title, had, state }] }
        const actual = [
          ...(state.paidFrom ? pairOf(next, soldKeyOfId(state.paidFrom), row.id) : []),
          ...(state.moneyTo && had ? pairOf(next, key, state.moneyTo) : []),
        ]
        return handle(next, [...plannedPairs(key), ...actual])
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
      kind: 'shop-sell', id: i.thingId, sale: { ...saleFor(i.m.read, i.m.line, stores), ...(lastSale[k] ?? {}), ...(moneyTo ? { moneyTo } : {}) },
      onSold: done => {
        setLastSale(l => ({ ...l, [k]: { ...(done.amount != null ? { amount: done.amount } : {}), currency: done.currency, day: done.on, how: done.how, ...(done.soldTo ? { to: done.soldTo } : {}) } }))
        setWritten(w => {
          const next: Written = { ...w, sales: [...w.sales.filter(s => s.key !== k), { key: k, id: done.id, label: items.find(t => t.id === done.id)?.title ?? labelOf(i.m), done }] }
          return handle(next, [...plannedPairs(k), ...(done.to ? pairOf(next, k, done.to) : [])])
        })
      },
    })
  }

  const buying = useRef<{ key: string; fill: ReceiptFill; read: ReceiptRead; row: ShopItem } | null>(null)
  const buyNow = useBuyNow(id => {
    const b = buying.current
    if (!b) return
    setWritten(w => ({ ...w, wishes: { ...w.wishes, [b.key]: { id, row: b.row } } }))
    modal.open({ kind: 'shop-just-bought', id, receipt: { fill: b.fill, read: b.read } })
  }, { thenDetails: true })
  function buyWish(k: string) {
    const i = info.get(k) as LineInfo
    if (!i.wish) return
    buying.current = { key: k, fill: addFillFor(i.m.read, i.m.index, stores), read: i.m.read, row: i.wish }
    buyNow(i.wish)
  }

  /** The primary button: the next save, in the order that has every id it needs. */
  function go() {
    if (pendingBought.length) stepper(pendingBought)
    else if (pendingSales.length) openSale(pendingSales[0])
    else if (pendingHad.length) stepper(pendingHad)
  }

  // The ends of every ticked pair, and which pairs are linked in the live data now.
  const idMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const k of keys) { const id = idOf(k); if (id && (info.get(k)?.side === 'bought' || doneKeys.has(k) || info.get(k)?.way === 'in-app')) m.set(k, id) }
    return m
  }, [keys, idOf, info, doneKeys])
  const linkSet = useMemo(() => new Set(links.map(l => `${l.from_id}>${l.to_id}`)), [links])
  const pairLinked = useCallback((s: string, b: string): boolean => { const f = idOf(s), t = idOf(b); return !!f && !!t && linkSet.has(`${f}>${t}`) }, [idOf, linkSet])
  const linkedCount = useMemo(() => [...allTicks].reduce((n, [s, set]) => n + [...set].filter(b => pairLinked(s, b)).length, 0), [allTicks, pairLinked])

  // Once nothing is left to save, the links no write made are made: one toast, one Undo (exactly these links). A pair is tried once.
  const tried = useRef(new Set<string>())
  const toLink = useMemo(() => linksToMake(allTicks, idMap, new Set(written.handled), links), [allTicks, idMap, written.handled, links])
  const anyWrite = live.created.length + live.sales.length + Object.keys(live.wishes).length > 0
  useEffect(() => {
    if (pending > 0 || !anyWrite || linker.isPending) return
    const fresh = toLink.make.filter(l => !tried.current.has(pairKey(l.soldKey, l.boughtKey)))
    if (!fresh.length) return
    for (const l of fresh) tried.current.add(pairKey(l.soldKey, l.boughtKey))
    linker.mutate(fresh.map(l => ({ from_id: l.from_id, to_id: l.to_id })), {
      onSuccess: r => setWritten(w => ({ ...w, links: [...w.links, ...r.made], handled: [...new Set([...w.handled, ...fresh.map(l => pairKey(l.soldKey, l.boughtKey))])] })),
    })
  }, [pending, anyWrite, toLink, linker])
  const linkNote = pending === 0 && toLink.missing > 0 && anyWrite
    ? `${toLink.missing} ${toLink.missing === 1 ? 'link was' : 'links were'} not made: a line it needs was not saved.` : null

  const restoreRows = useMutationWithFeedback({
    action: 'restore_receipt_session',
    successMessage: 'Put back',
    mutationFn: async (snapshot: ShopSnapshot) => { await restoreShopItems(snapshot) },
    invalidates: [...SHOP_ROWS],
  })
  const undo = useMutationWithFeedback<{ snapshot: ShopSnapshot | null; skipped: number }, void>({
    action: 'undo_receipt_session',
    silent: 'its toast says what was taken back, with an Undo for the things it deleted',
    mutationFn: async () => {
      const now = latest.current.items
      let skipped = 0
      // Newest sale first. A sale is taken back only while the row still looks like the one this popup made; a stale one is left, the rest goes on.
      for (const s of [...live.sales].reverse()) {
        const it = now.find(t => t.id === s.id)
        const same = !!it && it.disposal === s.done.how && it.disposed_on === s.done.on && (!(s.id in groupSeen.current) || groupSeen.current[s.id] === (it.sale_group ?? null))
        if (!same) { skipped++; continue }
        try { await undoSale(s.id) } catch { skipped++ }
      }
      await deleteShopLinks(live.links)
      const exist = live.created.map(c => c.id).filter(id => now.some(t => t.id === id))
      const snapshot = exist.length ? await deleteShopItems(exist) : null
      // The wishes bought here go back on the list the way "Bought" puts one back.
      for (const w of Object.values(live.wishes)) await update.mutateAsync({ id: w.id, patch: { status: 'wishlist' }, quiet: true, row: w.row })
      return { snapshot, skipped }
    },
    invalidates: [...SHOP_ROWS],
  })
  async function undoAll() {
    const wishCount = Object.keys(live.wishes).length
    if (live.sales.length + live.created.length + live.links.length + wishCount === 0) return
    const ok = await modal.confirm({
      title: 'Undo all from these receipts?',
      message: `Takes back ${live.sales.length} ${live.sales.length === 1 ? 'sale' : 'sales'}, ${live.links.length} ${live.links.length === 1 ? 'link' : 'links'}${wishCount ? `, ${wishCount} ${wishCount === 1 ? 'wish' : 'wishes'} you bought here` : ''} and removes the ${live.created.length} ${live.created.length === 1 ? 'thing' : 'things'} added here. Then the things you added open again, filled in, to edit, and Sell starts with what you typed.`,
      confirmLabel: 'Undo all', destructive: true,
    })
    if (!ok) return
    const redo = live.created
    let result: { snapshot: ShopSnapshot | null; skipped: number }
    try { result = await undo.mutateAsync() } catch { return }
    tried.current = new Set()
    setWritten(EMPTY)
    const n = result.snapshot?.items.length ?? 0
    const words = `Taken back${n ? ` · ${n} ${n === 1 ? 'thing' : 'things'} deleted` : ''}${result.skipped ? ` · ${result.skipped} ${result.skipped === 1 ? 'sale' : 'sales'} left as ${result.skipped === 1 ? 'it' : 'they'} changed` : ''}`
    if (result.snapshot && n) {
      const snapshot = result.snapshot
      toast.undo(words, () => restoreRows.mutate(snapshot))
    } else toast.success(words)
    // The drafts as they were saved, without the money links (their things are gone).
    stepper(redo.map(c => c.key), redo.map(c => ({ ...c.state, paidFrom: '', moneyTo: '' })))
    void qc.invalidateQueries({ queryKey: qk.shop.links() })
  }

  const firstLinked = live.sales[0]?.id ?? live.created.find(c => c.had)?.id ?? [...inApp].map(k => info.get(k)?.thingId).find(Boolean) ?? null
  return {
    info, keys, soldKeys, boughtKeys, mine, soldInApp, plan, suggestion, ticksOf, toggleTarget, pairLinked,
    setSide: (k: string, s: ReceiptSide) => setSides(x => ({ ...x, [k]: s })),
    setIncluded: (k: string, v: boolean) => setTicks(x => ({ ...x, [k]: v })),
    setPick: (k: string, id: string) => setPicked(x => ({ ...x, [k]: id })),
    live, doneKeys, pending, wishesLeft, go, openSale, openHad: (k: string) => stepper([k]), buyWish,
    undoAll, undoing: undo.isPending, linking: linker.isPending, linkNote, linkedCount,
    /** The thing whose chain "Open the chain" shows: the first sold thing of this session. */
    chainId: linkedCount > 0 ? firstLinked : null,
  }
}
