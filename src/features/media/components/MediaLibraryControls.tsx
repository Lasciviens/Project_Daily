import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SkipForward, Trash2, CheckCircle2, Heart, Repeat } from 'lucide-react'
import { toast } from '../../../app/store'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { haptic } from '../../../shared/utils/haptics'
import { Button, SectionLabel, TonePill } from '../../../shared/ui'
import { STAGE_TONE, type Stage } from '../../../shared/theme/stage'
import { useMarkEpisodeWatched, useWatchedEpisodes } from '../hooks/useWatchedEpisodes'
import { episodeAirDates } from '../hooks/useTMDB'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import { resolveWatchedAt, seriesWatchedDates } from '../watchedWhen'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useAddMovie, useDeleteMovie, useUpdateMovie } from '../hooks/useMovies'
import { useAddTV, useDeleteTV, useUpdateTV } from '../hooks/useTVSeries'
import { useNextEpisode } from '../hooks/useNextEpisode'
import { useAddMovieWatch, useMovieNotWatched, useStartRewatch, WAITS_FOR_TRAKT } from '../hooks/useWatches'
import { useWatchesWaitForTrakt } from '../trakt/useTrakt'
import { cacheWatches, isPlaceholder, rewatchStartRound, watchCounts } from '../watches'
import { PlanThisButton } from './PlanThisButton'
import { StarRating } from './StarRating'
import { MovieWatchedControls } from './MovieWatchedControls'
import { CinemaVisits } from './CinemaVisits'
import { MovieWatchingInfo } from './MovieWatchingInfo'
import { SeriesFinishedControls } from './SeriesFinishedControls'
import { SpreadWatchedSheet } from './SpreadWatchedSheet'
import { todayStr } from '../../../shared/utils/dateUtils'
import { AddToListMenu } from './AddToListMenu'
import { QueueButton } from './QueueButton'
import { ReleaseReminderButton } from './ReleaseReminderButton'
import { TRAKT_NOTE_MAX } from '../trakt/traktNotes'
import type { TMDBMovieFull, TMDBTVFull, UserMovieEntry, UserTVEntry, MediaStatus } from '../types'

// No manual "Upcoming" status: "coming soon" is derived from the release date
// (see libraryModel.ts), so a future-dated Wishlist item shows there by itself.
// "Unwatched" is not stored: it is the state of a title that is not in the
// library. Picking any other status adds it; picking Unwatched removes it.
type PillStatus = MediaStatus | 'unwatched'
const MOVIE_STATUSES: { value: PillStatus; label: string }[] = [
  { value: 'unwatched', label: 'Unwatched' },
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped',   label: 'Dropped' },
]

const TV_STATUSES: { value: PillStatus; label: string }[] = [
  { value: 'unwatched', label: 'Unwatched' },
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'paused',    label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped',   label: 'Dropped' },
]

const PILL_STAGE: Record<PillStatus, Stage> = {
  unwatched: 'idle', wishlist: 'planned', watching: 'active', paused: 'paused', completed: 'done', dropped: 'dropped', upcoming: 'upcoming',
}

/** Status picker: an aligned grid (three columns on a phone, two in the md+ rail), each status in its shared stage colour (shared/theme/stage.ts). */
function StatusPills({ statuses, value, disabled, onPick, extra }: {
  statuses: typeof MOVIE_STATUSES
  value: PillStatus
  disabled?: boolean
  onPick: (s: PillStatus) => void
  /** One more cell after the statuses (a movie's "Watch again" fills the grid's free one). */
  extra?: ReactNode
}) {
  return (
    <div role="group" aria-label="Status" className="grid grid-cols-3 gap-1 md:grid-cols-2">
      {statuses.map(s => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          disabled={disabled}
          data-tone={STAGE_TONE[PILL_STAGE[s.value]]}
          onClick={() => { haptic('light'); onPick(s.value) }}
          className="stage-option press-feedback"
        >
          <span aria-hidden className="tone-dot" />
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{s.label}</span>
        </button>
      ))}
      {extra}
    </div>
  )
}

type EntryPatch = Partial<Pick<UserMovieEntry, 'watched_at' | 'rating' | 'personal_note' | 'repeat_count' | 'is_favorite'> & Pick<UserTVEntry, 'started_at' | 'finished_at'>> & { status?: MediaStatus }

interface Props {
  detail: TMDBMovieFull | TMDBTVFull
  isMovie: boolean
  userEntry?: UserMovieEntry | UserTVEntry | null
  /** Called after the title is removed from the library (adding keeps the popup open). */
  onRemoved?: () => void
}

/** Library state for one title: add, status, rating, note, progress, remove. */
export function MediaLibraryControls({ detail, isMovie, userEntry, onRemoved }: Props) {
  const movie = isMovie ? (detail as TMDBMovieFull) : null
  const tv = !isMovie ? (detail as TMDBTVFull) : null
  const statuses = isMovie ? MOVIE_STATUSES : TV_STATUSES

  const addMovie    = useAddMovie()
  const addTV       = useAddTV()
  const removeMovie = useDeleteMovie()
  const removeTV    = useDeleteTV()
  const updateMovie = useUpdateMovie()
  const updateTV    = useUpdateTV()
  const markWatched = useMarkEpisodeWatched()
  const startRewatch = useStartRewatch()
  const addMovieWatch = useAddMovieWatch()
  const movieNotWatched = useMovieNotWatched()
  const traktWaits = useWatchesWaitForTrakt()

  const entryId    = userEntry?.id
  const tvEntry    = !isMovie && userEntry ? (userEntry as UserTVEntry) : null
  const movieEntry = isMovie && userEntry ? (userEntry as UserMovieEntry) : null
  const updating   = updateMovie.isPending || updateTV.isPending || startRewatch.isPending || addMovieWatch.isPending || movieNotWatched.busy
  // Being watched again (migration 149): the round under way.
  const rewatchRound = userEntry && (userEntry.status === 'watching' || userEntry.status === 'paused') ? userEntry.rewatch_round ?? null : null

  // The same source of truth as Daily's "Watch next" card (handles season
  // rollover from the real watched rows); the query is shared, so this is free.
  const nextEp = useNextEpisode(tvEntry?.id ?? null, tv?.id ?? null, tv?.number_of_episodes ?? null)
  const { data: watchedRows = [] } = useWatchedEpisodes(tvEntry?.id ?? null)
  // A placeholder waiting for Trakt's dates would go with the title: removing it waits too.
  const removeWaits = movieEntry
    ? !!movieEntry.watches?.some(w => isPlaceholder(w, traktWaits))
    : watchedRows.some(r => r.watches?.some(w => isPlaceholder(w, traktWaits)))
  const rewatched = watchedRows.reduce((n, w) => {
    const extra = Math.max(0, w.repeat_count ?? 0)
    return extra > 0 ? { episodes: n.episodes + 1, extraPlays: n.extraPlays + extra } : n
  }, { episodes: 0, extraPlays: 0 })
  const qc = useQueryClient()
  const { ask, askMany, dialog } = useWatchedWhenPrompt()
  // "Spread over dates…" while completing: the Spread popup for this entry;
  // saving it marks the episodes, then completes the series with the plan's
  // first and last days as its start and finish.
  const [spreadFor, setSpreadFor] = useState<{ tvEntryId: string; startedAt: string | null } | null>(null)
  // The last aired day (TMDB's last_air_date is the latest aired episode).
  const lastAired = tv?.last_air_date ?? null

  // Private note (also the title's Trakt note), saved on blur; re-seeded when a
  // different entry is shown, or when the stored note changed (a Trakt sync)
  // while nothing new was typed here — so a stale field never saves an old
  // note over one that just came in (adjust-state-during-render, not an effect).
  const storedNote = userEntry?.personal_note ?? ''
  const [note, setNote] = useState(storedNote)
  const [noteSeen, setNoteSeen] = useState(storedNote)
  const [noteFor, setNoteFor] = useState(entryId)
  if (entryId !== noteFor || (storedNote !== noteSeen && (note === noteSeen || note.trim() === storedNote.trim()))) {
    setNoteFor(entryId)
    setNote(storedNote)
    setNoteSeen(storedNote)
  }

  const patchEntry = (patch: EntryPatch): Promise<unknown> =>
    isMovie && movieEntry
      ? updateMovie.mutateAsync({ id: movieEntry.id, patch: patch as Parameters<typeof updateMovie.mutateAsync>[0]['patch'] })
      : tvEntry
        ? updateTV.mutateAsync({ id: tvEntry.id, patch: patch as Parameters<typeof updateTV.mutateAsync>[0]['patch'] })
        : Promise.resolve()

  // The media hooks toast + log failures; withProgress adds per-call copy.
  // A title outside the library reads Unwatched; picking another status adds
  // it in that status. Completed asks when it was watched, exactly like
  // switching to Completed later; the date goes in with the new row. The popup
  // stays open on the title (now with its library controls).
  async function handleAdd(selectedStatus: MediaStatus) {
    const now = new Date().toISOString()
    const completed = selectedStatus === 'completed'
    let movieWatchedAt: string | null | undefined
    let tvWhen: Parameters<typeof resolveWatchedAt>[0] | null = null
    let spread = false
    if (completed && isMovie) {
      const when = await ask({ title: movie!.title, releaseLabel: movie!.release_date ? formatDate(movie!.release_date) : null })
      if (!when) return
      movieWatchedAt = resolveWatchedAt(when, movie!.release_date, 'movie', now)
    }
    if (completed && !isMovie) {
      const answer = await askMany({ title: tv!.name, subtitle: 'Marks every aired episode as watched.', releaseLabel: 'each air date' })
      if (!answer) return
      if (answer.kind === 'spread') spread = true
      else tvWhen = answer
    }
    if (spread) {
      // Added as Watching; the Spread popup's save makes it Completed (closing
      // it without saving leaves the series Watching, nothing marked).
      const entry = await withProgress(
        () => addTV.mutateAsync({ tmdb: tv!, status: 'watching', dates: {} }),
        { loading: 'Adding to library…' },
      )
      if (entry) setSpreadFor({ tvEntryId: entry.id, startedAt: null })
      return
    }
    await withProgress(async () => {
      if (isMovie) {
        await addMovie.mutateAsync({ tmdb: movie!, status: selectedStatus as UserMovieEntry['status'], watchedAt: movieWatchedAt })
      } else {
        // Completed: the dates follow the answer (Release date = first/last air day), not today.
        const dates = completed && tvWhen ? seriesWatchedDates(tvWhen, tv!.first_air_date, lastAired, now) : selectedStatus === 'watching' ? { started_at: now } : {}
        const entry = await addTV.mutateAsync({ tmdb: tv!, status: selectedStatus as UserTVEntry['status'], dates })
        if (tvWhen) await markAllAired(tvWhen, entry.id, [])
      }
      return true
    }, {
      loading: completed && !isMovie ? 'Adding and marking every aired episode…' : 'Adding to library…',
      success: `Added to library · ${statuses.find(s => s.value === selectedStatus)?.label ?? selectedStatus}`,
    })
  }

  async function handleRemove() {
    if (!entryId) return
    if (removeWaits) {
      toast.info(WAITS_FOR_TRAKT)
      return
    }
    const question = {
      title: `Remove "${isMovie ? movie!.title : tv!.name}" from your library?`,
      message: 'With Trakt connected, its watch history, rating and watchlist entry are removed there too. Undo puts the title back here and its watches on Trakt again, each as a new play at its own date.',
      confirmLabel: 'Remove',
      done: 'Removed from library',
    }
    const result = isMovie ? await removeMovie.run([entryId], question) : await removeTV.run([entryId], question)
    if (result === 'deleted' || result === 'gone') onRemoved?.()
  }

  // Completing a whole series marks every aired episode not marked yet (each
  // with the chosen time — Release date = its own air date), like Trakt.
  async function markAllAired(when: Parameters<typeof resolveWatchedAt>[0], tvEntryId = tvEntry?.id, watched = watchedRows) {
    if (!tvEntryId || !tv) return
    const refs = (tv.seasons ?? []).filter(x => x.season_number > 0)
      .flatMap(x => Array.from({ length: x.episode_count }, (_, i) => ({ season: x.season_number, episode: i + 1 })))
    const dates = await episodeAirDates(qc, tv.id, refs)
    const today = todayStr()
    const have = new Set(watched.map(w => `${w.season_number}x${w.episode_number}`))
    const now = new Date().toISOString()
    const todo = refs
      .filter(r => { const d = dates.get(`${r.season}x${r.episode}`); return !!d && d <= today && !have.has(`${r.season}x${r.episode}`) })
      .map(r => ({ ...r, at: resolveWatchedAt(when, dates.get(`${r.season}x${r.episode}`), 'episode', now)! }))
    if (todo.length) await markWatched.mutateAsync({ tvEntryId, episodes: todo })
  }

  // Watch it again: Watching, round N — one more than its fewest watches
  // (a movie: its watches + 1; a show: its least-watched regular episode + 1).
  async function handleWatchAgain() {
    const round = movieEntry
      ? (movieEntry.watches ?? cacheWatches(movieEntry)).length + 1
      : rewatchStartRound([...watchCounts(watchedRows.filter(w => w.season_number > 0)).values()])
    await withProgress(
      () => startRewatch.mutateAsync({ kind: movieEntry ? 'movie' : 'tv', id: entryId!, round }).then(() => true),
      { loading: 'Starting a rewatch…', success: `Watching again · round ${round}` },
    )
  }

  // A movie watched again: one more watch at its time (the database ends the round).
  async function finishMovieRewatch() {
    if (!movieEntry) return
    const when = await ask({ title: movie!.title, subtitle: 'When did you finish watching it again?', releaseLabel: movie!.release_date ? formatDate(movie!.release_date) : null })
    if (!when) return
    const at = resolveWatchedAt(when, movie!.release_date, 'movie', new Date().toISOString())
    await withProgress(() => addMovieWatch.mutateAsync({ entry: movieEntry, at }).then(() => true), { loading: 'Adding a watch…', success: 'Watched again · Completed' })
  }

  async function handleStatusChange(status: MediaStatus) {
    if (status === 'completed' && rewatchRound != null) {
      // Ending a rewatch: a movie gets its new watch; a show simply goes back to Completed.
      if (movieEntry) return finishMovieRewatch()
      void withProgress(() => patchEntry({ status: 'completed' }), { loading: 'Updating status…', success: 'Rewatch ended · Completed' })
      return
    }
    // Wishlist on a watched movie removes every watch: the Not watched question and its Undo.
    if (movieEntry && (status === 'wishlist' || status === 'upcoming') && (movieEntry.watches ?? cacheWatches(movieEntry)).length > 0
        && (movieEntry.watches || movieEntry.status === 'completed')) {
      await movieNotWatched.run(movieEntry, traktWaits)
      return
    }
    const now = new Date().toISOString()
    const patch: EntryPatch = { status }
    if (movieEntry && status === 'completed' && movieEntry.status !== 'completed') {
      const when = await ask({ title: movie!.title, releaseLabel: movie!.release_date ? formatDate(movie!.release_date) : null })
      if (!when) return
      patch.watched_at = resolveWatchedAt(when, movie!.release_date, 'movie', now)
    }
    if (tvEntry && status === 'completed' && tvEntry.status !== 'completed') {
      const when = await askMany({ title: tv!.name, subtitle: 'Marks every aired episode you haven’t marked yet.', releaseLabel: 'each air date' })
      if (!when) return
      if (when.kind === 'spread') {
        setSpreadFor({ tvEntryId: tvEntry.id, startedAt: tvEntry.started_at ?? null })
        return
      }
      const ok = await withProgress(() => markAllAired(when).then(() => true), { loading: 'Marking every aired episode…' })
      if (!ok) return
      const d = seriesWatchedDates(when, tv!.first_air_date, lastAired, now)
      patch.finished_at = d.finished_at
      if (!tvEntry.started_at) patch.started_at = d.started_at
    }
    // Completing stamps finished_at, and the first Watching stamps started_at —
    // otherwise watch-hours and "recently finished" undercount.
    if (tvEntry && status === 'watching' && !tvEntry.started_at) patch.started_at = now
    void withProgress(() => patchEntry(patch), { loading: 'Updating status…', success: 'Status updated' })
  }

  const spreadDialog = spreadFor && tv ? (
    <SpreadWatchedSheet
      tvId={tv.id}
      tvName={tv.name}
      tvEntryId={spreadFor.tvEntryId}
      seasons={(tv.seasons ?? []).filter(x => x.season_number > 0).map(x => x.season_number)}
      defaultRuntime={tv.episode_run_time?.[0] ?? null}
      onClose={() => setSpreadFor(null)}
      onSaved={({ firstAt, lastAt }) => updateTV.mutateAsync({
        id: spreadFor.tvEntryId,
        patch: { status: 'completed', finished_at: lastAt, started_at: spreadFor.startedAt ?? firstAt },
      })}
    />
  ) : null

  function saveNote() {
    if (note.trim() === (userEntry?.personal_note ?? '')) return
    void withProgress(() => patchEntry({ personal_note: note.trim() || null }), { loading: 'Saving note…', success: 'Note saved' })
  }

  // Records a real watched-episode row; the next episode comes from
  // useNextEpisode (season rollover), never `current_episode + 1`.
  async function handleNextEpisode() {
    if (!tvEntry) return
    const info = nextEp.data
    if (!info || info.caughtUp || info.season == null || info.episode == null) {
      toast.success('Caught up — no next episode')
      return
    }
    const { season, episode } = info
    const when = await ask({ title: `${tv!.name} · S${season} · E${episode}`, releaseLabel: info.airDate ? formatDate(info.airDate) : null })
    if (!when) return
    const at = resolveWatchedAt(when, info.airDate, 'episode', new Date().toISOString())!
    // In a rewatch round the next episode gets one more watch; its earlier ones keep their dates.
    await withProgress(
      () => markWatched.mutateAsync({ tvEntryId: tvEntry.id, episodes: [{ season, episode, at }], again: !!info.rewatch }),
      { loading: 'Marking next episode watched…', success: `S${season} E${episode} watched` },
    )
  }

  if (!userEntry || !entryId) {
    return (
      <div className="space-y-3">
        {dialog}
        {spreadDialog}
        <StatusPills statuses={statuses} value="unwatched" disabled={addMovie.isPending || addTV.isPending}
          onPick={s => { if (s !== 'unwatched') void handleAdd(s) }} />
        <div className="flex flex-wrap items-center gap-2">
          <QueueButton type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
          <ReleaseReminderButton type={isMovie ? 'movie' : 'tv'} tmdbId={detail.id} title={isMovie ? movie!.title : tv!.name} posterPath={detail.poster_path ?? null} releaseDate={(isMovie ? movie!.release_date : tv!.first_air_date) || null} />
          <AddToListMenu type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {dialog}
      {spreadDialog}
      <div className="space-y-2">
        <StatusPills statuses={statuses} value={userEntry.status} disabled={updating} onPick={s => { void (s === 'unwatched' ? handleRemove() : handleStatusChange(s)) }}
          extra={movieEntry?.status === 'completed' ? (
            // Watching = plain Watching; this starts a rewatch round (migration 149).
            <button type="button" disabled={updating} data-tone={STAGE_TONE.active} onClick={() => { haptic('light'); void handleWatchAgain() }} className="stage-option press-feedback">
              <Repeat aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Watch again</span>
            </button>
          ) : null} />
        {tvEntry && rewatchRound != null ? (
          // A rewatch reads as one: its round and the next episode of it.
          <p className="text-meta text-fg-muted tabular-nums">
            Rewatching · round {rewatchRound}
            {nextEp.data?.rewatch && (nextEp.data.caughtUp
              ? ' · round finished'
              : nextEp.data.season != null && ` · next S${String(nextEp.data.season).padStart(2, '0')}E${String(nextEp.data.episode).padStart(2, '0')}`)}
          </p>
        ) : tvEntry && (
          <p className="text-meta text-fg-muted tabular-nums">Progress: S{tvEntry.current_season} E{tvEntry.current_episode}</p>
        )}
        {tvEntry && rewatched.episodes > 0 && (
          // A count for the whole show; each episode's watches and their dates are in its watch list.
          <TonePill tone="info" className="tabular-nums">
            <Repeat aria-hidden className="h-3.5 w-3.5" />
            {rewatched.episodes} episode{rewatched.episodes === 1 ? '' : 's'} rewatched · {rewatched.extraPlays} extra watch{rewatched.extraPlays === 1 ? '' : 'es'}
          </TonePill>
        )}
        {movieEntry?.status === 'watching' && (rewatchRound != null
          ? <p className="text-meta text-fg-muted tabular-nums">Rewatching · watch {rewatchRound}</p>
          : <MovieWatchingInfo entry={movieEntry} />)}
        {movieEntry?.status === 'completed' && (
          <MovieWatchedControls entry={movieEntry} releaseDate={movie!.release_date ?? null} disabled={updating} />
        )}
        {tvEntry?.status === 'completed' && (
          <SeriesFinishedControls entry={tvEntry} lastAirDate={tv!.last_air_date ?? null} disabled={updating} onPatch={patchEntry} onWatchAgain={() => { void handleWatchAgain() }} />
        )}
        {movieEntry && <CinemaVisits entry={movieEntry} />}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <SectionLabel>Your rating</SectionLabel>
          <button
            type="button"
            aria-pressed={!!userEntry.is_favorite}
            disabled={updating}
            title={userEntry.is_favorite ? 'Remove from favorites' : 'Add to favorites (synced with Trakt)'}
            onClick={() => { haptic('light'); void withProgress(() => patchEntry({ is_favorite: !userEntry.is_favorite }), { loading: 'Saving…', success: userEntry.is_favorite ? 'Removed from favorites' : 'Added to favorites' }) }}
            className="-my-2 grid min-h-[44px] min-w-[44px] place-items-center rounded-control text-fg-muted hover:text-danger aria-pressed:text-danger"
          >
            <Heart aria-hidden className={`h-5 w-5 ${userEntry.is_favorite ? 'fill-current' : ''}`} />
          </button>
        </div>
        <StarRating
          value={(movieEntry ?? tvEntry)?.rating}
          onChange={value => { void withProgress(() => patchEntry({ rating: value }), { loading: 'Saving rating…', success: 'Rating saved' }) }}
          disabled={updating}
        />
      </div>

      <div>
        <label htmlFor="media-note" className="field-label">Your note</label>
        <textarea
          id="media-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={saveNote}
          placeholder="Private note…"
          rows={2}
          className="input min-h-[56px] w-full resize-y py-2"
        />
        {/* The note is also the title's Trakt note; Trakt's limit is 500 characters (traktNotes.ts). */}
        {note.trim().length > TRAKT_NOTE_MAX && (
          <p className="mt-1 text-micro text-fg-muted">
            Trakt keeps notes up to {TRAKT_NOTE_MAX} characters: it gets the first {TRAKT_NOTE_MAX - 1} and “…”, the whole note stays here.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1 sm:gap-2">
        {isMovie && <PlanThisButton entryId={entryId} title={movie!.title} runtimeMinutes={movie!.runtime} />}
        {tvEntry?.status === 'watching' && (
          <Button size="sm" icon={<SkipForward />} onClick={handleNextEpisode} loading={markWatched.isPending}
            title="Record the next episode as watched">
            Next episode
          </Button>
        )}
        {movieEntry?.status === 'watching' && (
          <Button size="sm" icon={<CheckCircle2 />} disabled={updating}
            onClick={() => { void (rewatchRound != null ? finishMovieRewatch() : handleStatusChange('completed')) }}>
            Mark watched
          </Button>
        )}
        <QueueButton type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
        <AddToListMenu type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
        {/* Icon-only on phones so the row fits one line at 393px. */}
        <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger max-sm:px-2.5" onClick={handleRemove}
          aria-label="Remove from library" disabled={removeMovie.busy || removeTV.busy}>
          <span className="max-sm:sr-only">Remove</span>
        </Button>
      </div>
    </div>
  )
}
