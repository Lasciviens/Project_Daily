import { useState } from 'react'
import { CoverImg } from '../gameCardKit'
import { systemMeta } from '../../systemMeta'
import { matchConfidence, FIELD_LABEL, type StudioGame, type FillableField } from '../../screenscraperStudio'
import type { ScrapeResult } from '../../api/screenscraperApi'

// One proposed match, laid out so a WRONG one is obvious before it is saved.
//
// The failure this exists for: ScreenScraper matches on a ROM filename, which
// is all it is given, so "Sonic The Hedgehog" came back as "Amy Rose In Sonic
// The Hedgehog" and three different Contras all matched Contra III.
//
// Every defence here is a NAMED OBSERVATION, never a confidence percentage.
// This repo has a standing rule against synthetic composite metrics (Health's
// "no derived sleep metrics", RecoveryLoadPanel's refusal of a readiness
// score), and a score would be worse than useless here: there is no ground
// truth to calibrate it against, and a number invites the auto-approve button
// that must never exist. The signals are: the two titles on adjacent lines,
// the ROM filename the match was actually made on, the system that was really
// searched, the entry's own hack/beta/region markers, and — the one signal a
// person reads in 200ms — the candidate cover.

const CONFIDENCE_META = {
  exact: { label: 'Titles match', cls: 'bg-green-100 text-green-700 border-green-200' },
  close: { label: 'Similar title — check it', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  loose: { label: 'Different title — probably wrong', cls: 'bg-red-100 text-red-600 border-red-200' },
} as const

const MEDIA_COLUMNS: FillableField[] = ['primary_cover_url', 'screenshot_url', 'fanart_url']

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

export function ScrapeResultCard({ game, result, accepted, focused, onToggleField, onAcceptAll, onRejectAll, onSearchManually }: {
  game: StudioGame | undefined
  result: ScrapeResult
  /** null = this result is rejected entirely. */
  accepted: FillableField[] | null
  focused?: boolean
  onToggleField: (f: FillableField) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  onSearchManually: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const matched = result.outcome === 'matched'
  const offered = (result.would_fill ?? []).filter((f): f is FillableField => f in FIELD_LABEL)
  const conf = matched ? matchConfidence(game?.title ?? result.title ?? '', result.matched_title) : null
  const on = (f: FillableField) => accepted?.includes(f) ?? false
  const live = accepted !== null && accepted.length > 0
  const ring = focused ? 'ring-2 ring-accent-400 ring-offset-1' : ''

  if (!matched) {
    const why = result.outcome === 'no_match' ? 'No entry in their database for this ROM filename'
      : result.outcome === 'unmatchable' ? 'Nothing to match on — no ROM filename, or no id for this system'
      : result.outcome === 'stale_proposal' ? 'Their database answered with a different entry than the one you reviewed'
      : 'Lookup failed'
    return (
      <div className={`rounded-xl border border-amber-300 bg-amber-50/40 p-3 flex items-start gap-3 ${ring}`}>
        <div className="w-12 flex-shrink-0 rounded-lg overflow-hidden border border-ink-200 bg-ink-100" style={{ aspectRatio: '3/4' }}>
          <CoverImg url={game?.primary_cover_url} title={result.title ?? ''} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-800 truncate">{result.title}</p>
          <p className="text-xs text-amber-700 dark:text-amber-400">{why}{result.reason ? ` — ${result.reason}` : ''}</p>
          {result.rom_name && <p className="text-[11px] text-ink-400 font-mono truncate">{result.rom_name}</p>}
          {result.system && <p className="text-[11px] text-ink-400">searched as {result.system}</p>}
        </div>
        <button type="button" onClick={onSearchManually}
          className="min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 flex-shrink-0">
          🔍 Search by hand
        </button>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border-2 p-3 transition-colors ${ring} ${live ? 'border-accent-300 bg-accent-50/30' : 'border-ink-200 bg-cream-50'}`}>
      <div className="flex items-start gap-3">
        {/* Yours on the left, theirs on the right — the comparison the eye
            actually makes, and the reason the candidate art is mirrored. */}
        <div className="flex gap-1 flex-shrink-0">
          <div className="w-12 rounded-lg overflow-hidden border border-ink-200 bg-ink-100" style={{ aspectRatio: '3/4' }}>
            <CoverImg url={game?.primary_cover_url} title={result.title ?? ''} />
          </div>
          {result.pending_cover_url && (
            <div className="w-12 rounded-lg overflow-hidden border-2 border-accent-300 bg-ink-100" style={{ aspectRatio: '3/4' }}
              title="The cover this match would give you">
              <img src={result.pending_cover_url} alt="" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-800 truncate">{result.title}</p>
          <p className="text-sm text-ink-600 truncate">→ {result.matched_title ?? '—'}</p>
          {result.rom_name && (
            <p className="text-[11px] text-ink-400 font-mono truncate" title={result.rom_name}>
              matched on {result.rom_name}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {conf && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CONFIDENCE_META[conf].cls}`}>
                {CONFIDENCE_META[conf].label}
              </span>
            )}
            {result.system && (
              <span className="text-[10px] text-ink-500">as {systemMeta(result.system).label}</span>
            )}
            {/* Their own markers. "hack" is the single highest-signal fact for
                this library's failure mode and was being thrown away. */}
            {result.flags?.map(f => (
              <span key={f} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                /hack|not a game|proto|beta|demo/.test(f)
                  ? 'bg-red-100 text-red-600 border-red-200'
                  : 'bg-ink-100 text-ink-500 border-ink-200'
              }`}>{f}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 flex-shrink-0">
          <button type="button" onClick={live ? onRejectAll : onAcceptAll}
            className={`min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border transition-colors ${
              live ? 'border-ink-200 text-ink-500 hover:border-red-300 hover:text-red-600' : 'border-accent-400 text-accent-700 hover:bg-accent-50'
            }`}>
            {live ? '✕ Reject' : '✓ Accept'}
          </button>
          <button type="button" onClick={onSearchManually}
            className="min-h-[36px] px-2.5 text-xs rounded-lg border border-ink-200 text-ink-500 hover:border-accent-400">
            🔍 Other
          </button>
        </div>
      </div>

      {offered.length > 0 ? (
        <div className="mt-2 pt-2 border-t border-ink-100">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[10px] text-ink-400">Fields to write ({accepted?.length ?? 0} of {offered.length})</p>
            <button type="button" onClick={() => setExpanded(v => !v)}
              className="min-h-[32px] px-2 text-[11px] text-accent-600 hover:underline">
              {expanded ? 'Hide values' : 'Show values'}
            </button>
          </div>

          {expanded ? (
            // The VALUES. Approving "description" means nothing until you can
            // read the description and see whose game it describes.
            <div className="space-y-1">
              {offered.map(f => (
                <label key={f} className="flex items-start gap-2 rounded-lg border border-ink-100 p-1.5 cursor-pointer">
                  <input type="checkbox" checked={on(f)} onChange={() => onToggleField(f)}
                    className="mt-0.5 w-4 h-4 accent-current text-accent-500 flex-shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold text-ink-400 uppercase tracking-wide">{FIELD_LABEL[f]}</span>
                    <span className={`block text-xs ${on(f) ? 'text-ink-700' : 'text-ink-400 line-through'} break-words`}>
                      {MEDIA_COLUMNS.includes(f) ? 'image (downloaded and re-hosted on save)' : renderValue(result.proposed?.[f])}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {offered.map(f => (
                <button key={f} type="button" onClick={() => onToggleField(f)}
                  title={MEDIA_COLUMNS.includes(f) ? undefined : renderValue(result.proposed?.[f]).slice(0, 200)}
                  className={`min-h-[32px] px-2 text-[11px] font-medium rounded-md border transition-colors ${
                    on(f) ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-500 border-ink-200 line-through decoration-ink-300'
                  }`}>{FIELD_LABEL[f]}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 pt-2 border-t border-ink-100 text-[11px] text-ink-400">
          Nothing to write — everything this game is missing is empty on their side too.
        </p>
      )}
    </div>
  )
}
