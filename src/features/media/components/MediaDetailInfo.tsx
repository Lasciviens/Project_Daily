import { useState, type ReactNode } from 'react'
import { Play, X } from 'lucide-react'
import { SectionLabel } from '../../../shared/ui'
import type { TMDBMovieFull, TMDBTVFull, TMDBCastMember, TMDBWatchProvider, TMDBVideo } from '../types'

function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const formatMoney = (amount: number) => `$${(amount / 1_000_000).toFixed(1)}M`
const formatDay = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const formatAirDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })

const findTrailer = (videos: TMDBVideo[]) => videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')

function CastMember({ member }: { member: TMDBCastMember }) {
  const initials = member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="flex w-16 shrink-0 snap-start flex-col items-center gap-1">
      {member.profile_path ? (
        <img
          src={`https://image.tmdb.org/t/p/w185${member.profile_path}`}
          alt=""
          className="h-12 w-12 rounded-full bg-surface-2 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-meta font-semibold text-fg-muted">{initials}</div>
      )}
      <p className="line-clamp-2 text-center text-micro font-medium leading-tight text-fg-2">{member.name}</p>
      <p className="line-clamp-1 text-center text-micro leading-tight text-fg-muted">{member.character}</p>
    </div>
  )
}

function ProviderLogo({ provider }: { provider: TMDBWatchProvider }) {
  return (
    <img
      src={`https://image.tmdb.org/t/p/w92${provider.logo_path}`}
      alt={provider.provider_name}
      title={provider.provider_name}
      className="h-8 w-8 shrink-0 rounded-control object-cover"
    />
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <p className="text-meta text-fg-2"><span className="text-fg-muted">{label} </span>{children}</p>
}

/** Read-only TMDB facts: overview, genres, dates, cast, streaming, crew, trailer. */
export function MediaDetailInfo({ detail, isMovie }: { detail: TMDBMovieFull | TMDBTVFull; isMovie: boolean }) {
  const [showTrailer, setShowTrailer] = useState(false)
  const movie = isMovie ? (detail as TMDBMovieFull) : null
  const tv = !isMovie ? (detail as TMDBTVFull) : null

  const cast = detail.credits?.cast?.slice(0, 10) ?? []
  const allProviders = detail['watch/providers']?.results ?? {}
  // Prefer Norway, then Turkey, then the US, then whatever exists.
  const providerCountry = allProviders['NO'] ? 'NO' : allProviders['TR'] ? 'TR' : allProviders['US'] ? 'US' : Object.keys(allProviders)[0]
  const streamProviders = (allProviders[providerCountry]?.flatrate ?? []).slice(0, 6)

  const director = movie?.credits?.crew?.find(c => c.job === 'Director')
  const trailer = findTrailer(detail.videos?.results ?? [])
  const hasBudget = (movie?.budget ?? 0) > 0
  const unreleased = !!movie?.release_date && new Date(movie.release_date) > new Date()
  const hasFacts = director || hasBudget || tv?.created_by?.length || tv?.networks?.length || tv?.next_episode_to_air || trailer

  return (
    <div className="flex flex-col gap-4">
      {(detail.overview || detail.tagline) && (
        <div>
          {detail.overview && <p className="text-body leading-relaxed text-fg-2">{detail.overview}</p>}
          {detail.tagline && <p className="mt-1 text-meta italic text-fg-muted">{detail.tagline}</p>}
        </div>
      )}

      {detail.genres?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {detail.genres.map(g => <span key={g.id} className="chip">{g.name}</span>)}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-fg-muted tabular-nums">
        {movie?.release_date && (
          <span className={unreleased ? 'font-medium text-accent-600' : ''}>
            {unreleased ? 'Releases ' : ''}{formatDay(movie.release_date)}
          </span>
        )}
        {tv?.first_air_date && <span>First aired {formatDay(tv.first_air_date)}</span>}
        {movie?.runtime && <span>{formatRuntime(movie.runtime)}</span>}
        {tv?.number_of_seasons && (
          <span>{tv.number_of_seasons} season{tv.number_of_seasons !== 1 ? 's' : ''} · {tv.number_of_episodes} episodes</span>
        )}
        {detail.vote_average > 0 && <span>★ {detail.vote_average.toFixed(1)}</span>}
      </div>

      {cast.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Cast</SectionLabel>
          <div className="scroll-x snap-x-mandatory scroll-fade-x flex gap-3 pb-1">
            {cast.map(m => <CastMember key={m.id} member={m} />)}
          </div>
        </div>
      )}

      {streamProviders.length > 0 && (
        <div>
          <SectionLabel className="mb-1.5">
            Streaming <span className="font-normal normal-case tracking-normal text-fg-faint">({providerCountry})</span>
          </SectionLabel>
          <div className="flex gap-2">{streamProviders.map(p => <ProviderLogo key={p.provider_id} provider={p} />)}</div>
        </div>
      )}

      {hasFacts && (
        <div className="flex flex-col gap-1">
          {director && <Fact label="Director">{director.name}</Fact>}
          {hasBudget && (
            <Fact label="Budget">
              {formatMoney(movie!.budget!)}
              {(movie!.revenue ?? 0) > 0 && <><span className="text-fg-faint"> · </span><span className="text-fg-muted">Revenue </span>{formatMoney(movie!.revenue!)}</>}
            </Fact>
          )}
          {tv?.created_by?.length ? <Fact label="Created by">{tv.created_by.map(c => c.name).join(', ')}</Fact> : null}
          {tv?.networks?.length ? <Fact label="Network">{tv.networks.map(n => n.name).join(', ')}</Fact> : null}
          {tv?.next_episode_to_air && (
            <p className="text-meta font-medium text-accent-600">
              Next: S{tv.next_episode_to_air.season_number}E{tv.next_episode_to_air.episode_number} · {formatAirDate(tv.next_episode_to_air.air_date)}
            </p>
          )}
          {trailer && !showTrailer && (
            <button
              type="button"
              onClick={() => setShowTrailer(true)}
              className="flex min-h-[44px] w-fit items-center gap-1.5 text-meta font-semibold text-accent-600 hover:text-accent-700"
            >
              <Play aria-hidden className="h-3.5 w-3.5" /> Watch trailer
            </button>
          )}
        </div>
      )}

      {showTrailer && trailer && (
        <div>
          <div className="relative aspect-video overflow-hidden rounded-row bg-scrim">
            <iframe
              src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1`}
              title="Trailer"
              allow="autoplay; fullscreen"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowTrailer(false)}
            className="mt-1 flex min-h-[44px] items-center gap-1 text-meta text-fg-muted hover:text-fg"
          >
            <X aria-hidden className="h-3.5 w-3.5" /> Close trailer
          </button>
        </div>
      )}
    </div>
  )
}
