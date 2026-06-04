import { posterUrl } from '../../../integrations/tmdb/client'
import type { TMDBSearchMovie, TMDBSearchTV } from '../types'

interface Props {
  item: TMDBSearchMovie | TMDBSearchTV
  type: 'movie' | 'tv'
  onOpenDetail: (id: number) => void
}

const isUpcoming = (date: string | undefined): boolean =>
  !date || new Date(date) > new Date()

export function TMDBCard({ item, type, onOpenDetail }: Props) {
  const title    = type === 'movie' ? (item as TMDBSearchMovie).title : (item as TMDBSearchTV).name
  const date     = type === 'movie' ? (item as TMDBSearchMovie).release_date : (item as TMDBSearchTV).first_air_date
  const upcoming = isUpcoming(date)

  return (
    <div
      className="flex flex-col cursor-pointer"
      onClick={() => onOpenDetail(item.id)}
    >
      <div className={`relative rounded-lg overflow-hidden aspect-[2/3] hover:brightness-90 transition-all duration-150 ${upcoming ? 'grayscale' : ''}`}>
        <img
          src={posterUrl(item.poster_path)}
          alt={title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {upcoming && (
          <div className="absolute bottom-0 inset-x-0 flex justify-center pb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-accent-300 bg-black/60 px-1.5 py-0.5 rounded">
              Upcoming
            </span>
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-ink-800 mt-1.5 truncate px-0.5">{title}</p>
      <div className="flex items-center gap-1 px-0.5">
        <span className="text-[10px] text-ink-400">★ {item.vote_average.toFixed(1)}</span>
        {date && <span className="text-[10px] text-ink-400">· {date.slice(0, 4)}</span>}
      </div>
    </div>
  )
}
