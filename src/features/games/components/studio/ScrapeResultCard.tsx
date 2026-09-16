import { CoverImg } from '../gameCardKit'
import { systemMeta } from '../../systemMeta'
import { matchConfidence, FIELD_LABEL, type StudioGame, type FillableField } from '../../screenscraperStudio'
import { FieldCompare } from './FieldCompare'
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
  const matched = result.outcome === 'matched'
  const offered = (result.would_fill ?? []).filter((f): f is FillableField => f in FIELD_LABEL)
  const conf = matched ? matchConfidence(game?.title ?? result.title ?? '', result.matched_title) : null
  const live = accepted !== null && accepted.length > 0
  const ring = focused ? 'ring-2 ring-accent-400 ring-offset-1' : ''

  if (!matched) {
    const why = result.outcome === 'no_match' ? 'Nothing in their database matched this'
      : result.outcome === 'unmatchable' ? 'Nothing to match on'
        : result.outcome === 'stale_proposal' ? 'Their database answered with a different entry than the one you reviewed'
          : 'The lookup failed'
    return (
      <div className={`rounded-xl border border-amber-300 bg-amber-50/40 p-3 space-y-2 ${ring}`}>
        <div className="flex items-start gap-3">
          <div className="w-12 flex-shrink-0 rounded-lg overflow-hidden border border-ink-200 bg-ink-100" style={{ aspectRatio: '3/4' }}>
            <CoverImg url={game?.primary_cover_url} title={result.title ?? ''} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink-800 truncate">{result.title}</p>
            <p className="text-xs text-amber-700 dark:text-amber-400">{why}{result.reason ? ` — ${result.reason}` : ''}</p>
            {result.rom_name && <p className="text-[11px] text-ink-400 font-mono truncate">{result.rom_name}</p>}
            {result.system && <p className="text-[11px] text-ink-400">searched as {result.system}</p>}
          </div>
        </div>

        {/* Your side, even with nothing to compare it against. A miss used to
            be one line and a button — so the moment the automatic pass failed,
            the whole side-by-side view disappeared and there was nothing on
            screen saying what this game actually has. */}
        <FieldCompare game={game} candidate={{}} candidateTitle={null} candidateSystem={null} />

        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onSearchManually}
            className="min-h-[36px] px-3 text-xs font-semibold rounded-lg border border-accent-400 text-accent-700 hover:bg-accent-50">
            🔍 Search by hand
          </button>
          <button type="button" onClick={onRejectAll}
            className="min-h-[36px] px-3 text-xs font-semibold rounded-lg border border-ink-200 text-ink-500 hover:border-ink-300">
            ⤼ Skip
          </button>
        </div>
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

      </div>

      {/* The split screen. Not behind a toggle: it IS the card. */}
      <div className="mt-2">
        <FieldCompare
          game={game}
          candidate={result.proposed ?? {}}
          candidateTitle={result.matched_title}
          candidateSystem={result.system ? systemMeta(result.system).label : null}
          accepted={accepted}
          onToggleField={onToggleField}
        />
        <p className="text-[10px] text-ink-400 mt-1">
          {offered.length
            ? `${accepted?.length ?? 0} of ${offered.length} gap${offered.length === 1 ? '' : 's'} ticked to fill · a field you already have is never overwritten`
            : 'Nothing to fill — every gap this game has is empty on their side too'}
        </p>
      </div>

      {/* Approve · Skip · Search — the three things there are to do with a
          proposed match, on one row rather than split across the card. */}
      <div className="mt-2 pt-2 border-t border-ink-100 flex flex-wrap gap-1.5">
        <button type="button" onClick={onAcceptAll} disabled={!offered.length}
          className={`min-h-[36px] px-3 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-40 ${
            live ? 'bg-green-600 text-white border-green-600' : 'border-green-400 text-green-700 hover:bg-green-50'
          }`}>✓ Approve</button>
        <button type="button" onClick={onRejectAll}
          className={`min-h-[36px] px-3 text-xs font-semibold rounded-lg border transition-colors ${
            accepted === null ? 'bg-ink-200 text-ink-700 border-ink-300' : 'border-ink-200 text-ink-500 hover:border-ink-300'
          }`}>⤼ Skip</button>
        <button type="button" onClick={onSearchManually}
          className="min-h-[36px] px-3 text-xs font-semibold rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 hover:text-accent-700">
          🔍 Search
        </button>
      </div>
    </div>
  )
}
