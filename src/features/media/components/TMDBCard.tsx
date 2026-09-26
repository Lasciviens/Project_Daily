import { posterUrl } from '../../../integrations/tmdb/client'
import { haptic } from '../../../shared/utils/haptics'
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
    <button
      type="button"
      onClick={() => { haptic('light'); onOpenDetail(item.id) }}
      className="group flex min-w-0 flex-col text-left"
    >
      <span className={`press-feedback relative block aspect-[2/3] overflow-hidden rounded-row bg-surface-2 transition-[filter] duration-150 group-hover:brightness-90 ${upcoming ? 'grayscale' : ''}`}>
        <img src={posterUrl(item.poster_path)} alt="" className="h-full w-full object-cover" loading="lazy" />
        {upcoming && (
          <span className="absolute inset-x-0 bottom-0 flex justify-center pb-2">
            <span className="rounded-md bg-scrim/65 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-[0.08em] text-white">
              Upcoming
            </span>
          </span>
        )}
      </span>
      <span className="mt-1.5 truncate px-0.5 text-meta font-medium text-fg">{title}</span>
      <span className="px-0.5 text-micro text-fg-muted tabular-nums">
        ★ {item.vote_average.toFixed(1)}{date && ` · ${date.slice(0, 4)}`}
      </span>
    </button>
  )
}
