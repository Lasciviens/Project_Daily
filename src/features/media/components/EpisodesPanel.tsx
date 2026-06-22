import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from '../../../app/store'
import { useSeasonDetails } from '../hooks/useTMDB'
import { useWatchedEpisodes, useToggleEpisodeWatched } from '../hooks/useWatchedEpisodes'
import { markEpisodeWatched } from '../api/watchedEpisodesApi'
import { useQueryClient } from '@tanstack/react-query'
import { useCreateTimeBlock } from '../../daily/hooks/useSchedule'
import type { TMDBTVFull } from '../types'

interface Props {
  tv:         TMDBTVFull
  tvEntryId:  string
}

const TODAY = format(new Date(), 'yyyy-MM-dd')

export function EpisodesPanel({ tv, tvEntryId }: Props) {
  const realSeasons = (tv.seasons ?? []).filter(s => s.season_number > 0)
  const [season,   setSeason]   = useState(realSeasons[0]?.season_number ?? 1)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data: seasonData, isLoading } = useSeasonDetails(tv.id, season)
  const { data: watched = [] }          = useWatchedEpisodes(tvEntryId)
  const toggle                          = useToggleEpisodeWatched(tvEntryId)
  const createBlock                     = useCreateTimeBlock()
  const queryClient                     = useQueryClient()
  const [markingAll, setMarkingAll]     = useState(false)

  const watchedSet = new Set(watched.filter(w => w.season === season).map(w => w.episode))
  const watchedMap = new Map(watched.filter(w => w.season === season).map(w => [w.episode, w.watched_on]))

  function toggleSelect(epNum: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(epNum) ? next.delete(epNum) : next.add(epNum)
      return next
    })
  }

  async function handleToggleWatched(epNum: number) {
    const isWatched = watchedSet.has(epNum)
    try {
      await toggle.mutateAsync({ season, episode: epNum, watched: isWatched })
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed')
    }
  }

  async function handleMarkAllWatched() {
    const unwatched = (seasonData?.episodes ?? []).filter(ep => !watchedSet.has(ep.episode_number))
    if (!unwatched.length) return
    setMarkingAll(true)
    const tid = toast.loading(`Marking ${unwatched.length} episode${unwatched.length > 1 ? 's' : ''} as watched…`)
    try {
      for (const ep of unwatched) {
        await markEpisodeWatched(tvEntryId, season, ep.episode_number, TODAY)
      }
      await queryClient.invalidateQueries({ queryKey: ['watchedEpisodes', tvEntryId] })
      toast.dismiss(tid)
      toast.success(`Season ${season} marked as watched ✓`)
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed')
    } finally {
      setMarkingAll(false)
    }
  }

  async function handlePlanSelected() {
    const episodes = (seasonData?.episodes ?? []).filter(e => selected.has(e.episode_number))
    if (!episodes.length) return
    const defaultRuntime = tv.episode_run_time?.[0] ?? 45
    const tid = toast.loading(`Adding ${episodes.length} episode${episodes.length > 1 ? 's' : ''} to today…`)
    try {
      for (const ep of episodes) {
        const duration = ep.runtime ?? defaultRuntime
        const title    = `📺 ${tv.name} · S${String(season).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')} "${ep.name}"`
        await createBlock.mutateAsync({
          date:             TODAY,
          title,
          duration_minutes: duration,
          source_type:      'tv_series',
          source_id:        tvEntryId,
        })
      }
      toast.dismiss(tid)
      toast.success(`${episodes.length} episode${episodes.length > 1 ? 's' : ''} added to today ✓`)
      setSelected(new Set())
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to add')
    }
  }

  if (realSeasons.length === 0) return null

  return (
    <div className="mt-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-2">Episodes</p>

      {/* Season tabs + Select All/Clear */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 mb-3">
        {realSeasons.map(s => (
          <button
            key={s.season_number}
            onClick={() => { setSeason(s.season_number); setSelected(new Set()) }}
            className={[
              'flex-shrink-0 text-xs px-2.5 py-1 rounded-lg min-h-[36px] transition-colors',
              season === s.season_number
                ? 'bg-accent-500 text-white font-semibold'
                : 'bg-cream-100 text-ink-500 hover:bg-cream-200',
            ].join(' ')}
          >
            S{s.season_number}
            <span className="ml-1 text-[9px] opacity-70">{s.episode_count}</span>
          </button>
        ))}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <button
            onClick={handleMarkAllWatched}
            disabled={isLoading || !seasonData || markingAll}
            className="text-xs px-2 py-1 rounded-lg min-h-[36px] bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 disabled:opacity-40 transition-colors"
          >
            ✓ All
          </button>
          <button
            onClick={() => setSelected(new Set((seasonData?.episodes ?? []).map(e => e.episode_number)))}
            disabled={isLoading || !seasonData}
            className="text-xs px-2 py-1 rounded-lg min-h-[36px] bg-cream-100 text-ink-500 hover:bg-cream-200 disabled:opacity-40 transition-colors"
          >
            Select All
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-accent-500 hover:text-accent-700 px-1.5 min-h-[36px] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Plan bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-accent-50 rounded-lg border border-accent-200">
          <span className="text-xs text-accent-700 font-medium flex-1">
            {selected.size} episode{selected.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handlePlanSelected}
            disabled={createBlock.isPending}
            className="text-xs bg-accent-500 text-white px-3 py-1 rounded-lg min-h-[36px] hover:bg-accent-600 transition-colors"
          >
            Add to today
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-accent-500 hover:text-accent-700 px-2 min-h-[36px]"
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
              <div
                key={ep.episode_number}
                className={[
                  'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors',
                  isSelected ? 'bg-accent-50 border border-accent-200' : 'hover:bg-cream-50',
                ].join(' ')}
              >
                {/* Plan checkbox */}
                <button
                  onClick={() => toggleSelect(ep.episode_number)}
                  className={[
                    'flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors min-h-[44px] min-w-[44px]',
                    isSelected
                      ? 'bg-accent-500 border-accent-500'
                      : 'border-ink-300 hover:border-accent-400',
                  ].join(' ')}
                  title="Select to plan"
                >
                  {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                </button>

                {/* Episode info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10px] font-bold text-ink-400 flex-shrink-0">
                      E{String(ep.episode_number).padStart(2, '0')}
                    </span>
                    <span className="text-xs text-ink-800 truncate font-medium">{ep.name}</span>
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
                        ✓ {new Date(watchedOn + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Watched toggle */}
                <button
                  onClick={() => handleToggleWatched(ep.episode_number)}
                  disabled={toggle.isPending}
                  title={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
                  className={[
                    'flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors min-h-[44px] min-w-[44px]',
                    isWatched
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-ink-200 text-ink-300 hover:border-green-400 hover:text-green-500',
                  ].join(' ')}
                >
                  <span className="text-[10px] font-bold">✓</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
