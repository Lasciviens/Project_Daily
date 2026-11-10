import { SlidersHorizontal, X } from 'lucide-react'
import { Button, Truncate } from '../../../../shared/ui'
import { NO_SCOPE, scopeCount, toggleScope, type ScopeSection, type StatsScope } from '../../statsModel'
import { scopeChips, type ScopeOptions } from './statsScopeOptions'

/** More picks than this in one section read as one chip ("Things · 10 picked") — Owned's summary line can pick every thing it lists. */
const CHIPS_PER_SECTION = 3

/**
 * Under the period row: the Filter button (with how many picks) and each pick
 * as a chip that removes it — a long section as one chip that removes it
 * all — then Clear filters.
 */
export function StatsScopeBar({ scope, options, onChange, onOpen }: {
  scope: StatsScope; options: ScopeOptions; onChange: (s: StatsScope) => void; onOpen: () => void
}) {
  const count = scopeCount(scope)
  const chips = scopeChips(scope, options)
  const chip = (key: string, word: string, label: string, aria: string, remove: () => void) => (
    <button
      key={key} type="button" onClick={remove} aria-label={aria}
      className="chip press-feedback min-h-[32px] max-w-[18rem] gap-1.5 px-2.5 text-meta hover:bg-surface-hover [@media(pointer:coarse)]:min-h-[44px]"
    >
      <span className="shrink-0 text-fg-muted">{word}</span>
      <Truncate className="min-w-0 font-medium text-fg">{label}</Truncate>
      <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" icon={<SlidersHorizontal />} onClick={onOpen} aria-label={count ? `Filter (${count} picked)` : 'Filter'}>
        Filter
        {count > 0 && <span aria-hidden className="count-badge border-accent-500/40 bg-accent-50 text-accent-700">{count}</span>}
      </Button>
      {SECTIONS.flatMap(section => {
        const mine = chips.filter(c => c.section === section)
        if (mine.length > CHIPS_PER_SECTION) {
          const word = SECTION_WORDS[section]
          return [chip(`${section}:all`, word, `${mine.length} picked`, `Remove filter: ${mine.length} ${word.toLowerCase()}`, () => onChange({ ...scope, [section]: [] }))]
        }
        return mine.map(c => chip(`${c.section}:${c.key}`, c.word, c.label, `Remove filter: ${c.word} ${c.label}`, () => onChange(toggleScope(scope, c.section, c.key))))
      })}
      {count > 0 && <Button size="sm" variant="ghost" onClick={() => onChange(NO_SCOPE)}>Clear filters</Button>}
    </div>
  )
}

const SECTIONS: ScopeSection[] = ['categories', 'chains', 'things', 'stores']
const SECTION_WORDS: Record<ScopeSection, string> = { categories: 'Categories', chains: 'Chains', things: 'Things', stores: 'Stores' }
