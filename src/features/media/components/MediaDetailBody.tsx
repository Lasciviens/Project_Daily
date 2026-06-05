import { useState } from 'react'
import { posterUrl, tmdbMovieUrl, tmdbTVUrl } from '../../../integrations/tmdb/client'
import { PlanThisButton } from './PlanThisButton'
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
}

const MOVIE_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
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
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

export function MediaDetailBody({ detail, mediaType, userEntry, onAdded }: Props) {
  const [selectedStatus, setSelectedStatus] = useState<MediaStatus>('wishlist')

  const isMovie = mediaType === 'movie'
  const movie   = isMovie ? (detail as TMDBMovieFull) : null
  const tv      = !isMovie ? (detail as TMDBTVFull) : null

  const cast          = detail.credits?.cast?.slice(0, 10) ?? []
  const allProviders  = detail['watch/providers']?.results ?? {}
  const providerData  = allProviders['US'] ?? allProviders[Object.keys(allProviders)[0]]
  const streamProviders = (providerData?.flatrate ?? []).slice(0, 6)

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
    if (isMovie) {
      await addMovie.mutateAsync({ tmdb: movie! as TMDBMovieFull, status: selectedStatus as UserMovieEntry['status'] })
    } else {
      await addTV.mutateAsync({ tmdb: tv! as TMDBTVFull, status: selectedStatus as UserTVEntry['status'] })
    }
    onAdded?.()
  }

  async function handleRemove() {
    if (!entryId) return
    if (isMovie) await removeMovie.mutateAsync(entryId)
    else         await removeTV.mutateAsync(entryId)
    onAdded?.()
  }

  function handleNextEpisode() {
    if (!tvEntry) return
    const maxEp = (tv?.number_of_episodes ?? 999)
    const ep    = tvEntry.current_episode + 1
    updateTV.mutate({ id: tvEntry.id, patch: { current_episode: ep > maxEp ? 0 : ep } })
  }

  function handleMarkWatched() {
    if (!movieEntry) return
    updateMovie.mutate({ id: movieEntry.id, patch: { status: 'completed', watched_at: new Date().toISOString() } })
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 p-5">
      <div className="flex-shrink-0 self-start">
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Streaming</p>
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
            {trailer && (
              <a
                href={`https://youtube.com/watch?v=${trailer.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-600 hover:text-accent-700 transition-colors duration-150 w-fit"
              >
                ▶ Watch trailer
              </a>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-ink-100 space-y-3">
          {isOwned && entryId ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-accent-600 bg-accent-50 px-2.5 py-1 rounded-full capitalize">
                  {userEntry!.status}
                </span>
                {tvEntry && (
                  <span className="text-xs text-ink-500">
                    S{tvEntry.current_season} E{tvEntry.current_episode}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <PlanThisButton
                  entryId={entryId}
                  sourceType={isMovie ? 'movie' : 'tv_series'}
                  title={isMovie ? movie!.title : tv!.name}
                  currentSeason={tvEntry?.current_season}
                  currentEpisode={tvEntry?.current_episode}
                  releaseDate={isMovie ? movie!.release_date : tv!.first_air_date}
                />
                {tvEntry?.status === 'watching' && (
                  <button
                    onClick={handleNextEpisode}
                    disabled={updateTV.isPending}
                    className="text-[11px] font-medium px-2.5 py-1 rounded bg-ink-100 text-ink-700 hover:bg-ink-200 transition-colors duration-150"
                  >
                    + Next episode
                  </button>
                )}
                {movieEntry?.status === 'watching' && (
                  <button
                    onClick={handleMarkWatched}
                    disabled={updateMovie.isPending}
                    className="text-[11px] font-medium px-2.5 py-1 rounded bg-ink-100 text-ink-700 hover:bg-ink-200 transition-colors duration-150"
                  >
                    Mark watched
                  </button>
                )}
                <a
                  href={isMovie ? tmdbMovieUrl(movie!.id) : tmdbTVUrl(tv!.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium px-2.5 py-1 rounded bg-ink-100 text-ink-500 hover:bg-ink-200 transition-colors duration-150"
                >
                  TMDB ↗
                </a>
                <button
                  onClick={handleRemove}
                  disabled={removeMovie.isPending || removeTV.isPending}
                  className="text-[11px] font-medium px-2.5 py-1 rounded text-red-500 hover:bg-red-50 transition-colors duration-150"
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
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors duration-150 ${
                      selectedStatus === s.value
                        ? 'bg-accent-500 border-accent-500 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-accent-400'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAdd}
                  disabled={isAdding}
                  className="btn-primary text-sm py-1.5 px-6"
                >
                  {isAdding ? 'Adding…' : 'Add to library'}
                </button>
                <a
                  href={isMovie ? tmdbMovieUrl(movie!.id) : tmdbTVUrl(tv!.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-ink-400 hover:text-ink-600 transition-colors duration-150"
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
