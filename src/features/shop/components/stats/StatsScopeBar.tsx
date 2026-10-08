import { SlidersHorizontal, X } from 'lucide-react'
import { Button, Truncate } from '../../../../shared/ui'
import { NO_SCOPE, scopeCount, toggleScope, type StatsScope } from '../../statsModel'
import { scopeChips, type ScopeOptions } from './statsScopeOptions'

/**
 * Under the period row: the Filter button (with how many picks) and each pick
 * as a chip that removes it, then Clear filters.
 */
export function StatsScopeBar({ scope, options, onChange, onOpen }: {
  scope: StatsScope; options: ScopeOptions; onChange: (s: StatsScope) => void; onOpen: () => void
}) {
  const count = scopeCount(scope)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" icon={<SlidersHorizontal />} onClick={onOpen} aria-label={count ? `Filter (${count} picked)` : 'Filter'}>
        Filter
        {count > 0 && <span aria-hidden className="count-badge border-accent-500/40 bg-accent-50 text-accent-700">{count}</span>}
      </Button>
      {scopeChips(scope, options).map(c => (
        <button
          key={`${c.section}:${c.key}`} type="button" onClick={() => onChange(toggleScope(scope, c.section, c.key))}
          aria-label={`Remove filter: ${c.word} ${c.label}`}
          className="chip press-feedback min-h-[32px] max-w-[18rem] gap-1.5 px-2.5 text-meta hover:bg-surface-hover [@media(pointer:coarse)]:min-h-[44px]"
        >
          <span className="shrink-0 text-fg-muted">{c.word}</span>
          <Truncate className="min-w-0 font-medium text-fg">{c.label}</Truncate>
          <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
        </button>
      ))}
      {count > 0 && <Button size="sm" variant="ghost" onClick={() => onChange(NO_SCOPE)}>Clear filters</Button>}
    </div>
  )
}
