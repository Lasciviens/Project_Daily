import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { Plus, ScanBarcode } from 'lucide-react'
import { Button, Card, IconButton } from '../../../../shared/ui'
import { toast } from '../../../../app/store'
import { BarcodeScanner } from '../../../recipes/components/BarcodeScanner'
import { useCreateShopItem, useScanAdd } from '../../hooks/useShop'
import { scanEan, scanMatch } from '../../groceryModel'
import { quickAddInput } from '../../shopModel'
import { useScanLookup } from '../../hooks/useGrocery'

/**
 * Always visible; only the item clears after Add, so a run of things for one
 * store goes in quickly ("Tape" is three taps). A scanned barcode adds its
 * product with its EAN, so it is priced at once, and its toast names it with
 * Undo. "No rush" is a quiet extra
 * that resets after each add — it is the exception, not the store's mode.
 */
export function QuickAdd({ stores }: { stores: readonly string[] }) {
  const id = useId()
  const { mutate: addRow, isPending } = useCreateShopItem()
  const lookUp = useScanLookup()
  const { add: addScanned } = useScanAdd()
  const [title, setTitle] = useState('')
  const [store, setStore] = useState('')
  const [noRush, setNoRush] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [looking, setLooking] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    addRow({ input: quickAddInput({ title, store, noRush }), quiet: true }, {
      onSuccess: () => { setTitle(''); setNoRush(false); input.current?.focus() },
    })
  }

  // Stable while the camera runs: BarcodeScanner restarts it whenever this changes.
  const onDetected = useCallback((code: string) => {
    setScanOpen(false)
    // Only an EAN (8–14 digits) is looked up; anything else never reaches Kassalapp.
    if (!scanEan(code)) { toast.warning('That isn’t a product barcode (EAN) — try the barcode on the pack'); return }
    setLooking(true)
    lookUp(code)
      .then(found => {
        // The answer must carry the scanned EAN (leading zeros aside), never just any product.
        const hit = scanMatch(found ? [found] : [], code)
        if (!hit) { toast.warning(`No product found for barcode ${code}`); return }
        // Named in its toast, with Undo: a scan adds a row the owner didn't type.
        return addScanned(`scan:${hit.ean}`, quickAddInput({ title: hit.name, store, noRush, ean: hit.ean, image: hit.image }))
          .then(added => { if (added) setNoRush(false) })
      })
      .catch((e: Error) => toast.error(e.message || `Couldn't look up barcode ${code}`))
      .finally(() => setLooking(false))
  }, [lookUp, addScanned, store, noRush])

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={`${id}-title`} className="field-label">Add to the quick list</label>
        <div className="flex max-w-md gap-2">
          <input ref={input} id={`${id}-title`} value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Milk, batteries, a gift card…" className="input min-w-0 flex-1" enterKeyHint="done" />
          <IconButton bordered label="Scan a barcode" onClick={() => setScanOpen(true)} disabled={looking} aria-busy={looking || undefined}>
            {looking
              ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              : <ScanBarcode aria-hidden />}
          </IconButton>
          <Button type="submit" variant="primary" icon={<Plus />} loading={isPending} disabled={!title.trim()} aria-label="Add">
            <span className="max-sm:hidden">Add</span>
          </Button>
        </div>
        <div className="flex max-w-md items-center gap-2">
          <input list={`${id}-stores`} value={store} onChange={e => setStore(e.target.value)} aria-label="Store (optional)"
            placeholder="Store (optional)" title="Kept for the next item, so a run for one shop goes in quickly" className="input min-w-0 flex-1" />
          <label className="flex min-h-[44px] shrink-0 cursor-pointer select-none items-center gap-2 pl-1 pr-0.5 text-body text-fg-muted"
            title="Sorted last in its store and left off Daily">
            <input type="checkbox" checked={noRush} onChange={e => setNoRush(e.target.checked)} className="h-4 w-4 accent-accent-500" />
            No rush
          </label>
        </div>
        <datalist id={`${id}-stores`}>{stores.map(s => <option key={s} value={s} />)}</datalist>
      </form>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={onDetected} />
    </Card>
  )
}
