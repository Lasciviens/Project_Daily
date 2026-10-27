import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { episodeAirDates, useSeasonDetails } from '../hooks/useTMDB'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import { offersSpread, resolveWatchedAt } from '../watchedWhen'
import type { SpreadMode } from '../spreadWatched'
import { useWatchedEpisodes, useMarkEpisodeWatched, useSetEpisodeDates, useUnmarkEpisodes } from '../hooks/useWatchedEpisodes'
import { useWatchesWaitForTrakt } from '../trakt/useTrakt'
import { useDeleteWatches, WAITS_FOR_TRAKT } from '../hooks/useWatches'
import { useWatchPick } from '../hooks/useWatchPick'
import type { WatchPickAnswer } from './WatchPickSheet'
import { CalendarDays, CalendarPlus, CalendarRange, Check, History, Hourglass, ListChecks, RotateCcw, Undo2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, SectionLabel, Skeleton, TonePill, Truncate } from '../../../shared/ui'
import { ceilToQuarter } from '../../../shared/components/plan-modal/planModal.config'
import type { TMDBTVFull, WatchedEpisode } from '../types'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { toast } from '../../../app/store'
import { useTraktPlayback } from '../trakt/useTraktExtras'
import { pausedEpisodes, seasonGaps } from '../episodeGaps'
import { cacheWatches, doneInRound, editableWatches, isPlaceholder, sortWatches, watchDate, watchFor, watchMark, type Watch } from '../watches'
import { SpreadWatchedSheet } from './SpreadWatchedSheet'
import { WatchesSheet } from './WatchesSheet'
import { WatchHistoryButton } from './WatchHistoryButton'

interface Props {
  tv:         TMDBTVFull
  tvEntryId:  string
  /** Watching it again (migration 149): the round under way and when it started — progress follows it. */
  rewatch?: { round: number; startedAt: string } | null
}

type EpisodeKey = { season: number; episode: number }

/** An episode's watches: the list (migration 149), else its plays at the one kept date. */
const watchesOf = (row: WatchedEpisode): Watch[] => row.watches ?? cacheWatches(row)

export function EpisodesPanel({ tv, tvEntryId, rewatch = null }: Props) {
  const TODAY = todayStr()
  const realSeasons = (tv.seasons ?? []).filter(s => s.season_number > 0)
  const [season,    setSeason]    = useState(realSeasons[0]?.season_number ?? 1)
  const [selected,  setSelected]  = useState<Set<number>>(new Set())
  const [marking,   setMarking]   = useState(false)
  // The Spread popup: the Spread button (a from–to range), or "Spread over
  // dates…" in the when-watched sheet for a fixed set of episodes. `pick`: the
  // watch Change dates moves (the latest unless the user chose).
  const [spread,    setSpread]    = useState<{ only?: EpisodeKey[]; mode: SpreadMode; pick?: WatchPickAnswer } | null>(null)
  // The watch list of one episode (this season).
  const [watchesFor, setWatchesFor] = useState<number | null>(null)

  const { data: seasonData, isLoading } = useSeasonDetails(tv.id, season)
  const { data: watched = [] }          = useWatchedEpisodes(tvEntryId)
  const markWatched                     = useMarkEpisodeWatched()
  const setDates                        = useSetEpisodeDates()
  const removeWatches                   = useDeleteWatches()
  const unmark                          = useUnmarkEpisodes()
  // Placeholders (149's backfill) wait for Trakt's dates until Trakt's whole history has been read.
  const traktWaits                  = useWatchesWaitForTrakt()
  const modal                           = useEntityModal()
  const qc                              = useQueryClient()
  const { ask, askMany, dialog }        = useWatchedWhenPrompt()
  const pick$                           = useWatchPick()

  const watchedSet = new Set(watched.filter(w => w.season_number === season).map(w => w.episode_number))
  const watchedMap = new Map(watched.filter(w => w.season_number === season).map(w => [w.episode_number, w]))
  const rowOf = (r: EpisodeKey) => watched.find(w => w.season_number === r.season && w.episode_number === r.episode)
  // A rewatch round: an episode is done once it has a watch since the round started.
  const doneSet = rewatch ? doneInRound(watched, rewatch.startedAt) : null
  const belowRound = (r: EpisodeKey) => !!doneSet && !doneSet.has(`${r.season}x${r.episode}`)
  // The next episode of the round in this season's list: the first aired one not done (no air date = not aired).
  const nextInSeason = rewatch
    ? (seasonData?.episodes ?? []).find(e => !!e.air_date && e.air_date <= TODAY && belowRound({ season, episode: e.episode_number }))?.episode_number ?? null
    : null
  // The watches a date change or a removal may act on (never a placeholder waiting for Trakt's dates).
  const editableOf = (row: WatchedEpisode) => (row.watches ? editableWatches(row.watches, traktWaits) : [])
  // Trakt's paused playbacks (the same read as Continue watching, one query
  // for every row): an unwatched episode stopped part-way says how far.
  const { data: playback } = useTraktPlayback()
  const pausedAt = pausedEpisodes(playback, tv.id, season)
  // Unwatched aired episodes before the last watched one in this season.
  const gaps = seasonGaps(seasonData?.episodes ?? [], watchedSet, TODAY)

  // Watched count per season — drives the Netflix-style progress on the
  // season tabs (n/total + a green fill bar); in a rewatch, the episodes at
  // the round.
  const watchedBySeason = new Map<number, number>()
  for (const w of watched) {
    if (belowRound({ season: w.season_number, episode: w.episode_number })) continue
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
  // real date with today. It can be watched again (one more watch) or unmarked.
  const selectedWatched   = [...selected].filter(n => watchedSet.has(n))
  const selectedUnwatched = [...selected].filter(n => !watchedSet.has(n))
  // Not watched would remove their placeholders too: those wait for Trakt's dates.
  const selectedWaiting   = selectedWatched.filter(n => !!watchedMap.get(n)?.watches?.some(w => isPlaceholder(w, traktWaits)))

  async function runMarkRefs(episodes: EpisodeKey[], mode: 'watched' | 'again', loading: string, success: string) {
    if (episodes.length === 0) return
    setMarking(true)
    const ok = await withProgress(
      () => markWatched.mutateAsync({
        tvEntryId, episodes, watchedOn: TODAY,
        again: mode === 'again',
      }).then(() => true),
      { loading, success },
    )
    if (ok) setSelected(new Set())
    setMarking(false)
  }

  const watchedAll = new Set(watched.map(w => `${w.season_number}x${w.episode_number}`))

  // "Watched up to here": every episode before this one (earlier seasons by
  // TMDB's episode count, this season by its list) that isn't marked yet, plus
  // this one. Episodes already watched keep their date and watches. In a
  // rewatch round: every one below the round gets one more watch.
  async function watchUpTo(epNum: number) {
    const refs: EpisodeKey[] = []
    for (const s of realSeasons) {
      if (s.season_number >= season) continue
      for (let e = 1; e <= s.episode_count; e++) refs.push({ season: s.season_number, episode: e })
    }
    for (const ep of seasonData?.episodes ?? []) if (ep.episode_number <= epNum) refs.push({ season, episode: ep.episode_number })
    const label = `S${String(season).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`
    if (rewatch) {
      const todo = refs.filter(belowRound)
      if (todo.length === 0) return
      const timed = await withWhen(todo, `Round ${rewatch.round} up to ${label}`, 'again')
      if (!timed) return
      // Unwatched ones get their first watch, the rest one more — both through the one write path.
      await runMarkRefs(timed, 'again', `Counting round ${rewatch.round} up to ${label}…`, `Round ${rewatch.round} up to ${label}`)
      return
    }
    const todo = refs.filter(r => !watchedAll.has(`${r.season}x${r.episode}`))
    if (todo.length === 0) return
    const timed = await withWhen(todo, `Up to ${label} · watched ones keep their date`, 'watched')
    if (!timed) return
    await runMarkRefs(timed, 'watched', `Marking up to ${label}…`, `Watched up to ${label}`)
  }

  const epLabel = (r: EpisodeKey) => `S${r.season} · E${r.episode}`

  // Marks exactly the skipped episodes, through the same when-watched prompt.
  async function markGaps() {
    const timed = await withWhen(gaps.map(episode => ({ season, episode })), 'Marks only these episodes', 'watched')
    if (!timed) return
    await runMarkRefs(timed, 'watched', `Marking ${plural(timed.length)} as watched…`, 'Marked as watched')
  }

  // Trakt's "when did you watch it?": each episode gets its own time — with
  // Release date, its own air date. Null = cancelled, or handed to the Spread
  // popup: for several episodes the sheet's 5th option, "Spread over dates…",
  // opens it for exactly these episodes, saving as `mode` says.
  // `strict`: changing a date — an episode with no known air date is left as
  // it is instead of getting today's date.
  async function withWhen(refs: EpisodeKey[], verb: string, mode: SpreadMode, strict = false, pick?: WatchPickAnswer) {
    const one = refs.length === 1 ? refs[0] : null
    const air = one && one.season === season ? (seasonData?.episodes ?? []).find(e => e.episode_number === one.episode)?.air_date : null
    const prompt = {
      title: one ? `${tv.name} · ${epLabel(one)}` : `${tv.name} · ${refs.length} episodes`,
      subtitle: verb,
      releaseLabel: one ? (air ? formatDate(air) : null) : 'each air date',
    }
    const when = offersSpread(refs.length) ? await askMany(prompt) : await ask(prompt)
    if (!when) return null
    if (when.kind === 'spread') {
      setSpread({ only: refs, mode, pick })
      return null
    }
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
    const refs = await withWhen(selectedUnwatched.map(episode => ({ season, episode })), 'When did you watch it?', 'watched')
    if (refs) await runMarkRefs(refs, 'watched', `Marking ${plural(refs.length)} as watched…`, 'Marked as watched')
  }
  async function watchSelectedAgain() {
    const refs = await withWhen(selectedWatched.map(episode => ({ season, episode })), 'When did you watch it again?', 'again')
    if (refs) await runMarkRefs(refs, 'again', `Adding a watch to ${plural(refs.length)}…`, refs.length === 1 ? 'Watch added' : `${refs.length} watches added`)
  }
  // Change when episodes already watched were watched (Release date = each
  // one's own air date). Each episode keeps every watch but the one chosen —
  // the latest unless the user picks (migration 149).
  async function changeDates(allRefs: EpisodeKey[], verb: string) {
    // Only watches that are real plays move: an episode whose watches all wait
    // for Trakt's dates (placeholders) is left out until the next sync links it.
    const refs = allRefs.filter(r => { const row = rowOf(r); return !!row && editableOf(row).length > 0 })
    const waiting = allRefs.length - refs.length
    if (waiting) toast.info(`${waiting} episode${waiting === 1 ? '' : 's'} wait for Trakt's dates — the next sync brings them`)
    if (!refs.length) return
    const rows = refs.map(rowOf).filter((r): r is WatchedEpisode => !!r)
    const multi = rows.filter(r => editableOf(r).length > 1)
    let pick: WatchPickAnswer = 'latest'
    if (multi.length) {
      const a = await pick$.ask(refs.length === 1
        ? { title: `${tv.name} · ${epLabel(refs[0])}`, watches: watchesOf(multi[0]), traktWaits }
        : { title: `${tv.name} · ${refs.length} episodes`, several: multi.length })
      if (!a) return
      pick = a
    }
    const timed = await withWhen(refs, verb, 'redate', true, pick)
    if (!timed || timed.length === 0) return
    setMarking(true)
    const ok = await withProgress(
      () => setDates.mutateAsync({
        tvEntryId,
        episodes: timed.map(t => { const row = rowOf(t); return { ...t, watchId: row ? watchFor(editableOf(row), pick)?.id ?? null : null } }),
      }).then(n => n),
      { loading: 'Changing watched dates…', success: timed.length === 1 ? 'Watched date changed' : 'Watched dates changed' },
    )
    if (ok != null) setSelected(new Set())
    setMarking(false)
  }
  const changeSelectedDates = () => changeDates(selectedWatched.map(episode => ({ season, episode })), 'Change when you watched it')
  const changeAllDates = () => changeDates(watched.map(w => ({ season: w.season_number, episode: w.episode_number })), `Every watched episode (${watched.length})`)

  // Not watched: the one delete flow (asks, then "· Undo"); every play of them leaves Trakt.
  async function unmarkSelected() {
    const ids = selectedWatched.filter(n => !selectedWaiting.includes(n)).map(n => watchedMap.get(n)?.id).filter((x): x is string => !!x)
    if (!ids.length) {
      if (selectedWaiting.length) toast.info(WAITS_FOR_TRAKT)
      return
    }
    const left = selectedWaiting.length
    const result = await unmark.run(ids, {
      title: `Mark ${plural(ids.length)} as not watched?`,
      message: `Removes every watch of ${ids.length === 1 ? 'it' : 'them'} here and EVERY play of ${ids.length === 1 ? 'it' : 'them'} on Trakt — the ones the app doesn't know too.`
        + (left ? ` ${plural(left)} wait${left === 1 ? 's' : ''} for Trakt's dates and stay${left === 1 ? 's' : ''} as ${left === 1 ? 'it is' : 'they are'}.` : ''),
      confirmLabel: 'Mark not watched',
      done: ids.length === 1 ? 'Marked as not watched' : `${ids.length} episodes marked as not watched`,
      restored: 'Watched again, every watch back',
    })
    if (result === 'deleted') setSelected(new Set())
  }

  // The watch list of one episode: add, re-date or remove single watches.
  const sheetRow = watchesFor != null ? watchedMap.get(watchesFor) ?? null : null
  const sheetRef = watchesFor != null ? { season, episode: watchesFor } : null
  async function removeWatch(w: Watch) {
    const last = (sheetRow ? watchesOf(sheetRow).length : 0) <= 1
    await removeWatches.run([w.id], {
      title: 'Remove this watch?',
      message: last
        ? `${watchDate(w)} is its only watch: the episode becomes not watched. On Trakt only this play goes.`
        : `${watchDate(w)} — on Trakt only this play goes; the other watches stay.`,
      confirmLabel: 'Remove',
      done: last ? 'Watch removed · not watched' : 'Watch removed',
    })
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
      {pick$.dialog}
      {sheetRow && sheetRef && (
        <WatchesSheet
          title={`${tv.name} · ${epLabel(sheetRef)}`}
          target="episode"
          watches={watchesOf(sheetRow)}
          editable={!!sheetRow.watches}
          traktWaits={traktWaits}
          busy={markWatched.isPending || setDates.isPending || removeWatches.busy}
          onClose={() => setWatchesFor(null)}
          onAdd={at => withProgress(
            () => markWatched.mutateAsync({ tvEntryId, episodes: [{ ...sheetRef, at: at ?? undefined }], again: true }).then(() => true),
            { loading: 'Adding a watch…', success: 'Watch added' })}
          onSetDate={(w, at) => withProgress(
            () => setDates.mutateAsync({ tvEntryId, episodes: [{ ...sheetRef, at: at ?? '1970-01-01T00:00:00.000Z', watchId: w.id }] }).then(() => true),
            { loading: 'Changing the date…', success: 'Watched date changed' })}
          onRemove={removeWatch}
        />
      )}
      {spread && (
        <SpreadWatchedSheet
          tvId={tv.id}
          tvName={tv.name}
          tvEntryId={tvEntryId}
          seasons={realSeasons.map(s => s.season_number)}
          defaultRuntime={tv.episode_run_time?.[0] ?? null}
          only={spread.only}
          mode={spread.mode}
          pick={spread.pick}
          traktWaits={traktWaits}
          onClose={saved => { setSpread(null); if (saved) setSelected(new Set()) }}
        />
      )}
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
        <Button size="sm" variant="ghost" icon={<CalendarRange />} onClick={() => setSpread({ mode: 'watched' })} disabled={marking} title="Mark a run of episodes watched across a period you remember — with breaks">
          <span className="hidden sm:inline">Spread</span><span className="sr-only sm:hidden">Spread watched dates</span>
        </Button>
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
                <Button size="sm" variant="ghost" onClick={unmarkSelected} disabled={marking || selectedWaiting.length === selectedWatched.length} icon={<Undo2 />}>Not watched</Button>
              </>
            )}
            {selected.size === 1 && (
              <Button size="sm" onClick={() => { void watchUpTo(Math.max(...selected)) }} disabled={marking} icon={<ListChecks />}>Up to here</Button>
            )}
            {selected.size === 1 && selectedWatched.length === 1 && (
              <Button size="sm" variant="ghost" onClick={() => setWatchesFor(selectedWatched[0])} disabled={marking} icon={<History />}>Watches</Button>
            )}
            <Button size="sm" variant="primary" onClick={openPlan} icon={<CalendarPlus />}>Plan</Button>
          </div>
          {selectedWaiting.length > 0 && (
            <p className="text-micro text-fg-muted">
              <Hourglass aria-hidden className="mr-1 inline h-3 w-3 align-[-2px]" />
              {selectedWaiting.length === 1 ? 'One waits' : `${selectedWaiting.length} wait`} for Trakt's dates: Not watched leaves {selectedWaiting.length === 1 ? 'it' : 'them'} as {selectedWaiting.length === 1 ? 'it is' : 'they are'} until the next Trakt sync.
            </p>
          )}
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
            const watches    = watchedRow ? sortWatches(watchesOf(watchedRow)) : []
            const runtime    = ep.runtime ?? tv.episode_run_time?.[0] ?? null
            const aired      = !!ep.air_date && ep.air_date <= TODAY
            const paused     = pausedAt.get(ep.episode_number) ?? null
            const isNext     = nextInSeason === ep.episode_number
            // In a rewatch, Up to here stays one tap on every episode still to watch in the round.
            const upToHere   = aired && (rewatch ? belowRound({ season, episode: ep.episode_number }) : !isWatched)
            const waitsForTrakt = watches.length > 0 && watches.every(w => isPlaceholder(w, traktWaits))
            // What the row shows of its watches (watches.ts): in a rewatch round an episode reads as
            // done only once watched in it; ×N counts every watch ever; only the round's ✓ is green.
            const mark       = watchMark(watches, rewatch?.startedAt)
            const done       = mark.done

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
                    : done ? 'bg-success-soft/60 hover:bg-success-soft'
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
                    <span className={`shrink-0 text-micro font-bold tabular-nums ${done ? 'text-success' : 'text-fg-faint'}`}>
                      E{String(ep.episode_number).padStart(2, '0')}
                    </span>
                    <Truncate className={`min-w-0 text-body font-medium ${done ? 'text-fg-muted' : 'text-fg'}`}>{ep.name}</Truncate>
                  </span>
                  {/* Each fact stays whole; the watches wrap between dates on a narrow row. */}
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-fg-muted tabular-nums">
                    {runtime && <span className="whitespace-nowrap">{runtime}m</span>}
                    {ep.air_date && (
                      <span className="whitespace-nowrap">{formatDate(ep.air_date)}</span>
                    )}
                    {isNext && <TonePill tone="info" className="shrink-0">Next · round {rewatch?.round}</TonePill>}
                    {/* One watch: its date (green outside a round only); 2+: the ×N counter beside the row. */}
                    {mark.line && <span className={`whitespace-nowrap font-medium ${mark.lineDone ? 'text-success' : ''}`}>{mark.line}</span>}
                    {/* Placeholders: the real dates come with the next Trakt sync. */}
                    {waitsForTrakt && <Hourglass role="img" aria-label="Waiting for Trakt's dates" className="h-3 w-3 shrink-0 text-fg-muted"><title>Waiting for Trakt's dates</title></Hourglass>}
                    {!isWatched && paused != null && (
                      <TonePill tone="warn" className="shrink-0">Paused at {paused} %</TonePill>
                    )}
                  </span>
                </span>

                {done && (
                  <span aria-label="Watched" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
              {upToHere && (
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
              {/* The watch list: ×N from 2 watches (in place of the History icon), the icon for one —
                  last, so the counters line up at the edge in a round, where to-do rows also have Up to here. */}
              {isWatched && (
                <WatchHistoryButton counter={mark.counter} of={`episode ${ep.episode_number}`} onOpen={() => setWatchesFor(ep.episode_number)} disabled={marking} />
              )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
