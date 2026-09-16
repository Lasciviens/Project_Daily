import { useMemo } from 'react'
import { CoverImg } from '../gameCardKit'
import { systemMeta } from '../../systemMeta'
import {
  missingFields, systemOf, completenessLabel, isScraped, FILLABLE_FIELDS, FIELD_LABEL,
  type StudioGame, type StudioFilters, type FillableField,
} from '../../screenscraperStudio'

// The work queue: which games you are about to ask ScreenScraper about.
//
// The old batch flow said "look up next 6" and picked them itself, so the one
// thing a person actually needs to know — WHICH six — was invisible until the
// results came back. Here every candidate is a card you can see and tap.

export function ScrapeFilters({ filters, onChange, systems, total, shown }: {
  filters: StudioFilters
  onChange: (f: StudioFilters) => void
  systems: string[]
  total: number
  shown: number
}) {
  const set = <K extends keyof StudioFilters>(k: K, v: StudioFilters[K]) => onChange({ ...filters, [k]: v })
  const toggle = <T,>(list: T[], v: T): T[] => list.includes(v) ? list.filter(x => x !== v) : [...list, v]

  const pill = (on: boolean) =>
    `min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
      on ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
    }`

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input value={filters.search} onChange={e => set('search', e.target.value)}
          placeholder="Search your library…"
          className="min-h-[44px] max-w-md flex-1 text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
        <span className="text-xs text-ink-500">{shown} of {total}</span>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1">
          System {filters.systems.length ? `(${filters.systems.length})` : '(all)'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {systems.map(sys => (
            <button key={sys} type="button" onClick={() => set('systems', toggle(filters.systems, sys))}
              className={pill(filters.systems.includes(sys))}>{systemMeta(sys).label}</button>
          ))}
          {filters.systems.length > 0 && (
            <button type="button" onClick={() => set('systems', [])} className="min-h-[36px] px-2 text-xs text-ink-500 underline">Clear</button>
          )}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1">
          Missing {filters.missing.length ? '(all of these)' : '(anything)'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FILLABLE_FIELDS.map(f => (
            <button key={f} type="button" onClick={() => set('missing', toggle(filters.missing, f) as FillableField[])}
              className={pill(filters.missing.includes(f))}>{FIELD_LABEL[f]}</button>
          ))}
          {filters.missing.length > 0 && (
            <button type="button" onClick={() => set('missing', [])} className="min-h-[36px] px-2 text-xs text-ink-500 underline">Clear</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => set('needsReviewOnly', !filters.needsReviewOnly)}
          className={pill(filters.needsReviewOnly)}>🔎 Flagged for review</button>
        <button type="button" onClick={() => set('neverScrapedOnly', !filters.neverScrapedOnly)}
          className={pill(filters.neverScrapedOnly)}>Never scraped</button>
        <button type="button" onClick={() => set('hideScraped', !filters.hideScraped)}
          className={pill(filters.hideScraped)}>Hide already scraped</button>
        <button type="button" onClick={() => set('hideHandled', !filters.hideHandled)}
          className={pill(filters.hideHandled)}>Hide done this session</button>
      </div>
    </div>
  )
}

const HANDLED_TONE: Record<string, string> = {
  saved: 'border-green-400', skipped: 'border-ink-300', no_match: 'border-amber-400',
}
const HANDLED_TEXT: Record<string, string> = {
  saved: 'Saved', skipped: 'Skipped', no_match: 'No match',
}

export function QueueCard({ game, selected, onToggle, handled }: {
  game: StudioGame
  selected: boolean
  onToggle: () => void
  handled?: 'saved' | 'skipped' | 'no_match'
}) {
  const missing = useMemo(() => missingFields(game), [game])
  const completeness = useMemo(() => completenessLabel(game), [game])
  const sys = systemOf(game)

  return (
    <button type="button" onClick={onToggle}
      aria-pressed={selected}
      title={missing.length ? `Missing: ${missing.map(f => FIELD_LABEL[f]).join(', ')}` : 'Nothing missing'}
      className={`relative text-left rounded-xl border-2 overflow-hidden bg-cream-50 transition-all press-feedback ${
        selected ? 'border-accent-500 shadow-md' : (handled ? HANDLED_TONE[handled] : 'border-ink-200 hover:border-accent-300')
      }`}
    >
      <div className="relative bg-ink-100" style={{ aspectRatio: '3/4' }}>
        <CoverImg url={game.primary_cover_url} title={game.title} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {/* The selection state has to read at a glance across a 40-card grid. */}
        <span className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] font-bold ${
          selected ? 'bg-accent-500 border-accent-500 text-white' : 'bg-black/40 border-white/70 text-transparent'
        }`}>✓</span>
        {sys && (
          <span className={`absolute top-1.5 right-1.5 text-[9px] font-bold px-1 py-0.5 rounded-md ${systemMeta(sys).chip}`}>
            {systemMeta(sys).label}
          </span>
        )}
        {handled && (
          <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold px-1 py-0.5 rounded-md bg-black/70 text-white">
            {HANDLED_TEXT[handled]}
          </span>
        )}
        {game.needs_review && !handled && (
          <span className="absolute bottom-1.5 left-1.5 text-[10px] leading-none drop-shadow" title="Flagged for review">🔎</span>
        )}
        {!handled && !game.needs_review && isScraped(game) && (
          <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold px-1 py-0.5 rounded-md bg-green-600/85 text-white"
            title="Already looked up on ScreenScraper">✓ scraped</span>
        )}
      </div>
      <div className="p-1.5">
        <p className="text-[11px] font-semibold text-ink-800 leading-tight line-clamp-2">{game.title}</p>
        {/* "5 missing" forever was wrong for a game already looked up: what it
            still lacks is unknown to ScreenScraper, not waiting to be
            fetched. A scraped row says so. */}
        <p className={`text-[10px] mt-0.5 ${
          completeness.tone === 'gaps' ? 'text-amber-700 dark:text-amber-400'
            : completeness.tone === 'scraped' ? 'text-ink-400'
              : 'text-green-700 dark:text-green-400'
        }`}>{completeness.text}</p>
      </div>
    </button>
  )
}
