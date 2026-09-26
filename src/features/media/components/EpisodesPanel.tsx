import { useState } from 'react'
import { format } from 'date-fns'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { useSeasonDetails } from '../hooks/useTMDB'
import { useWatchedEpisodes, useMarkEpisodeWatched } from '../hooks/useWatchedEpisodes'
import { CalendarPlus, Check } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel, Skeleton } from '../../../shared/ui'
import { ceilToQuarter } from '../../../shared/components/plan-modal/planModal.config'
import type { TMDBTVFull } from '../types'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

interface Props {
  tv:         TMDBTVFull
  tvEntryId:  string
}

const TODAY = format(new Date(), 'yyyy-MM-dd')

export function EpisodesPanel({ tv, tvEntryId }: Props) {
  const realSeasons = (tv.seasons ?? []).filter(s => s.season_number > 0)
  const [season,    setSeason]    = useState(realSeasons[0]?.season_number ?? 1)
  const [selected,  setSelected]  = useState<Set<number>>(new Set())
  const [marking,   setMarking]   = useState(false)

  const { data: seasonData, isLoading } = useSeasonDetails(tv.id, season)
  const { data: watched = [] }          = useWatchedEpisodes(tvEntryId)
  const markWatched                     = useMarkEpisodeWatched()
  const modal                           = useEntityModal()

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
  // useMarkEpisodeWatched refreshes progress + the schedule (the DB trigger
  // deletes a watched episode's planned block, migration 043) and toasts errors.
  async function handleMarkSelectedWatched() {
    if (selected.size === 0) return
    setMarking(true)
    const episodes = [...selected].map(episode => ({ season, episode }))
    const ok = await withProgress(
      () => markWatched.mutateAsync({ tvEntryId, episodes, watchedOn: TODAY }).then(() => true),
      { loading: `Marking ${episodes.length} episode${episodes.length > 1 ? 's' : ''} as watched…`, success: 'Marked as watched' },
    )
    if (ok) setSelected(new Set())
    setMarking(false)
  }

  // Plan pre-fills from the selected episodes.
  const selectedEpisodes = (seasonData?.episodes ?? []).filter(e => selected.has(e.episode_number))
  const defaultRuntime = tv.episode_run_time?.[0] ?? 45
  const planTitle = selectedEpisodes.length === 1
    ? `📺 ${tv.name} · S${String(season).padStart(2, '0')}E${String(selectedEpisodes[0].episode_number).padStart(2, '0')} "${selectedEpisodes[0].name}"`
    : `📺 ${tv.name} · S${String(season).padStart(2, '0')} (${selectedEpisodes.length} ep)`
  // Sum real runtimes, then round UP to the next 15-min quarter (44→45, 91→105).
  const rawDuration  = selectedEpisodes.reduce((sum, ep) => sum + (ep.runtime ?? defaultRuntime), 0) || defaultRuntime
  const planDuration = ceilToQuarter(rawDuration)

  function openPlan() {
    modal.open({
      kind: 'time-block',
      config: { heading: 'Plan episodes' },
      defaults: { title: planTitle, date: TODAY, duration: planDuration, category: 'media', color: 'blue' },
      source: {
        sourceType: 'tv_episode',
        sourceId: tvEntryId,
        taskSourceType: 'tv_series',
        // Only one specific episode is auto-matched when marked watched; a
        // "watch 3 episodes" block is deliberately left alone (migration 043).
        episodeInfo: selectedEpisodes.length === 1
          ? { seasonNumber: season, episodeNumber: selectedEpisodes[0].episode_number }
          : undefined,
      },
    })
    setSelected(new Set())
  }

  if (realSeasons.length === 0) return null

  return (
    <div>
      <SectionLabel className="mb-2">Episodes</SectionLabel>

      <div className="mb-3 flex items-center gap-1">
        <div role="tablist" aria-label="Seasons" className="scroll-x flex min-w-0 flex-1 gap-1 pb-1">
          {realSeasons.map(s => {
            const done = watchedBySeason.get(s.season_number) ?? 0
            const pct = s.episode_count > 0 ? Math.min(100, (done / s.episode_count) * 100) : 0
            const active = season === s.season_number
            const complete = done === s.episode_count && s.episode_count > 0
            return (
              <button
                key={s.season_number}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setSeason(s.season_number); setSelected(new Set()) }}
                className={[
                  'press-feedback relative min-h-[44px] shrink-0 overflow-hidden rounded-control px-3 text-body font-semibold tabular-nums transition-colors',
                  active ? 'bg-accent-500 text-on-accent' : 'bg-surface-2 text-fg-2 hover:bg-surface-hover',
                ].join(' ')}
              >
                S{s.season_number}
                <span className="ml-1 text-micro font-medium opacity-75">
                  {done > 0 ? `${done}/${s.episode_count}` : s.episode_count}
                </span>
                {complete && <Check aria-label="Season watched" className="ml-0.5 inline h-3 w-3" />}
                {/* Season progress fill — the at-a-glance "where am I" bar. */}
                <span
                  aria-hidden
                  className={`absolute bottom-0 left-0 h-[3px] rounded-full ${active ? 'bg-on-accent/70' : 'bg-success'}`}
                  style={{ width: `${pct}%` }}
                />
              </button>
            )
          })}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelected(new Set((seasonData?.episodes ?? []).map(e => e.episode_number)))}
          disabled={isLoading || !seasonData}
        >
          Select all
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-row border border-accent-500/30 bg-accent-50 px-3 py-1.5">
          <span className="min-w-0 flex-1 text-body font-medium text-accent-700 tabular-nums">
            {selected.size} episode{selected.size > 1 ? 's' : ''} selected
          </span>
          <Button size="sm" onClick={handleMarkSelectedWatched} loading={marking} icon={<Check />}>Mark watched</Button>
          <Button size="sm" variant="primary" onClick={openPlan} icon={<CalendarPlus />}>Plan</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-11 w-full" />)}
        </div>
      ) : (
        <div className="space-y-0.5">
          {(seasonData?.episodes ?? []).map(ep => {
            const isWatched  = watchedSet.has(ep.episode_number)
            const isSelected = selected.has(ep.episode_number)
            const watchedOn  = watchedMap.get(ep.episode_number)
            const runtime    = ep.runtime ?? tv.episode_run_time?.[0] ?? null

            return (
              <button
                key={ep.episode_number}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleSelect(ep.episode_number)}
                className={[
                  'flex min-h-[44px] w-full items-center gap-2.5 rounded-row px-2 py-1 text-left transition-colors',
                  // Watched rows read as done at a glance: tinted, dimmed title, check badge.
                  isSelected ? 'bg-accent-50 ring-1 ring-inset ring-accent-500/30'
                    : isWatched ? 'bg-success-soft/60 hover:bg-success-soft'
                    : 'hover:bg-surface-hover',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'grid h-4 w-4 shrink-0 place-items-center rounded border-2 transition-colors',
                    isSelected ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong',
                  ].join(' ')}
                >
                  {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className={`shrink-0 text-micro font-bold tabular-nums ${isWatched ? 'text-success' : 'text-fg-faint'}`}>
                      E{String(ep.episode_number).padStart(2, '0')}
                    </span>
                    <span className={`truncate text-body font-medium ${isWatched ? 'text-fg-muted' : 'text-fg'}`}>{ep.name}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-micro text-fg-muted tabular-nums">
                    {runtime && <span>{runtime}m</span>}
                    {ep.air_date && (
                      <span>{fmtDateEnGB(new Date(ep.air_date + 'T00:00:00'), { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                    )}
                    {isWatched && watchedOn && (
                      <span className="font-medium text-success">
                        Watched {fmtDateEnGB(new Date(watchedOn), { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </span>
                </span>

                {isWatched && (
                  <span aria-label="Watched" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
