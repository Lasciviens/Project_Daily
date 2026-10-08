import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals'
import { Button } from '../../../../shared/ui'
import { NO_SCOPE, scopeActive, toggleScope, type ScopeSection, type StatsScope } from '../../statsModel'
import { filterThingOptions, type ScopeOptions } from './statsScopeOptions'
import { ScopeChecklist } from './ScopeChecklist'
import { plural } from './statsFormat'

/**
 * The Stats screen's top filter: categories, money chains, things and stores.
 * Any pick inside a section will do; every section with picks must match.
 * Each tap applies at once (the screen behind follows).
 */
export function StatsScopeSheet({ open, onClose, scope, options, onChange, matching }: {
  open: boolean; onClose: () => void; scope: StatsScope; options: ScopeOptions; onChange: (s: StatsScope) => void
  /** Things the picks leave. */
  matching: number
}) {
  const [query, setQuery] = useState('')
  const active = scopeActive(scope)
  const things = useMemo(() => filterThingOptions(options.things, query), [options.things, query])
  const props = (section: ScopeSection) => ({
    picked: scope[section],
    onToggle: (key: string) => onChange(toggleScope(scope, section, key)),
    onClear: () => onChange({ ...scope, [section]: [] }),
  })
  return (
    <ModalShell
      open={open} onClose={onClose} size="md" title="Filter Stats" subtitle="Every number on the screen follows"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => onChange(NO_SCOPE)} disabled={!active}>Clear filters</Button>
          <span aria-live="polite" className="ml-auto text-meta tabular-nums text-fg-muted">{active ? `${plural(matching, 'thing')} match` : `All ${plural(matching, 'thing')}`}</span>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="px-1 text-meta text-fg-muted">Any pick inside a section counts; picks in different sections must all match.</p>
        <ScopeChecklist title="Categories" note="A category takes its subcategories along; accessories follow their item." options={options.categories} {...props('categories')} />
        {options.chains.length > 0 && <ScopeChecklist title="Money chains" note="Every thing in the chain, with its accessories." options={options.chains} {...props('chains')} />}
        <ScopeChecklist title="Things" note="A thing takes its accessories along." options={things} cap={query ? undefined : 10} noun="things" empty={query ? 'No thing matches.' : undefined} {...props('things')}>
          <label className="relative block max-w-md">
            <span className="sr-only">Search things</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search things" className="input pl-9" />
          </label>
        </ScopeChecklist>
        {options.stores.length > 0 && <ScopeChecklist title="Stores" options={options.stores} cap={8} noun="stores" {...props('stores')} />}
      </div>
    </ModalShell>
  )
}
