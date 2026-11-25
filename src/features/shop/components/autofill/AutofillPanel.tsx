import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, ScanBarcode } from 'lucide-react'
import { Button, IconButton } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { logError } from '../../../../shared/utils/logError'
import { BarcodeScanner } from '../../../recipes/components/BarcodeScanner'
import { readPriceLink } from '../../api/shopPriceApi'
import { useShopItems } from '../../hooks/useShop'
import { useShopStores } from '../../hooks/useShopStores'
import { useGroceryByEan } from '../../hooks/useGrocery'
import { ean13 } from '../../productFacts'
import { storeNames } from '../../shopModel'
import { readNote } from '../../watchWords'
import { useProductPicture } from '../../hooks/useProductPicture'
import { pictureFact } from '../../productPicture'
import { photoFacts } from '../../photoFacts'
import type { PhotoDraft } from '../../../ai/claude/photoProductRules'
import {
  duplicatesOf, editFact, factKept, factsFromRead, factsFromScan, factsFromTitle, fieldsAfter, mergeFacts, ownWithEan,
  ownedWords, searchWords, storeRowsOf, toggleFact, type Fact, type FactKey, type FactOrigin,
} from '../../autofillModel'
import type { ShopCategory, ShopItem } from '../../types'
import type { ShopDraft } from '../ShopItemForm'
import { FactList } from './FactList'
import { FindIt } from './FindIt'
import { MaybeYours } from './MaybeYours'
import { PhotoAskButton, ProductPhotoPanel } from './ProductPhotoStep'
import type { PhotoTarget, ProductPhotoStep } from './useProductPhotoStep'
import { useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../../shared/query'
import { lookUpGroceryEan } from '../../api/groceryApi'

/** A change of the draft worked out from the draft as it is when it lands (a read or a lookup answers later). */
export type DraftUpdate = (update: (d: ShopDraft) => Partial<ShopDraft>) => void

/** A scanned code: its EAN when its check digit holds, and the owner's own things with it. */
interface Scan { code: string; ean: string | null; mine: ShopItem[] }

/** How long typing rests before the owner's history is asked about the title. */
const TITLE_REST_MS = 500

/**
 * The add sheet's autofill (lazy: its own chunk): a link, a barcode or the title fills the facts, each with its
 * source and confidence (autofillModel). A link is read by shop-price (the page's own data, once an hour at most);
 * a barcode asks the owner's own things first ("You already have this" — and opens it), then groceries, and for
 * anything else offers "Find it" with its digits; a title asks only the owner's own history. Possible duplicates
 * are named, never a block on Add.
 */
export default function AutofillPanel({ draft, onChange, update, categories, collapsible = false, selfId, savedTitle, photo }: {
  draft: ShopDraft
  onChange: (patch: Partial<ShopDraft>) => void
  update: DraftUpdate
  categories: readonly ShopCategory[]
  /** The "Filled in for you" list folds to one line (a narrow screen). */
  collapsible?: boolean
  /** A saved thing's own id (the open record): it is never its own duplicate, nor its own history. */
  selfId?: string
  /** A saved thing's title as saved: its history is asked only once the owner changes it. */
  savedTitle?: string
  /**
   * 📷✨ (a thing from photos): the body's one step (RecordBody holds it), the target this panel fills for it, and whether the
   * button and the step show in this row (a wide add, an open record) or in the body's top line (a narrow add) — one place.
   */
  photo?: { step: ProductPhotoStep; setTarget: (t: PhotoTarget | null) => void; inRow: boolean } | null
}) {
  const { data: allItems = [] } = useShopItems()
  const items = useMemo(() => (selfId ? allItems.filter(i => i.id !== selfId) : allItems), [allItems, selfId])
  const { data: storeRows } = useShopStores()
  // The stores and marketplaces are rows (191): a link's store and "Find it"'s search links come from them.
  const stores = useMemo(() => storeRowsOf(storeRows ?? []), [storeRows])
  const modal = useEntityModal()
  const [reading, setReading] = useState(false)
  const [linkNote, setLinkNote] = useState<string | null>(null)
  const [readFor, setReadFor] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  const [last, setLast] = useState<'link' | 'scan' | null>(null)
  // null: "Find it" opens by itself after a scan that found nothing; a tap decides from then on.
  const [findOpen, setFindOpen] = useState<boolean | null>(null)
  const lookup = useGroceryByEan(scan && scan.ean && !scan.mine.length ? scan.ean : null)

  const addFacts = useCallback((origin: FactOrigin, incoming: Fact[]) => {
    update(d => {
      const facts = mergeFacts(d.facts, origin, incoming)
      return { facts, ...fieldsAfter(d, d.facts, facts) }
    })
  }, [update])

  // The title's facts from the owner's own history, once typing rests — on a saved thing only once its title was changed:
  // opening a record never fills anything by itself (a record's Bought saves its draft first).
  const title = draft.title
  useEffect(() => {
    if (selfId && title === savedTitle) return
    const t = window.setTimeout(() => addFacts('title', factsFromTitle(title, items, categories, new Date().toISOString())), TITLE_REST_MS)
    return () => window.clearTimeout(t)
  }, [title, items, categories, addFacts, selfId, savedTitle])

  // A grocery found for the scanned barcode fills its name, brand and picture (Kassalapp).
  useEffect(() => {
    if (scan?.ean && !scan.mine.length && lookup.isSuccess) addFacts('scan', factsFromScan(scan.ean, lookup.data ?? null, new Date().toISOString()))
  }, [scan, lookup.isSuccess, lookup.data, addFacts])

  /** Reads a link (free); resolves with what the read says, or null when nothing was read (not a link, or read just now). */
  async function read(u = draft.url.trim(), again = false): Promise<string | null> {
    if (!/^https?:\/\//i.test(u) || (!again && u === readFor)) return null
    setReading(true); setLinkNote(null); setReadFor(u); setLast('link'); setFindOpen(null)
    try {
      const r = await readPriceLink(u)
      const said = readNote(r)
      setLinkNote(said)
      addFacts('link', factsFromRead(r, stores, storeNames(items), new Date().toISOString()))
      return said ?? 'read — check the facts below.'
    } catch (e) {
      setLinkNote((e as Error).message)
      logError(`shop_read_link: ${(e as Error).message}`, { action: 'shop_read_link' })
      return (e as Error).message
    } finally { setReading(false) }
  }

  // Stable while the camera runs (BarcodeScanner restarts it when this changes): the latest things come from a ref.
  const latest = useRef({ items, addFacts, modal, image: draft.image })
  useEffect(() => { latest.current = { items, addFacts, modal, image: draft.image } }, [items, addFacts, modal, draft.image])
  const onDetected = useCallback((code: string) => {
    setScanOpen(false); setLast('scan'); setFindOpen(null)
    const ean = ean13(code)
    const mine = ean ? ownWithEan(ean, latest.current.items) : []
    setScan({ code, ean, mine })
    if (!ean) return
    latest.current.addFacts('scan', factsFromScan(ean, null, new Date().toISOString()))
    // The owner's own thing comes first: said, and opened over the sheet.
    if (mine.length) latest.current.modal.open({ kind: 'shop-item', id: mine[0].id })
  }, [])

  // 📷✨ (owner, 25.11.2026): the AI's draft lands as facts "photo + AI" — never over what was typed — and its product page, read
  // through shop-price like a receipt line's, gives the picture while the field is empty. Code first: a link or a barcode number
  // typed beside the photos goes to the link reader or the barcode lookup, with no AI call.
  const readPicture = useProductPicture()
  const [pictureNote, setPictureNote] = useState<string | null>(null)
  const onPhotoDraft = useCallback((d: PhotoDraft, callId: string | null) => {
    setPictureNote(null); setLast(null)
    latest.current.addFacts('photo', photoFacts(d, categories, new Date().toISOString(), callId))
    if (!d.page_urls?.length || latest.current.image) return
    void readPicture(d.page_urls, d.name ?? [d.brand, d.model].filter(Boolean).join(' '), d.page_named === true).then(p => {
      const fact = pictureFact(p, new Date().toISOString())
      if (fact && !latest.current.image) latest.current.addFacts('page', [fact])
      else if (!fact) setPictureNote(p.note)
    })
  }, [categories, readPicture])
  // The step's target while this panel is mounted: the draft, a link and a barcode go through this panel's own facts, link
  // reader and barcode lookup (the same ones the owner's own paste and Scan use).
  const qc = useQueryClient()
  const readRef = useRef(read)
  useEffect(() => { readRef.current = read })
  const setTarget = photo?.setTarget
  useEffect(() => {
    if (!setTarget) return
    setTarget({
      fill: onPhotoDraft,
      readLink: async u => { onChange({ url: u }); return (await readRef.current(u, true)) ?? 'nothing to read there.' },
      lookupEan: async code => {
        onDetected(code)
        const ean = ean13(code)
        if (!ean) return { filled: false, note: `${code} isn't a product barcode (EAN).` }
        if (ownWithEan(ean, latest.current.items).length) return { filled: true, note: 'you already have this — it is open.' }
        try {
          const hit = await qc.fetchQuery({ queryKey: qk.shop.groceryEan(ean), queryFn: () => lookUpGroceryEan(ean), staleTime: STALE.hour, retry: false })
          return hit ? { filled: true, note: `Kassalapp knows ${ean} — check the facts below.` } : { filled: false, note: `No product found for ${ean}.` }
        } catch (e) { return { filled: false, note: `${(e as Error).message}.` } }
      },
    })
    return () => setTarget(null)
  }, [setTarget, onPhotoDraft, onDetected, onChange, qc])

  const looking = !!scan?.ean && !scan.mine.length && lookup.isFetching
  const lookedUp = !!scan?.ean && !scan.mine.length && !lookup.isFetching && (lookup.isSuccess || lookup.isError)
  const failedScan = scan && (!scan.ean || (lookedUp && !lookup.data)) ? scan.ean ?? scan.code : null
  const scanNote = !scan ? null
    : !scan.ean ? `${scan.code} isn't a product barcode (EAN) — search for it below.`
    : scan.mine.length ? null
    : looking ? `Looking up ${scan.ean}…`
    : lookup.isError ? `${(lookup.error as Error).message} — search for ${scan.ean} below.`
    : lookedUp && lookup.data ? `Kassalapp knows ${scan.ean} — check the facts below.`
    : lookedUp ? `No product found for ${scan.ean} — search for it in a store below.`
    : null
  const note = last === 'scan' ? scanNote : last === 'link' ? linkNote : null

  const kept = (key: FactKey) => draft.facts.find(f => f.key === key && factKept(f, draft))
  const mineIds = new Set((scan?.mine ?? []).map(i => i.id))
  const keptEan = kept('ean')?.value as string | undefined
  const keptPj = kept('prisjaktId')?.value as string | undefined
  const duplicates = useMemo(
    () => duplicatesOf({ title: draft.title, ean: keptEan ?? null, prisjaktId: keptPj ?? null, url: draft.url }, items),
    [draft.title, draft.url, keptEan, keptPj, items],
  ).filter(d => !mineIds.has(d.item.id))
  const words = searchWords(draft.facts, draft, failedScan)

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor="shop-link" className="field-label">Link <span className="font-normal normal-case tracking-normal text-fg-muted">(optional — Prisjakt or a shop)</span></label>
        <div className="flex max-w-xl gap-2">
          <input id="shop-link" type="url" inputMode="url" value={draft.url} onChange={e => onChange({ url: e.target.value })}
            onPaste={e => { const t = e.clipboardData.getData('text').trim(); if (/^https?:\/\//i.test(t)) setTimeout(() => { void read(t) }, 0) }}
            onBlur={() => { void read() }} placeholder="Paste a link" title="Paste a link to fill the rest" className="input min-w-0 flex-1" />
          <Button icon={<Link2 />} onClick={() => { setReadFor(''); void read() }} loading={reading} disabled={!draft.url.trim()}>Read</Button>
          <IconButton bordered label="Scan a barcode" onClick={() => setScanOpen(true)} disabled={looking} aria-busy={looking || undefined}>
            {looking
              ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              : <ScanBarcode aria-hidden />}
          </IconButton>
          {photo?.inRow && <PhotoAskButton step={photo.step} />}
        </div>
        {note && <p className="mt-1 text-meta text-fg-muted" role="status">{note}</p>}
      </div>
      {photo?.inRow && <ProductPhotoPanel step={photo.step} />}
      {pictureNote && <p className="text-meta text-fg-muted" role="status">{pictureNote}</p>}
      {scan && scan.mine.length > 0 && <MaybeYours duplicates={scan.mine.slice(0, 1).map(item => ({ item, by: 'ean' }))} lead={ownedWords(scan.mine[0])} />}
      <MaybeYours duplicates={duplicates} />
      <FactList facts={draft.facts} fields={draft} collapsible={collapsible}
        onToggle={key => update(d => { const t = toggleFact(d.facts, key, d); return { facts: t.facts, ...t.fields } })}
        onEdit={(key, text) => update(d => ({ facts: editFact(d.facts, key, text, new Date().toISOString()) }))} />
      <FindIt stores={stores} words={words} open={findOpen ?? !!failedScan} onOpen={setFindOpen} />
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={onDetected} />
    </div>
  )
}
