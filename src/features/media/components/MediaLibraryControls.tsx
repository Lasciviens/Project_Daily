import { useState } from 'react'
import { ExternalLink, SkipForward, Trash2, CheckCircle2 } from 'lucide-react'
import { toast } from '../../../app/store'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { haptic } from '../../../shared/utils/haptics'
import { tmdbMovieUrl, tmdbTVUrl } from '../../../integrations/tmdb/client'
import { Button, SectionLabel } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useMarkEpisodeWatched } from '../hooks/useWatchedEpisodes'
import { useAddMovie, useDeleteMovie, useUpdateMovie } from '../hooks/useMovies'
import { useAddTV, useDeleteTV, useUpdateTV } from '../hooks/useTVSeries'
import { useNextEpisode } from '../hooks/useNextEpisode'
import { PlanThisButton } from './PlanThisButton'
import { StarRating } from './StarRating'
import type { TMDBMovieFull, TMDBTVFull, UserMovieEntry, UserTVEntry, MediaStatus } from '../types'

// No manual "Upcoming" status: "coming soon" is derived from the release date
// (see CompactLibraryStrip), so a future-dated Wishlist item shows there by itself.
const MOVIE_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped',   label: 'Dropped' },
]

const TV_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'paused',    label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped',   label: 'Dropped' },
]

function StatusPills({ statuses, value, disabled, onPick }: {
  statuses: typeof MOVIE_STATUSES
  value: MediaStatus
  disabled?: boolean
  onPick: (s: MediaStatus) => void
}) {
  // Stable 3-column grid on phones (4 and 5 statuses both wrap to 2 rows).
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
      {statuses.map(s => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          disabled={disabled}
          onClick={() => { haptic('light'); onPick(s.value) }}
          className="pill-tab press-feedback justify-center border border-line aria-pressed:border-transparent"
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

type EntryPatch = Partial<Pick<UserMovieEntry, 'watched_at' | 'rating' | 'personal_note'> & Pick<UserTVEntry, 'started_at' | 'finished_at'>> & { status?: MediaStatus }

interface Props {
  detail: TMDBMovieFull | TMDBTVFull
  isMovie: boolean
  userEntry?: UserMovieEntry | UserTVEntry | null
  onAdded?: () => void
}

/** Library state for one title: add, status, rating, note, progress, remove. */
export function MediaLibraryControls({ detail, isMovie, userEntry, onAdded }: Props) {
  const movie = isMovie ? (detail as TMDBMovieFull) : null
  const tv = !isMovie ? (detail as TMDBTVFull) : null
  const statuses = isMovie ? MOVIE_STATUSES : TV_STATUSES
  const modal = useEntityModal()

  const [selectedStatus, setSelectedStatus] = useState<MediaStatus>('wishlist')

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
  async function handleAdd() {
    const ok = await withProgress(async () => {
      if (isMovie) await addMovie.mutateAsync({ tmdb: movie!, status: selectedStatus as UserMovieEntry['status'] })
      else await addTV.mutateAsync({ tmdb: tv!, status: selectedStatus as UserTVEntry['status'] })
      return true
    }, { loading: 'Adding to library…', success: 'Added to library' })
    if (ok) onAdded?.()
  }

  async function handleRemove() {
    if (!entryId) return
    const title = isMovie ? movie!.title : tv!.name
    if (!(await modal.confirm({ title: `Remove "${title}" from your library?`, confirmLabel: 'Remove', destructive: true }))) return
    const ok = await withProgress(async () => {
      if (isMovie) await removeMovie.mutateAsync(entryId)
      else await removeTV.mutateAsync(entryId)
      return true
    }, { loading: 'Removing…', success: 'Removed from library' })
    if (ok) onAdded?.()
  }

  function handleStatusChange(status: MediaStatus) {
    const now = new Date().toISOString()
    const patch: EntryPatch = { status }
    // Completing stamps watched_at / finished_at, and the first Watching stamps
    // started_at — otherwise watch-hours and "recently finished" undercount.
    if (movieEntry && status === 'completed' && !movieEntry.watched_at) patch.watched_at = now
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
    await withProgress(
      () => markWatched.mutateAsync({ tvEntryId: tvEntry.id, episodes: [{ season, episode }] }),
      { loading: 'Marking next episode watched…', success: `S${season} E${episode} watched` },
    )
  }

  if (!userEntry || !entryId) {
    return (
      <div className="space-y-3">
        <StatusPills statuses={statuses} value={selectedStatus} onPick={setSelectedStatus} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={handleAdd} loading={addMovie.isPending || addTV.isPending}>Add to library</Button>
          <a href={tmdbHref} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
            TMDB <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-1.5">Your rating</SectionLabel>
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
          placeholder="Private note — thoughts, where you left off, why you dropped it…"
          rows={2}
          className="input min-h-[64px] w-full resize-y py-2"
        />
      </div>

      <div className="space-y-2">
        <StatusPills statuses={statuses} value={userEntry.status} disabled={updating} onPick={handleStatusChange} />
        {tvEntry && (
          <p className="text-meta text-fg-muted tabular-nums">Progress: S{tvEntry.current_season} E{tvEntry.current_episode}</p>
        )}
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
            onClick={() => { void withProgress(() => patchEntry({ status: 'completed', watched_at: new Date().toISOString() }), { loading: 'Marking watched…', success: 'Marked as watched' }) }}>
            Mark watched
          </Button>
        )}
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
