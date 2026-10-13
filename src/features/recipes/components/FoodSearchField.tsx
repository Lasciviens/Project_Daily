import { useState } from 'react'
import { Camera, Globe, Search } from 'lucide-react'
import { IconButton, cx } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { lookupBarcode, type BarcodeProduct } from '../api/openFoodFactsApi'
import { BarcodeScanner } from './BarcodeScanner'
import { OnlineFoodSearch } from './OnlineFoodSearch'
import type { IngredientLibraryItem } from '../types'

/**
 * The food search of the logger and the recipe builder: one box (sticky at
 * the top of the popup body) with Scan barcode and Search online beside it.
 * A scanned code already in your foods comes back as `onExisting`; a new
 * product or an online pick as `onProduct`, for review before it's saved.
 */
export function FoodSearchField({ query, onQuery, library, onExisting, onProduct, placeholder = 'Search food…', stickyClassName }: {
  query: string
  onQuery: (q: string) => void
  library: readonly IngredientLibraryItem[]
  onExisting: (food: IngredientLibraryItem) => void
  onProduct: (p: BarcodeProduct) => void
  placeholder?: string
  /** Extra classes on the sticky bar (e.g. less top padding under a field above it). */
  stickyClassName?: string
}) {
  const [scanOpen, setScanOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [onlineOpen, setOnlineOpen] = useState(false)

  async function handleBarcode(code: string) {
    setScanOpen(false); setScanning(true)
    const tid = toast.loading('Looking up barcode…')
    try {
      const p = await lookupBarcode(code)
      toast.dismiss(tid)
      if (!p) { toast.error('Product not found in Open Food Facts'); return }
      // The same product by barcode first (names differ between sources), then by name.
      const existing = library.find(i => i.source_ref === code)
        ?? library.find(i => i.name.trim().toLowerCase() === p.name.trim().toLowerCase())
      if (existing) { onExisting(existing); toast.success(`${p.name} — already in your library`); return }
      onProduct(p)
      toast.success(`Found: ${p.name} — review & add`)
    } catch {
      toast.dismiss(tid); toast.error('Barcode lookup failed')
    } finally { setScanning(false) }
  }

  return (
    <>
      {/* Sticky so it never scrolls away from the results. */}
      <div className={cx('sticky top-0 z-[1] -mx-4 bg-surface px-4 pb-1 pt-3', stickyClassName)}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
          <input
            value={query}
            onChange={e => onQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Search food"
            className="input min-h-[48px] pl-10 pr-24"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
            <IconButton label="Scan barcode" onClick={() => setScanOpen(true)} disabled={scanning}><Camera /></IconButton>
            <IconButton label="Search online" onClick={() => setOnlineOpen(o => !o)} aria-pressed={onlineOpen}
              className={cx(onlineOpen && 'bg-accent-50 text-accent-700')}><Globe /></IconButton>
          </div>
        </div>
      </div>

      {onlineOpen && (
        <div className="rounded-card border border-accent-500/25 bg-accent-50 p-3">
          <OnlineFoodSearch initialQuery={query} onPick={p => { onProduct(p); setOnlineOpen(false) }} />
        </div>
      )}

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />
    </>
  )
}
