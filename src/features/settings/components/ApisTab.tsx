import { useMemo, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { PageBoard } from '../../../shared/ui'
import { EmptyState } from '../../../shared/components/EmptyState'
import { API_REGISTRY, categoryCounts, filterApis, type ApiCategory } from '../apiRegistry'
import { APIS_BOARD, type ApisSection } from '../settingsBoards'
import { ApiCard } from './ApiCard'

// Settings → Integrations and APIs: every external API or service the app talks to (the static
// registry in apiRegistry.ts). Connection status stays on Subscriptions; cards
// that have one link there.

const COUNTS = categoryCounts(API_REGISTRY)

export function ApisTab() {
  const [picked, setPicked] = useState<ApiCategory[]>([])
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterApis(API_REGISTRY, picked, query), [picked, query])

  const toggle = (c: ApiCategory) =>
    setPicked(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]))

  const toolbar = (
    <div className="flex flex-col gap-3">
      <label className="relative block w-full max-w-md">
        <span className="sr-only">Search APIs</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, function, secret, table…" className="input min-h-[44px] w-full pl-9" />
      </label>
      <div role="group" aria-label="Filter by category" className="scroll-x -mx-4 flex gap-1 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <button type="button" className="pill-tab" aria-pressed={picked.length === 0} onClick={() => setPicked([])}>
          All <span className="tabular-nums opacity-70">{API_REGISTRY.length}</span>
        </button>
        {COUNTS.map(({ category, count }) => (
          <button key={category} type="button" className="pill-tab" aria-pressed={picked.includes(category)} onClick={() => toggle(category)}>
            {category} <span className="tabular-nums opacity-70">{count}</span>
          </button>
        ))}
      </div>
      <p className="text-meta text-fg-muted" aria-live="polite">
        {shown.length === API_REGISTRY.length ? `${shown.length} APIs and services` : `${shown.length} of ${API_REGISTRY.length} APIs`}
      </p>
    </div>
  )

  const list = shown.length === 0 ? (
    <EmptyState bordered icon={<Search />} title="No API matches"
      description="Try another word, or clear the filters."
      action={(
        <button type="button" className="btn-secondary min-h-[44px]" onClick={() => { setPicked([]); setQuery('') }}>
          <X aria-hidden className="h-4 w-4" /> Clear filters
        </button>
      )} />
  ) : (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),22rem))] justify-start gap-3 sm:gap-4">
      {shown.map(api => <li key={api.id} className="flex min-w-0"><ApiCard api={api} /></li>)}
    </ul>
  )

  const sections: Record<ApisSection, ReactNode> = { toolbar, list }
  return <PageBoard sections={sections} layout={APIS_BOARD} />
}
