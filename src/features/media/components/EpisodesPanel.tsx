import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { episodeAirDates, useSeasonDetails } from '../hooks/useTMDB'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import { resolveWatchedAt } from '../watchedWhen'
import { useWatchedEpisodes, useMarkEpisodeWatched, useSetEpisodeDates } from '../hooks/useWatchedEpisodes'
import { CalendarDays, CalendarPlus, Check, ListChecks, Repeat, RotateCcw, Undo2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel, Skeleton, TonePill, Truncate } from '../../../shared/ui'
import { ceilToQuarter } from '../../../shared/components/plan-modal/planModal.config'
import type { TMDBTVFull } from '../types'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { toast } from '../../../app/store'
import { isUnknownWatchedAt } from '../trakt/traktDates'
import { useTraktPlayback } from '../trakt/useTraktExtras'
import { pausedEpisodes, seasonGaps } from '../episodeGaps'

interface Props {
  tv:         TMDBTVFull
  tvEntryId:  string
}

export function EpisodesPanel({ tv, tvEntryId }: Props) {
  const TODAY = todayStr()
  const realSeasons = (tv.seasons ?? []).filter(s => s.season_number > 0)
  const [season,    setSeason]    = useState(realSeasons[0]?.season_number ?? 1)
  const [selected,  setSelected]  = useState<Set<number>>(new Set())
  const [marking,   setMarking]   = useState(false)

  const { data: seasonData, isLoading } = useSeasonDetails(tv.id, season)
  const { data: watched = [] }          = useWatchedEpisodes(tvEntryId)
  const markWatched                     = useMarkEpisodeWatched()
  const setDates                        = useSetEpisodeDates()
  const modal                           = useEntityModal()
  const qc                              = useQueryClient()
  const { ask, dialog }                 = useWatchedWhenPrompt()

  const watchedSet = new Set(watched.filter(w => w.season_number === season).map(w => w.episode_number))
  const watchedMap = new Map(watched.filter(w => w.season_number === season).map(w => [w.episode_number, w]))
  // Trakt's paused playbacks (the same read as Continue watching, one query
  // for every row): an unwatched episode stopped part-way says how far.
  const { data: playback } = useTraktPlayback()
  const pausedAt = pausedEpisodes(playback, tv.id, season)
  // Unwatched aired episodes before the last watched one in this season.
  const gaps = seasonGaps(seasonData?.episodes ?? [], watchedSet, TODAY)

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

  // The selection split by what it holds: an episode already watched (here or
  // from Trakt) can't be "marked watched" again — that used to overwrite its
  // real date with today. It can be watched again (one more play) or unmarked.
  const selectedWatched   = [...selected].filter(n => watchedSet.has(n))
  const selectedUnwatched = [...selected].filter(n => !watchedSet.has(n))

  async function runMark(nums: number[], mode: 'watched' | 'again' | 'unwatched', loading: string, success: string) {
    return runMarkRefs(nums.map(episode => ({ season, episode })), mode, loading, success)
  }

  async function runMarkRefs(episodes: { season: number; episode: number }[], mode: 'watched' | 'again' | 'unwatched', loading: string, success: string) {
    if (episodes.length === 0) return
    setMarking(true)
    const ok = await withProgress(
      () => markWatched.mutateAsync({
        tvEntryId, episodes, watchedOn: TODAY,
        watched: mode !== 'unwatched', again: mode === 'again',
      }).then(() => true),
      { loading, success },
    )
    if (ok) setSelected(new Set())
    setMarking(false)
  }

  const watchedAll = new Set(watched.map(w => `${w.season_number}x${w.episode_number}`))

  // "Watched up to here": every episode before this one (earlier seasons by
  // TMDB's episode count, this season by its list) that isn't marked yet, plus
  // this one. Episodes already watched keep their date and plays.
  async function watchUpTo(epNum: number) {
    const refs: { season: number; episode: number }[] = []
    for (const s of realSeasons) {
      if (s.season_number >= season) continue
      for (let e = 1; e <= s.episode_count; e++) refs.push({ season: s.season_number, episode: e })
    }
    for (const ep of seasonData?.episodes ?? []) if (ep.episode_number <= epNum) refs.push({ season, episode: ep.episode_number })
    const todo = refs.filter(r => !watchedAll.has(`${r.season}x${r.episode}`))
    if (todo.length === 0) return
    const label = `S${String(season).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
    const timed = await withWhen(todo, `Up to ${label} · watched ones keep their date`)
    if (!timed) return
    await runMarkRefs(timed, 'watched', `Marking up to ${label}…`, `Watched up to ${label}`)
  }

  const epLabel = (r: { season: number; episode: number }) => `S${r.season} · E${r.episode}`

  // Marks exactly the skipped episodes, through the same when-watched prompt.
  async function markGaps() {
    const timed = await withWhen(gaps.map(episode => ({ season, episode })), 'Marks only these episodes')
    if (!timed) return
    await runMarkRefs(timed, 'watched', `Marking ${plural(timed.length)} as watched…`, 'Marked as watched')
  }

  // Trakt's "when did you watch it?": each episode gets its own time — with
  // Release date, its own air date. Null = cancelled.
  // `strict`: changing a date — an episode with no known air date is left as
  // it is instead of getting today's date.
  async function withWhen(refs: { season: number; episode: number }[], verb: string, strict = false) {
    const one = refs.length === 1 ? refs[0] : null
    const air = one && one.season === season ? (seasonData?.episodes ?? []).find(e => e.episode_number === one.episode)?.air_date : null
    const when = await ask({
      title: one ? `${tv.name} · ${epLabel(one)}` : `${tv.name} · ${refs.length} episodes`,
      subtitle: verb,
      releaseLabel: one ? (air ? formatDate(air) : null) : 'each air date',
    })
    if (!when) return null
    const now = new Date().toISOString()
    const dates = when.kind === 'release' ? await episodeAirDates(qc, tv.id, refs) : new Map<string, string | null>()
    const known = strict && when.kind === 'release' ? refs.filter(r => !!dates.get(`${r.season}x${r.episode}`)) : refs
    if (known.length < refs.length) toast.warning(`${refs.length - known.length} episode${refs.length - known.length === 1 ? '' : 's'} left as they were — TMDB has no air date`)
    return known.map(r => ({ ...r, at: resolveWatchedAt(when, dates.get(`${r.season}x${r.episode}`), 'episode', now)! }))
  }

  const plural = (n: number) => `${n} episode${n > 1 ? 's' : ''}`

  // useMarkEpisodeWatched refreshes progress + the schedule (the DB trigger
  // deletes a watched episode's planned block, migration 043) and toasts errors.
  async function markSelectedWatched() {
    const refs = await withWhen(selectedUnwatched.map(episode => ({ season, episode })), 'When did you watch it?')
    if (refs) await runMarkRefs(refs, 'watched', `Marking ${plural(refs.length)} as watched…`, 'Marked as watched')
  }
  async function watchSelectedAgain() {
    const refs = await withWhen(selectedWatched.map(episode => ({ season, episode })), 'When did you watch it again?')
    if (refs) await runMarkRefs(refs, 'again', `Counting another play of ${plural(refs.length)}…`, 'Play counted')
  }
  // Change when episodes already watched were watched (Release date = each one's own air date).
  async function changeDates(refs: { season: number; episode: number }[], verb: string) {
    // Trakt keeps a date per play; the app keeps one per episode, so every play gets the new date.
    const multi = watched.filter(w => (w.repeat_count ?? 0) > 0 && refs.some(r => r.season === w.season_number && r.episode === w.episode_number)).length
    if (multi > 0 && !(await modal.confirm({
      title: `${multi} of them ${multi === 1 ? 'was' : 'were'} watched more than once`,
      message: 'The app keeps one date per episode, so every play of those episodes gets the new date — here and on Trakt.',
      confirmLabel: 'Change anyway',
    }))) return
    const timed = await withWhen(refs, verb, true)
    if (!timed || timed.length === 0) return
    setMarking(true)
    const ok = await withProgress(
      () => setDates.mutateAsync({ tvEntryId, episodes: timed }).then(n => n),
      { loading: 'Changing watched dates…', success: 'Watched dates changed' },
    )
    if (ok != null) setSelected(new Set())
    setMarking(false)
  }
  const changeSelectedDates = () => changeDates(selectedWatched.map(episode => ({ season, episode })), 'Change when you watched them')
  const changeAllDates = () => changeDates(watched.map(w => ({ season: w.season_number, episode: w.episode_number })), `Every watched episode (${watched.length})`)

  async function unmarkSelected() {
    const ok = await modal.confirm({
      title: `Mark ${plural(selectedWatched.length)} as not watched?`,
      message: 'Removes the watched date and every play counted for them.',
      confirmLabel: 'Mark not watched',
      destructive: true,
    })
    if (ok) await runMark(selectedWatched, 'unwatched', 'Removing watched…', 'Marked as not watched')
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
      {dialog}
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
        {watched.length > 0 && (
          <Button size="sm" variant="ghost" icon={<CalendarDays />} onClick={() => { void changeAllDates() }} disabled={marking} title="Change the watched date of every watched episode — e.g. each to its release date">
            Dates
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelected(new Set((seasonData?.episodes ?? []).map(e => e.episode_number)))}
          disabled={isLoading || !seasonData}
          aria-label="Select all episodes"
        >
          {/* "All" on phones leaves the season tabs room on the same row. */}
          <span className="sm:hidden">All</span><span className="hidden sm:inline">Select all</span>
        </Button>
      </div>

      {selected.size > 0 && (
        // Two rows: what is selected (and Clear), then the actions that wrap as
        // needed — the count used to be squeezed to one letter per line.
        <div className="mb-2 flex flex-col gap-1.5 rounded-row border border-accent-500/30 bg-accent-50 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body font-medium text-accent-700 tabular-nums">
              {selected.size} episode{selected.size > 1 ? 's' : ''} selected
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedUnwatched.length > 0 && (
              <Button size="sm" onClick={markSelectedWatched} loading={marking} icon={<Check />}>
                {selectedWatched.length > 0 ? `Mark ${selectedUnwatched.length} watched` : 'Mark watched'}
              </Button>
            )}
            {selectedWatched.length > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={() => { void changeSelectedDates() }} disabled={marking} icon={<CalendarDays />}>Change date</Button>
                <Button size="sm" onClick={watchSelectedAgain} disabled={marking} icon={<RotateCcw />}>Watched again</Button>
                <Button size="sm" variant="ghost" onClick={unmarkSelected} disabled={marking} icon={<Undo2 />}>Not watched</Button>
              </>
            )}
            {selected.size === 1 && (
              <Button size="sm" onClick={() => { void watchUpTo(Math.max(...selected)) }} disabled={marking} icon={<ListChecks />}>Up to here</Button>
            )}
            <Button size="sm" variant="primary" onClick={openPlan} icon={<CalendarPlus />}>Plan</Button>
          </div>
        </div>
      )}

      {!isLoading && gaps.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-row border border-line bg-surface-2 px-3 py-1.5">
          <p className="min-w-0 flex-1 text-meta text-fg-2">
            {gaps.map(n => `E${n}`).join(', ')} {gaps.length === 1 ? "isn't" : "aren't"} marked watched
            {playback && <span className="text-fg-muted"> (Trakt has {gaps.length === 1 ? 'it' : 'them'} {gaps.some(n => pausedAt.has(n)) ? 'paused or unmarked' : 'unmarked'})</span>}
          </p>
          <Button size="sm" variant="ghost" icon={<Check />} onClick={() => { void markGaps() }} disabled={marking}>
            Mark {gaps.length === 1 ? 'it' : 'them'}
          </Button>
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
            const watchedRow = watchedMap.get(ep.episode_number)
            const watchedOn  = watchedRow?.watched_at
            const plays      = 1 + Math.max(0, watchedRow?.repeat_count ?? 0)
            const runtime    = ep.runtime ?? tv.episode_run_time?.[0] ?? null
            const paused     = pausedAt.get(ep.episode_number) ?? null

            const aired = !!ep.air_date && ep.air_date <= TODAY
            return (
              <div key={ep.episode_number} className="group flex items-center gap-1">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleSelect(ep.episode_number)}
                className={[
                  'flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 rounded-row px-2 py-1 text-left transition-colors',
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
                    <Truncate className={`min-w-0 text-body font-medium ${isWatched ? 'text-fg-muted' : 'text-fg'}`}>{ep.name}</Truncate>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-micro text-fg-muted tabular-nums">
                    {runtime && <span>{runtime}m</span>}
                    {ep.air_date && (
                      <span>{formatDate(ep.air_date)}</span>
                    )}
                    {isWatched && watchedOn && (
                      <span className="font-medium text-success">
                        {plays > 1 ? 'Last watched' : 'Watched'} {isUnknownWatchedAt(watchedOn) ? '· date unknown' : formatDate(watchedOn)}
                      </span>
                    )}
                    {isWatched && plays > 1 && (
                      <TonePill tone="info" className="shrink-0"><Repeat aria-hidden className="h-3 w-3" />{plays} plays</TonePill>
                    )}
                    {!isWatched && paused != null && (
                      <TonePill tone="warn" className="shrink-0">Paused at {paused} %</TonePill>
                    )}
                  </span>
                </span>

                {isWatched && (
                  <span aria-label="Watched" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
              {!isWatched && aired && (
                <button
                  type="button"
                  onClick={() => { void watchUpTo(ep.episode_number) }}
                  disabled={marking}
                  title="Watched up to here"
                  aria-label={`Watched up to episode ${ep.episode_number}`}
                  className="grid min-h-[44px] w-11 shrink-0 place-items-center rounded-row text-fg-faint transition-colors hover:bg-surface-hover hover:text-success disabled:opacity-40"
                >
                  <ListChecks className="h-4 w-4" />
                </button>
              )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
