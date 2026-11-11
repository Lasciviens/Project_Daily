import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ArrowUpRight, Search } from 'lucide-react'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useSavePurchase } from '../../hooks/usePurchase'
import { shownAddress, type MarketSearch } from '../../purchaseModel'
import type { ShopItem } from '../../types'

/** One marketplace's search: a tap shows the address first; Open goes there (the app never fetches it) and notes the day. */
function SearchButton({ search, onOpened }: { search: MarketSearch & { url: string }; onOpened: () => void }) {
  return (
    <Popover className="relative">
      <PopoverButton className="btn-secondary btn-sm gap-1.5">
        <Search aria-hidden className="h-4 w-4" /> Look on {search.store.name}
      </PopoverButton>
      <PopoverPanel anchor={{ to: 'bottom start', gap: 4, padding: 12 }} transition
        className="menu z-toast w-[min(22rem,calc(100vw-2rem))] p-3 transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        {({ close }) => (
          <div className="flex flex-col gap-2">
            <p className="text-meta text-fg-muted">Opens {search.store.name}'s own search — the app doesn't read it:</p>
            <p className="break-all rounded-row bg-surface-2 px-2 py-1.5 font-mono text-meta text-fg-2">{shownAddress(search.url)}</p>
            <a href={search.url} target="_blank" rel="noopener noreferrer" onClick={() => { onOpened(); close() }}
              className="btn-primary btn-sm w-fit gap-1">
              Open <ArrowUpRight aria-hidden className="h-4 w-4" />
            </a>
          </div>
        )}
      </PopoverPanel>
    </Popover>
  )
}

/**
 * The record's Used market section — "Look on FINN / Tise": a search built from the thing's name through each
 * marketplace's own search link (searchLinkFor: https, on its own host). The address shows before it opens, it is
 * never fetched, and the wish notes the day ("Search opened 10.11.2026"; the app can't know what the search
 * finds — save it in their app).
 */
export function LookElsewhere({ item, today, searches }: { item: ShopItem; today: string; searches: readonly MarketSearch[] }) {
  const save = useSavePurchase()
  const ready = searches.filter((s): s is MarketSearch & { url: string } => s.url !== null)
  const missing = searches.filter(s => s.url === null).map(s => s.store.name)
  const opened = () => {
    if (item.search_opened_on === today) return
    save.mutate({ id: item.id, patch: { search_opened_on: today }, done: `Search opened ${formatDate(today)}` })
  }
  return (
    <div className="flex flex-col gap-2">
      {item.search_opened_on && <p className="text-meta tabular-nums text-fg-muted">Search opened {formatDate(item.search_opened_on)}</p>}
      {ready.length > 0 && <div className="flex flex-wrap gap-1.5">{ready.map(s => <SearchButton key={s.store.id} search={s} onOpened={opened} />)}</div>}
      {missing.length > 0 && (
        <p className="text-meta text-fg-muted">
          {missing.join(' and ')} {missing.length === 1 ? 'has' : 'have'} no search link yet — add one in Stores and rules (the Shop's ⋯).
        </p>
      )}
    </div>
  )
}
