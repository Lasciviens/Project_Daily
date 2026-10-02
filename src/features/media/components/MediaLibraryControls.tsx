import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, SkipForward, Trash2, CheckCircle2, Heart } from 'lucide-react'
import { toast } from '../../../app/store'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { haptic } from '../../../shared/utils/haptics'
import { tmdbMovieUrl, tmdbTVUrl } from '../../../integrations/tmdb/client'
import { Button, SectionLabel } from '../../../shared/ui'
import { STAGE_TONE, type Stage } from '../../../shared/theme/stage'
import { useEntityModal } from '../../../shared/modals'
import { useMarkEpisodeWatched, useWatchedEpisodes } from '../hooks/useWatchedEpisodes'
import { episodeAirDates } from '../hooks/useTMDB'
import { useWatchedWhenPrompt } from '../hooks/useWatchedWhenPrompt'
import { resolveWatchedAt } from '../watchedWhen'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useAddMovie, useDeleteMovie, useUpdateMovie } from '../hooks/useMovies'
import { useAddTV, useDeleteTV, useUpdateTV } from '../hooks/useTVSeries'
import { useNextEpisode } from '../hooks/useNextEpisode'
import { PlanThisButton } from './PlanThisButton'
import { StarRating } from './StarRating'
import { MovieWatchedControls } from './MovieWatchedControls'
import { CinemaVisits } from './CinemaVisits'
import { SeriesFinishedControls } from './SeriesFinishedControls'
import { todayStr } from '../../../shared/utils/dateUtils'
import { AddToListMenu } from './AddToListMenu'
import { QueueButton } from './QueueButton'
import { ReleaseReminderButton } from './ReleaseReminderButton'
import { FollowMenu } from './FollowMenu'
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

/** Status picker: an aligned two-column grid, each status in its shared stage colour (shared/theme/stage.ts). */
function StatusPills({ statuses, value, disabled, onPick }: {
  statuses: typeof MOVIE_STATUSES
  value: PillStatus
  disabled?: boolean
  onPick: (s: PillStatus) => void
}) {
  return (
    <div role="group" aria-label="Status" className="grid grid-cols-2 gap-1">
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
  const modal = useEntityModal()

  const addMovie    = useAddMovie()
  const addTV       = useAddTV()
  const removeMovie = useDeleteMovie()
  const removeTV    = useDeleteTV()
  const updateMovie = useUpdateMovie()
  const updateTV    = useUpdateTV()
  const markWatched = useMarkEpisodeWatched()

  const entryId    = userEntry?.id
  const tvEntry    = !isMovie && userEntry ? (userEntry as UserTVEntry) : null
  const movieEntry = isMovie && userEntry ? (userEntry as UserMovieEntry) : null
  const updating   = updateMovie.isPending || updateTV.isPending
  const tmdbHref   = isMovie ? tmdbMovieUrl(movie!.id) : tmdbTVUrl(tv!.id)

  // The same source of truth as Daily's "Watch next" card (handles season
  // rollover from the real watched rows); the query is shared, so this is free.
  const nextEp = useNextEpisode(tvEntry?.id ?? null, tv?.id ?? null, tv?.number_of_episodes ?? null)
  const { data: watchedRows = [] } = useWatchedEpisodes(tvEntry?.id ?? null)
  const qc = useQueryClient()
  const { ask, dialog } = useWatchedWhenPrompt()

  // Private note, saved on blur; re-seeded when a different entry is shown
  // (adjust-state-during-render, not an effect).
  const [note, setNote] = useState(userEntry?.personal_note ?? '')
  const [noteFor, setNoteFor] = useState(entryId)
  if (entryId !== noteFor) {
    setNoteFor(entryId)
    setNote(userEntry?.personal_note ?? '')
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
    if (completed && isMovie) {
      const when = await ask({ title: movie!.title, releaseLabel: movie!.release_date ? formatDate(movie!.release_date) : null })
      if (!when) return
      movieWatchedAt = resolveWatchedAt(when, movie!.release_date, 'movie', now)
    }
    if (completed && !isMovie) {
      tvWhen = await ask({ title: tv!.name, subtitle: 'Marks every aired episode as watched.', releaseLabel: 'each air date' })
      if (!tvWhen) return
    }
    await withProgress(async () => {
      if (isMovie) {
        await addMovie.mutateAsync({ tmdb: movie!, status: selectedStatus as UserMovieEntry['status'], watchedAt: movieWatchedAt })
      } else {
        const dates = completed ? { started_at: now, finished_at: now } : selectedStatus === 'watching' ? { started_at: now } : {}
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
    const title = isMovie ? movie!.title : tv!.name
    if (!(await modal.confirm({
      title: `Remove "${title}" from your library?`,
      message: 'With Trakt connected, its watch history, rating and watchlist entry are removed there too.',
      confirmLabel: 'Remove', destructive: true,
    }))) return
    const ok = await withProgress(async () => {
      if (isMovie) await removeMovie.mutateAsync(entryId)
      else await removeTV.mutateAsync(entryId)
      return true
    }, { loading: 'Removing…', success: 'Removed from library' })
    if (ok) onRemoved?.()
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

  async function handleStatusChange(status: MediaStatus) {
    const now = new Date().toISOString()
    const patch: EntryPatch = { status }
    if (movieEntry && status === 'completed' && movieEntry.status !== 'completed') {
      const when = await ask({ title: movie!.title, releaseLabel: movie!.release_date ? formatDate(movie!.release_date) : null })
      if (!when) return
      patch.watched_at = resolveWatchedAt(when, movie!.release_date, 'movie', now)
    }
    if (tvEntry && status === 'completed' && tvEntry.status !== 'completed') {
      const when = await ask({ title: tv!.name, subtitle: 'Marks every aired episode you haven’t marked yet.', releaseLabel: 'each air date' })
      if (!when) return
      const ok = await withProgress(() => markAllAired(when).then(() => true), { loading: 'Marking every aired episode…' })
      if (!ok) return
    }
    // Completing stamps finished_at, and the first Watching stamps started_at —
    // otherwise watch-hours and "recently finished" undercount.
    if (tvEntry && status === 'completed' && !tvEntry.finished_at) patch.finished_at = now
    if (tvEntry && status === 'watching' && !tvEntry.started_at) patch.started_at = now
    void withProgress(() => patchEntry(patch), { loading: 'Updating status…', success: 'Status updated' })
  }

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
    await withProgress(
      () => markWatched.mutateAsync({ tvEntryId: tvEntry.id, episodes: [{ season, episode, at }] }),
      { loading: 'Marking next episode watched…', success: `S${season} E${episode} watched` },
    )
  }

  if (!userEntry || !entryId) {
    return (
      <div className="space-y-3">
        {dialog}
        <StatusPills statuses={statuses} value="unwatched" disabled={addMovie.isPending || addTV.isPending}
          onPick={s => { if (s !== 'unwatched') void handleAdd(s) }} />
        <div className="flex flex-wrap items-center gap-2">
          <QueueButton type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
          <ReleaseReminderButton type={isMovie ? 'movie' : 'tv'} tmdbId={detail.id} title={isMovie ? movie!.title : tv!.name} posterPath={detail.poster_path ?? null} releaseDate={(isMovie ? movie!.release_date : tv!.first_air_date) || null} />
          <AddToListMenu type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
          <a href={tmdbHref} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
            TMDB <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {dialog}
      <div className="space-y-2">
        <StatusPills statuses={statuses} value={userEntry.status} disabled={updating} onPick={s => { void (s === 'unwatched' ? handleRemove() : handleStatusChange(s)) }} />
        {tvEntry && (
          <p className="text-meta text-fg-muted tabular-nums">Progress: S{tvEntry.current_season} E{tvEntry.current_episode}</p>
        )}
        {movieEntry?.status === 'completed' && (
          <MovieWatchedControls entry={movieEntry} releaseDate={movie!.release_date ?? null} disabled={updating} onPatch={patchEntry} />
        )}
        {tvEntry?.status === 'completed' && (
          <SeriesFinishedControls entry={tvEntry} lastAirDate={tv!.last_air_date ?? null} disabled={updating} onPatch={patchEntry} />
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
      </div>

      <div className="flex flex-wrap gap-2">
        {isMovie && <PlanThisButton entryId={entryId} title={movie!.title} runtimeMinutes={movie!.runtime} />}
        {tvEntry?.status === 'watching' && (
          <Button size="sm" icon={<SkipForward />} onClick={handleNextEpisode} loading={markWatched.isPending}
            title="Record the next episode as watched">
            Next episode
          </Button>
        )}
        {movieEntry?.status === 'watching' && (
          <Button size="sm" icon={<CheckCircle2 />} disabled={updating}
            onClick={() => { void handleStatusChange('completed') }}>
            Mark watched
          </Button>
        )}
        <QueueButton type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
        <AddToListMenu type={isMovie ? 'movie' : 'show'} tmdb={detail.id} title={isMovie ? movie!.title : tv!.name} />
        <FollowMenu detail={detail} isMovie={isMovie} />
        <a href={tmdbHref} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
          TMDB <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        </a>
        <Button size="sm" variant="ghost" icon={<Trash2 />} className="text-danger" onClick={handleRemove}
          disabled={removeMovie.isPending || removeTV.isPending}>
          Remove
        </Button>
      </div>
    </div>
  )
}
