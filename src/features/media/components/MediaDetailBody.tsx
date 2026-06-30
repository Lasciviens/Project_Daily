import { useState } from 'react'
import { toast } from '../../../app/store'
import { posterUrl, tmdbMovieUrl, tmdbTVUrl } from '../../../integrations/tmdb/client'
import { PlanThisButton } from './PlanThisButton'
import { StarRating } from './StarRating'
import { SimilarRow } from './SimilarRow'
import { EpisodesPanel } from './EpisodesPanel'
import { useAddMovie, useDeleteMovie, useUpdateMovie } from '../hooks/useMovies'
import { useAddTV, useDeleteTV, useUpdateTV } from '../hooks/useTVSeries'
import type {
  TMDBMovieFull, TMDBTVFull,
  TMDBCastMember, TMDBWatchProvider,
  UserMovieEntry, UserTVEntry, MediaStatus,
  TMDBVideo,
} from '../types'

interface Props {
  detail: TMDBMovieFull | TMDBTVFull
  mediaType: 'movie' | 'tv'
  userEntry?: UserMovieEntry | UserTVEntry | null
  onAdded?: () => void
  onOpenDetail?: (id: number, type: 'movie' | 'tv') => void
}

const MOVIE_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'upcoming',  label: 'Upcoming' },
  { value: 'watching',  label: 'Watching' },
  { value: 'completed', label: 'Completed' },
]

const TV_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'paused',    label: 'Paused' },
  { value: 'completed', label: 'Completed' },
]

function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatMoney(amount: number): string {
  return `$${(amount / 1_000_000).toFixed(1)}M`
}

function formatAirDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
}

function findTrailer(videos: TMDBVideo[]): TMDBVideo | undefined {
  return videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')
}

function CastMember({ member }: { member: TMDBCastMember }) {
  const initials = member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
      {member.profile_path ? (
        <img
          src={`https://image.tmdb.org/t/p/w185${member.profile_path}`}
          alt={member.name}
          className="w-12 h-12 rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-ink-200 flex items-center justify-center text-xs font-semibold text-ink-500">
          {initials}
        </div>
      )}
      <p className="text-[10px] text-ink-700 font-medium text-center leading-tight line-clamp-2">{member.name}</p>
      <p className="text-[9px] text-ink-400 text-center leading-tight line-clamp-1">{member.character}</p>
    </div>
  )
}

function ProviderLogo({ provider }: { provider: TMDBWatchProvider }) {
  return (
    <img
      src={`https://image.tmdb.org/t/p/w92${provider.logo_path}`}
      alt={provider.provider_name}
      title={provider.provider_name}
      className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
    />
  )
}

export function MediaDetailBody({ detail, mediaType, userEntry, onAdded, onOpenDetail }: Props) {
  const isMovie = mediaType === 'movie'
  const movie   = isMovie ? (detail as TMDBMovieFull) : null
  const tv      = !isMovie ? (detail as TMDBTVFull) : null

  const isFutureMovie = isMovie && !!movie?.release_date && new Date(movie.release_date) > new Date()
  const [selectedStatus, setSelectedStatus] = useState<MediaStatus>(isFutureMovie ? 'upcoming' : 'wishlist')
  const [showTrailer,    setShowTrailer]    = useState(false)

  const cast          = detail.credits?.cast?.slice(0, 10) ?? []
  const allProviders  = detail['watch/providers']?.results ?? {}
  // Prefer NO (Norway) then TR (Turkey) then US then first available
  const providerData  = allProviders['NO'] ?? allProviders['TR'] ?? allProviders['US'] ?? allProviders[Object.keys(allProviders)[0]]
  const streamProviders = (providerData?.flatrate ?? []).slice(0, 6)
  const providerCountry = allProviders['NO'] ? 'NO' : allProviders['TR'] ? 'TR' : allProviders['US'] ? 'US' : Object.keys(allProviders)[0]

  const director    = movie?.credits?.crew?.find(c => c.job === 'Director')
  const trailer     = findTrailer(detail.videos?.results ?? [])
  const hasBudget   = (movie?.budget ?? 0) > 0

  const statuses = isMovie ? MOVIE_STATUSES : TV_STATUSES

  const addMovie    = useAddMovie()
  const addTV       = useAddTV()
  const removeMovie = useDeleteMovie()
  const removeTV    = useDeleteTV()
  const updateMovie = useUpdateMovie()
  const updateTV    = useUpdateTV()

  const isAdding  = addMovie.isPending || addTV.isPending
  const entryId   = userEntry?.id
  const isOwned   = !!userEntry

  const tvEntry    = !isMovie && isOwned ? (userEntry as UserTVEntry) : null
  const movieEntry = isMovie && isOwned  ? (userEntry as UserMovieEntry) : null

  async function handleAdd() {
    const tid = toast.loading('Adding to library…')
    try {
      if (isMovie) {
        await addMovie.mutateAsync({ tmdb: movie! as TMDBMovieFull, status: selectedStatus as UserMovieEntry['status'] })
      } else {
        await addTV.mutateAsync({ tmdb: tv! as TMDBTVFull, status: selectedStatus as UserTVEntry['status'] })
      }
      toast.dismiss(tid); toast.success('Added to library ✓')
      onAdded?.()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed to add')
    }
  }

  async function handleRemove() {
    if (!entryId) return
    const tid = toast.loading('Removing…')
    try {
      if (isMovie) await removeMovie.mutateAsync(entryId)
      else         await removeTV.mutateAsync(entryId)
      toast.dismiss(tid); toast.success('Removed from library')
      onAdded?.()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed to remove')
    }
  }

  async function handleStatusChange(newStatus: MediaStatus) {
    const tid = toast.loading('Updating status…')
    try {
      if (isMovie && movieEntry) {
        await updateMovie.mutateAsync({ id: movieEntry.id, patch: { status: newStatus as UserMovieEntry['status'] } })
      } else if (tvEntry) {
        await updateTV.mutateAsync({ id: tvEntry.id, patch: { status: newStatus as UserTVEntry['status'] } })
      }
      toast.dismiss(tid); toast.success('Status updated ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  async function handleNextEpisode() {
    if (!tvEntry) return
    const maxEp = (tv?.number_of_episodes ?? 999)
    const ep    = tvEntry.current_episode + 1
    const tid   = toast.loading('Updating episode…')
    try {
      await updateTV.mutateAsync({ id: tvEntry.id, patch: { current_episode: ep > maxEp ? 0 : ep } })
      toast.dismiss(tid); toast.success(`S${tvEntry.current_season} E${ep} ✓`)
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  async function handleMarkWatched() {
    if (!movieEntry) return
    const tid = toast.loading('Marking watched…')
    try {
      await updateMovie.mutateAsync({ id: movieEntry.id, patch: { status: 'completed', watched_at: new Date().toISOString() } })
      toast.dismiss(tid); toast.success('Marked as watched ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  async function handleRatingChange(value: number) {
    const tid = toast.loading('Saving rating…')
    try {
      if (isMovie && movieEntry) {
        await updateMovie.mutateAsync({ id: movieEntry.id, patch: { rating: value } })
      } else if (tvEntry) {
        await updateTV.mutateAsync({ id: tvEntry.id, patch: { rating: value } })
      }
      toast.dismiss(tid); toast.success('Rating saved ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 p-4 sm:p-5">
      {/* Poster — inline on desktop, hidden on mobile (backdrop already shows it) */}
      <div className="hidden md:block flex-shrink-0 self-start">
        <img
          src={posterUrl(detail.poster_path, 'w342')}
          alt={isMovie ? movie!.title : tv!.name}
          className="w-32 rounded-xl object-cover"
        />
      </div>

      <div className="flex-1 min-w-0">
        {detail.overview && (
          <p className="text-sm text-ink-600 leading-relaxed mb-1">{detail.overview}</p>
        )}
        {detail.tagline && (
          <p className="text-xs italic text-ink-400 mb-3">{detail.tagline}</p>
        )}
        {!detail.tagline && detail.overview && <div className="mb-3" />}

        {detail.genres?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {detail.genres.map(g => (
              <span key={g.id} className="bg-ink-100 text-ink-600 text-xs px-2 py-0.5 rounded-full">
                {g.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-ink-500 mb-4">
          {movie?.release_date && (
            <span className={new Date(movie.release_date) > new Date() ? 'text-accent-600 font-medium' : ''}>
              {new Date(movie.release_date) > new Date() ? 'Releases ' : ''}
              {new Date(movie.release_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {tv?.first_air_date && (
            <span>First aired {new Date(tv.first_air_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          )}
          {movie?.runtime && <span>{formatRuntime(movie.runtime)}</span>}
          {tv && tv.number_of_seasons && (
            <span>{tv.number_of_seasons} season{tv.number_of_seasons !== 1 ? 's' : ''} · {tv.number_of_episodes} episodes</span>
          )}
          {detail.vote_average > 0 && <span>★ {detail.vote_average.toFixed(1)}</span>}
        </div>

        {cast.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Cast</p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {cast.map(m => <CastMember key={m.id} member={m} />)}
            </div>
          </div>
        )}

        {streamProviders.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">
              Streaming <span className="text-ink-300 normal-case tracking-normal font-normal">({providerCountry})</span>
            </p>
            <div className="flex gap-2">
              {streamProviders.map(p => <ProviderLogo key={p.provider_id} provider={p} />)}
            </div>
          </div>
        )}

        {/* Compact info row: director, budget/revenue, TV metadata */}
        {(director || hasBudget || tv?.created_by?.length || tv?.networks?.length || tv?.next_episode_to_air || trailer) && (
          <div className="mb-4 flex flex-col gap-1">
            {director && (
              <p className="text-xs text-ink-500">
                <span className="text-ink-400">Director </span>{director.name}
              </p>
            )}
            {hasBudget && (
              <p className="text-xs text-ink-500">
                <span className="text-ink-400">Budget </span>{formatMoney(movie!.budget!)}
                {(movie!.revenue ?? 0) > 0 && (
                  <><span className="text-ink-300"> · </span><span className="text-ink-400">Revenue </span>{formatMoney(movie!.revenue!)}</>
                )}
              </p>
            )}
            {tv?.created_by?.length ? (
              <p className="text-xs text-ink-500">
                <span className="text-ink-400">Created by </span>{tv.created_by.map(c => c.name).join(', ')}
              </p>
            ) : null}
            {tv?.networks?.length ? (
              <p className="text-xs text-ink-500">
                <span className="text-ink-400">Network </span>{tv.networks.map(n => n.name).join(', ')}
              </p>
            ) : null}
            {tv?.next_episode_to_air && (
              <p className="text-xs text-accent-600">
                Next: S{tv.next_episode_to_air.season_number}E{tv.next_episode_to_air.episode_number} · {formatAirDate(tv.next_episode_to_air.air_date)}
              </p>
            )}
            {trailer && !showTrailer && (
              <button
                onClick={() => setShowTrailer(true)}
                className="text-xs text-accent-600 hover:text-accent-700 transition-colors duration-150 w-fit"
              >
                ▶ Watch trailer
              </button>
            )}
          </div>
        )}

        {/* Inline trailer embed */}
        {showTrailer && trailer && (
          <div className="mb-4">
            <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1`}
                title="Trailer"
                allow="autoplay; fullscreen"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            </div>
            <button
              onClick={() => setShowTrailer(false)}
              className="text-[10px] text-ink-400 hover:text-ink-600 mt-1"
            >
              ✕ Close trailer
            </button>
          </div>
        )}

        {/* Similar titles */}
        <div className="mb-4">
          <SimilarRow
            tmdbId={detail.id}
            mediaType={mediaType}
            onOpenDetail={(id, type) => onOpenDetail?.(id, type)}
          />
        </div>

        {/* Episodes — TV in library only */}
        {!isMovie && tvEntry && tv && (tv.seasons?.length ?? 0) > 0 && (
          <div className="mb-4">
            <EpisodesPanel tv={tv} tvEntryId={tvEntry.id} />
          </div>
        )}

        <div className="pt-3 border-t border-ink-100 space-y-3">
          {isOwned && entryId ? (
            <>
              {/* Personal rating — 5 stars, half-step (1–10) */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">Your rating</p>
                <StarRating
                  value={(movieEntry ?? tvEntry)?.rating}
                  onChange={handleRatingChange}
                  disabled={updateMovie.isPending || updateTV.isPending}
                />
              </div>

              {/* Clickable status buttons for owned items */}
              <div className="flex flex-wrap gap-1.5">
                {statuses.map(s => (
                  <button
                    key={s.value}
                    onClick={() => handleStatusChange(s.value)}
                    disabled={updateMovie.isPending || updateTV.isPending}
                    className={[
                      'text-xs px-3 min-h-[44px] rounded-full border transition-colors',
                      userEntry!.status === s.value
                        ? 'bg-accent-500 border-accent-500 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-accent-400',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                ))}
                {tvEntry && (
                  <span className="text-xs text-ink-500 self-center ml-1">
                    S{tvEntry.current_season} E{tvEntry.current_episode}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {isMovie && (
                  <PlanThisButton
                    entryId={entryId}
                    title={movie!.title}
                    runtimeMinutes={movie!.runtime}
                  />
                )}
                {tvEntry?.status === 'watching' && (
                  <button
                    onClick={handleNextEpisode}
                    disabled={updateTV.isPending}
                    title="Move your watching position forward by one episode"
                    className="text-[11px] font-medium px-2.5 min-h-[44px] rounded bg-ink-100 text-ink-700 hover:bg-ink-200 transition-colors duration-150"
                  >
                    Advance to next episode ▸
                  </button>
                )}
                {movieEntry?.status === 'watching' && (
                  <button
                    onClick={handleMarkWatched}
                    disabled={updateMovie.isPending}
                    className="text-[11px] font-medium px-2.5 min-h-[44px] rounded bg-ink-100 text-ink-700 hover:bg-ink-200 transition-colors duration-150"
                  >
                    Mark watched
                  </button>
                )}
                <a
                  href={isMovie ? tmdbMovieUrl(movie!.id) : tmdbTVUrl(tv!.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium px-2.5 min-h-[44px] flex items-center rounded bg-ink-100 text-ink-500 hover:bg-ink-200 transition-colors duration-150"
                >
                  TMDB ↗
                </a>
                <button
                  onClick={handleRemove}
                  disabled={removeMovie.isPending || removeTV.isPending}
                  className="text-[11px] font-medium px-2.5 min-h-[44px] rounded text-red-500 hover:bg-red-50 transition-colors duration-150"
                >
                  Remove
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {statuses.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setSelectedStatus(s.value)}
                    className={`text-xs px-3 min-h-[44px] rounded-full border transition-colors duration-150 ${
                      selectedStatus === s.value
                        ? 'bg-accent-500 border-accent-500 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-accent-400'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleAdd}
                  disabled={isAdding}
                  className="btn-primary text-sm min-h-[44px] px-6"
                >
                  {isAdding ? 'Adding…' : 'Add to library'}
                </button>
                <a
                  href={isMovie ? tmdbMovieUrl(movie!.id) : tmdbTVUrl(tv!.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs min-h-[44px] flex items-center text-ink-400 hover:text-ink-600 transition-colors duration-150"
                >
                  TMDB ↗
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
