import { ExternalLink, Search } from 'lucide-react'
import { Button, Truncate } from '../../../../shared/ui'
import { findItLinks, type StoreRow } from '../../autofillModel'

/**
 * "Find it": search links that open in Safari — each store's own search with the words, its whole address shown
 * before it is opened (every outgoing link shows where it goes). The words are the brand and model code, the
 * title, or after a scan that found nothing the barcode's digits (autofillModel.searchWords).
 */
export function FindIt({ stores, words, open, onOpen }: {
  stores: readonly StoreRow[]
  words: string
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const links = findItLinks(stores, words)
  if (!words || !links.length) return null
  return (
    <div>
      <Button size="sm" variant="ghost" icon={<Search />} aria-expanded={open} onClick={() => onOpen(!open)} className="-ml-2">
        Find it
      </Button>
      {open && (
        <div className="mt-1 rounded-row border border-line p-2.5" data-testid="shop-find-it">
          <p className="mb-1 flex min-w-0 gap-1 text-meta text-fg-muted">
            <span className="shrink-0">Searching for</span><Truncate className="min-w-0 font-medium text-fg-2">{`“${words}”`}</Truncate>
          </p>
          <ul className="flex flex-col gap-1.5">
            {links.map(({ store, url }) => (
              <li key={store.id}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2 rounded-control py-1">
                  <ExternalLink aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-fg group-hover:underline">{store.name}</span>
                    <span className="block break-all text-meta text-fg-muted">{url}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-meta text-fg-muted">Found it? Copy the product's link and paste it above.</p>
        </div>
      )}
    </div>
  )
}
