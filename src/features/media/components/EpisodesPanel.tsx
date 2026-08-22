import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from '../../../app/store'
import { useSeasonDetails } from '../hooks/useTMDB'
import { useWatchedEpisodes } from '../hooks/useWatchedEpisodes'
import { markEpisodeWatched } from '../api/watchedEpisodesApi'
import { useQueryClient } from '@tanstack/react-query'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { ceilToQuarter } from '../../../shared/components/plan-modal/planModal.config'
import type { TMDBTVFull } from '../types'

interface Props {
  tv:         TMDBTVFull
  tvEntryId:  string
}

const TODAY = format(new Date(), 'yyyy-MM-dd')

export function EpisodesPanel({ tv, tvEntryId }: Props) {
  const realSeasons = (tv.seasons ?? []).filter(s => s.season_number > 0)
  const [season,    setSeason]    = useState(realSeasons[0]?.season_number ?? 1)
  const [selected,  setSelected]  = useState<Set<number>>(new Set())
  const [planModal, setPlanModal] = useState(false)
  const [marking,   setMarking]   = useState(false)

  const { data: seasonData, isLoading } = useSeasonDetails(tv.id, season)
  const { data: watched = [] }          = useWatchedEpisodes(tvEntryId)
  const queryClient                     = useQueryClient()

  const watchedSet = new Set(watched.filter(w => w.season_number === season).map(w => w.episode_number))
  const watchedMap = new Map(watched.filter(w => w.season_number === season).map(w => [w.episode_number, w.watched_at]))

  // Watched count per season — drives the Netflix-style progress on the
  // season tabs (n/total + a green fill bar), so where you are in a series
  // is readable at a glance without opening each season.
  const watchedBySeason = new Map<number, number>()
  for (const w of watched) {
    watchedBySeason.set(w.season_number, (watchedBySeason.get(w.season_number) ?? 0) + 1)
  }

  function toggleSelect(epNum: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(epNum)) next.delete(epNum)
      else next.add(epNum)
      return next
    })
  }

  // Mark every selected episode as watched (today), then clear the selection.
  async function handleMarkSelectedWatched() {
    if (selected.size === 0) return
    setMarking(true)
    const tid = toast.loading(`Marking ${selected.size} episode${selected.size > 1 ? 's' : ''} as watched…`)
    try {
      for (const epNum of selected) {
        await markEpisodeWatched(tvEntryId, season, epNum, TODAY)
      }
      await queryClient.invalidateQueries({ queryKey: ['watched-episodes', tvEntryId] })
      // Marking watched cleans up the episode's planned block server-side
      // (migration 043) — refresh schedule + series progress so the timeline
      // and TV views update without a reload.
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['tv'] })
      toast.dismiss(tid)
      toast.success(`Marked as watched ✓`)
      setSelected(new Set())
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed')
    } finally {
      setMarking(false)
    }
  }

  // Build plan modal pre-fills from selected episodes
  const selectedEpisodes = (seasonData?.episodes ?? []).filter(e => selected.has(e.episode_number))
  const defaultRuntime = tv.episode_run_time?.[0] ?? 45
  const planTitle = selectedEpisodes.length === 1
    ? `📺 ${tv.name} · S${String(season).padStart(2, '0')}E${String(selectedEpisodes[0].episode_number).padStart(2, '0')} "${selectedEpisodes[0].name}"`
    : `📺 ${tv.name} · S${String(season).padStart(2, '0')} (${selectedEpisodes.length} ep)`
  // Sum real runtimes, then round UP to the next 15-min quarter (44→45, 91→105).
  const rawDuration  = selectedEpisodes.reduce((sum, ep) => sum + (ep.runtime ?? defaultRuntime), 0) || defaultRuntime
  const planDuration = ceilToQuarter(rawDuration)

  if (realSeasons.length === 0) return null

  return (
    <div className="mt-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-2">Episodes</p>

      {/* Season tabs + Select All */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none scroll-fade-x snap-x-mandatory pb-1 mb-3">
        {realSeasons.map(s => {
          const done = watchedBySeason.get(s.season_number) ?? 0
          const pct = s.episode_count > 0 ? Math.min(100, (done / s.episode_count) * 100) : 0
          return (
            <button
              key={s.season_number}
              onClick={() => { setSeason(s.season_number); setSelected(new Set()) }}
              className={[
                'relative flex-shrink-0 text-xs px-2.5 py-1 rounded-lg min-h-[44px] transition-colors press-feedback snap-start overflow-hidden',
                season === s.season_number
                  ? 'bg-accent-500 text-white font-semibold'
                  : 'bg-cream-100 text-ink-500 hover:bg-cream-200',
              ].join(' ')}
            >
              S{s.season_number}
              <span className="ml-1 text-[9px] opacity-70">
                {done > 0 ? `${done}/${s.episode_count}` : s.episode_count}
              </span>
              {done === s.episode_count && s.episode_count > 0 && <span className="ml-0.5 text-[9px]">✓</span>}
              {/* Season progress fill — the at-a-glance "where am I" bar */}
              <span
                className={`absolute left-0 bottom-0 h-[3px] rounded-full ${season === s.season_number ? 'bg-white/70' : 'bg-green-500/80'}`}
                style={{ width: `${pct}%` }}
              />
            </button>
          )
        })}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <button
            onClick={() => setSelected(new Set((seasonData?.episodes ?? []).map(e => e.episode_number)))}
            disabled={isLoading || !seasonData}
            className="text-xs px-2 py-1 rounded-lg min-h-[44px] bg-cream-100 text-ink-500 hover:bg-cream-200 disabled:opacity-40 transition-colors"
          >
            Select All
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-accent-500 hover:text-accent-700 px-1.5 min-h-[44px] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Selection action bar — plan or mark watched the selected episodes */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2 px-2 py-1.5 bg-accent-50 rounded-lg border border-accent-200">
          <span className="text-xs text-accent-700 font-medium flex-1 min-w-0">
            {selected.size} episode{selected.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleMarkSelectedWatched}
            disabled={marking}
            className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg min-h-[44px] hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            ✓ Mark as watched
          </button>
          <button
            onClick={() => setPlanModal(true)}
            className="text-xs bg-accent-500 text-white px-3 py-1 rounded-lg min-h-[44px] hover:bg-accent-600 transition-colors"
          >
            Plan
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-accent-500 hover:text-accent-700 px-2 min-h-[44px]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Episode list */}
      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 bg-cream-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {(seasonData?.episodes ?? []).map(ep => {
            const isWatched  = watchedSet.has(ep.episode_number)
            const isSelected = selected.has(ep.episode_number)
            const watchedOn  = watchedMap.get(ep.episode_number)
            const runtime    = ep.runtime ?? tv.episode_run_time?.[0] ?? null

            return (
              <button
                key={ep.episode_number}
                onClick={() => toggleSelect(ep.episode_number)}
                className={[
                  'w-full flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors text-left',
                  // Watched rows read as DONE at a glance (Netflix-style):
                  // tinted green, dimmed title, big check badge on the right.
                  isSelected ? 'bg-accent-50 border border-accent-200'
                    : isWatched ? 'bg-green-50/60 hover:bg-green-50'
                    : 'hover:bg-cream-50',
                ].join(' ')}
              >
                {/* Selection checkbox — small visual, full touch target */}
                <span className="flex-shrink-0 flex items-center justify-center min-h-[44px] min-w-[28px]">
                  <span className={[
                    'w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors',
                    isSelected
                      ? 'bg-accent-500 border-accent-500'
                      : 'border-ink-300',
                  ].join(' ')}>
                    {isSelected && <span className="text-white text-[8px] font-bold leading-none">✓</span>}
                  </span>
                </span>

                {/* Episode info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-[10px] font-bold flex-shrink-0 ${isWatched ? 'text-green-600' : 'text-ink-400'}`}>
                      E{String(ep.episode_number).padStart(2, '0')}
                    </span>
                    <span className={`text-xs truncate font-medium ${isWatched ? 'text-ink-500' : 'text-ink-800'}`}>{ep.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {runtime && <span className="text-[9px] text-ink-400">{runtime}m</span>}
                    {ep.air_date && (
                      <span className="text-[9px] text-ink-400">
                        {new Date(ep.air_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                    )}
                    {isWatched && watchedOn && (
                      <span className="text-[9px] text-green-600 font-medium">
                        Watched {new Date(watchedOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Watched badge — the unmistakable signal */}
                {isWatched && (
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center">
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Plan modal */}
      <UnifiedPlanModal
        open={planModal}
        onClose={() => { setPlanModal(false); setSelected(new Set()) }}
        mode="schedule"
        config={{ heading: 'Plan episodes' }}
        defaults={{
          title:    planTitle,
          date:     TODAY,
          duration: planDuration,
          category: 'media',
          color:    'blue',
        }}
        source={{
          sourceType: 'tv_episode',
          sourceId: tvEntryId,
          taskSourceType: 'tv_series',
          // Only when exactly one specific episode was planned — a batch
          // "watch 3 episodes" block intentionally isn't auto-matched when
          // just one of them gets marked watched (see migration 043).
          episodeInfo: selectedEpisodes.length === 1
            ? { seasonNumber: season, episodeNumber: selectedEpisodes[0].episode_number }
            : undefined,
        }}
      />
    </div>
  )
}
