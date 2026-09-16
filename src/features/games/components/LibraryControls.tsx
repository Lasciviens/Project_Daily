import { useState } from 'react'
import { useSetPlayStatus, useUpdateGame } from '../hooks/useGames'
import { STATUS_LABEL, STATUSES, TIER_COLOR, TIERS } from '../gamesMeta'
import { formatPlaytime, playStatsOf } from '../gameStats'
import type { Game, PlayStatus, Tier } from '../types'

// The personal side of a game — status, tier, rating, flags, notes — for the
// Steam and PlayStation modals.
//
// Those two tabs used to be pure passthroughs: you could read Sony's and
// Valve's numbers and do nothing with them. Once migration 096 put provider
// games in the same table as the retro library, "mark this completed" became a
// thing that SHOULD work there and simply had not been wired.
//
// It is the same controls as the retro detail modal deliberately: a Steam game
// and a SNES game differ in where their metadata came from, not in what you do
// with them, and two divergent status pickers is how they drift apart.

export function LibraryControls({ entry, notImportedHint }: {
  entry: Game | null
  /** Shown when this game is not in the library yet — the controls need a row
   *  to write to, and inventing one silently from a modal would be a surprise. */
  notImportedHint: string
}) {
  const setStatus = useSetPlayStatus()
  const update = useUpdateGame()
  const [notes, setNotes] = useState<string | null>(null)

  if (!entry) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 p-3">
        <p className="text-xs text-ink-500">{notImportedHint}</p>
      </div>
    )
  }

  const play = playStatsOf(entry)
  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: entry.id, patch: p })

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50 p-3 space-y-3">
      <div>
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map(s => (
            <button key={s} type="button"
              onClick={() => setStatus.mutate({ id: entry.id, status: s as PlayStatus })}
              disabled={setStatus.isPending}
              className={`text-xs font-semibold px-2.5 py-1.5 min-h-[36px] rounded-lg border transition-colors disabled:opacity-50 ${
                entry.play_status === s
                  ? 'bg-accent-500 text-white border-accent-500'
                  : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
              }`}>{STATUS_LABEL[s] ?? s}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Tier</p>
          <div className="flex flex-wrap gap-1">
            {TIERS.map(t => (
              <button key={t} type="button"
                onClick={() => patch({ tier: (entry.tier === t ? null : t) as Tier | null })}
                className={`min-w-[36px] min-h-[36px] text-xs font-bold rounded-lg border transition-colors ${
                  entry.tier === t ? (TIER_COLOR[t] ?? 'bg-ink-200') + ' border-transparent' : 'bg-cream-50 text-ink-500 border-ink-200 hover:border-accent-300'
                }`}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">My rating</p>
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(r => (
              <button key={r} type="button"
                onClick={() => patch({ rating: entry.rating === r ? null : r })}
                className={`min-w-[32px] min-h-[36px] text-xs font-semibold rounded-lg border transition-colors ${
                  entry.rating === r ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-500 border-ink-200 hover:border-accent-300'
                }`}>{r}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => patch({ is_iconic: !entry.is_iconic })}
          className={`min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
            entry.is_iconic ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
          }`}>⭐ Iconic</button>
        <button type="button" onClick={() => patch({ is_coop: !entry.is_coop })}
          className={`min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
            entry.is_coop ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
          }`}>2P Co-op</button>
        {(entry.started_at || entry.finished_at) && (
          <span className="min-h-[36px] px-2.5 text-[11px] text-ink-400 flex items-center">
            {entry.started_at && `▶ started ${new Date(entry.started_at).toLocaleDateString('en-GB')}`}
            {entry.finished_at && ` · 🏁 finished ${new Date(entry.finished_at).toLocaleDateString('en-GB')}`}
          </span>
        )}
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mb-1">My notes</p>
        {/* Saves on blur, matching Media's personal_note convention — no Save
            button for a field nobody wants to confirm. */}
        <textarea
          value={notes ?? entry.play_notes ?? ''}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => { if (notes !== null && notes !== (entry.play_notes ?? '')) patch({ play_notes: notes || null }) }}
          rows={2} placeholder="Anything you want to remember about this one…"
          className="w-full text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
      </div>

      {formatPlaytime(play.seconds) && (
        <p className="text-[11px] text-ink-400">
          ⏱ Played {formatPlaytime(play.seconds)} in total{play.count != null ? ` · launched ${play.count}×` : ''}
        </p>
      )}
    </div>
  )
}
