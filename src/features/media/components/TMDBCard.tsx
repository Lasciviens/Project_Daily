import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useMovieDetails, useTVDetails } from '../hooks/useTMDB'
import { useAddMovie } from '../hooks/useMovies'
import { useAddTV } from '../hooks/useTVSeries'
import { AddMediaConfirm } from './AddMediaConfirm'
import type { TMDBSearchMovie, TMDBSearchTV, MediaStatus, TMDBMovie, TMDBTVSeries, UserMovieEntry, UserTVEntry } from '../types'

interface MovieProps { item: TMDBSearchMovie; type: 'movie' }
interface TVProps    { item: TMDBSearchTV;    type: 'tv'    }
type Props = MovieProps | TVProps

const isUpcoming = (date: string | undefined): boolean =>
  !date || new Date(date) > new Date()

export function TMDBCard({ item, type }: Props) {
  const [confirming, setConfirming]   = useState(false)
  const [fetchDetail, setFetchDetail] = useState(false)

  const title    = type === 'movie' ? (item as TMDBSearchMovie).title : (item as TMDBSearchTV).name
  const date     = type === 'movie' ? (item as TMDBSearchMovie).release_date : (item as TMDBSearchTV).first_air_date
  const upcoming = isUpcoming(date)

  const { data: movieDetail } = useMovieDetails(fetchDetail && type === 'movie' ? item.id : null)
  const { data: tvDetail    } = useTVDetails(fetchDetail && type === 'tv' ? item.id : null)
  const addMovie = useAddMovie()
  const addTV    = useAddTV()

  const detail = type === 'movie' ? movieDetail : tvDetail

  // open confirm once detail loads
  const showConfirm = confirming && !!detail

  async function handleConfirm(status: MediaStatus) {
    if (!detail) return
    if (type === 'movie') await addMovie.mutateAsync({ tmdb: detail as TMDBMovie, status: status as UserMovieEntry['status'] })
    else                  await addTV.mutateAsync({ tmdb: detail as TMDBTVSeries, status: status as UserTVEntry['status'] })
    setConfirming(false)
    setFetchDetail(false)
  }

  function startAdd() {
    setFetchDetail(true)
    setConfirming(true)
  }

  return (
    <>
      <div className="group relative flex flex-col">
        <div className={`relative rounded-lg overflow-hidden aspect-[2/3] ${upcoming ? 'grayscale' : ''}`}>
          <img
            src={posterUrl(item.poster_path)}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {upcoming && (
            <div className="absolute bottom-0 inset-x-0 flex justify-center pb-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-black/60 px-1.5 py-0.5 rounded">
                Upcoming
              </span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
            <button
              onClick={startAdd}
              className="text-xs font-medium bg-accent-500 text-white px-3 py-1.5 rounded-lg hover:bg-accent-600 transition-colors duration-150"
            >
              + Add
            </button>
          </div>
        </div>
        <p className="text-xs font-medium text-ink-800 mt-1.5 truncate px-0.5">{title}</p>
        <div className="flex items-center gap-1 px-0.5">
          <span className="text-[10px] text-ink-400">★ {item.vote_average.toFixed(1)}</span>
          {date && <span className="text-[10px] text-ink-400">· {date.slice(0, 4)}</span>}
        </div>
      </div>

      {showConfirm && detail && (
        <AddMediaConfirm
          item={detail}
          mediaType={type}
          onConfirm={handleConfirm}
          onClose={() => { setConfirming(false); setFetchDetail(false) }}
          isPending={addMovie.isPending || addTV.isPending}
        />
      )}
    </>
  )
}
