import { useState } from 'react'
import { TMDBCard } from './TMDBCard'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
  useUpcomingMovies, useUpcomingTV,
} from '../hooks/useTMDB'

type DiscoveryTab = 'today' | 'week' | 'popular' | 'upcoming'

interface Props {
  mediaType: 'movie' | 'tv'
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

const TABS: { key: DiscoveryTab; label: string }[] = [
  { key: 'today',    label: 'Today'      },
  { key: 'week',     label: 'This Week'  },
  { key: 'popular',  label: 'Popular'    },
  { key: 'upcoming', label: 'Upcoming'   },
]

const GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-6 gap-3'

function SkeletonGrid() {
  return (
    <div className={GRID}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-[2/3] rounded-lg bg-cream-200 animate-pulse" />
      ))}
    </div>
  )
}

export function DiscoveryTabs({ mediaType, onOpenDetail }: Props) {
  const [tab, setTab] = useState<DiscoveryTab>('today')

  const { data: trendDay,  isLoading: tdl  } = useTrendingMovies('day')
  const { data: trendWeek, isLoading: twl  } = useTrendingMovies('week')
  const { data: popular,   isLoading: pol  } = usePopularMovies()
  const { data: upcoming,  isLoading: uml  } = useUpcomingMovies()

  const { data: tvTrendDay,  isLoading: tvtdl } = useTrendingTV('day')
  const { data: tvTrendWeek, isLoading: tvtwl } = useTrendingTV('week')
  const { data: tvPopular,   isLoading: tvpol } = usePopularTV()
  const { data: tvUpcoming,  isLoading: tvuml } = useUpcomingTV()

  const items = mediaType === 'movie'
    ? { today: trendDay,   week: trendWeek,   popular, upcoming }
    : { today: tvTrendDay, week: tvTrendWeek, popular: tvPopular, upcoming: tvUpcoming }

  const loadingMap = mediaType === 'movie'
    ? { today: tdl, week: twl, popular: pol, upcoming: uml }
    : { today: tvtdl, week: tvtwl, popular: tvpol, upcoming: tvuml }

  const current = items[tab] ?? []
  const loading = loadingMap[tab]

  return (
    <div className="mb-6">
      <div className="flex gap-1 mb-4 bg-cream-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors duration-150 ${
              tab === t.key
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <SkeletonGrid /> : (
        <div className={GRID}>
          {current.slice(0, 18).map(item => (
            <TMDBCard
              key={item.id}
              item={item}
              type={mediaType}
              onOpenDetail={id => onOpenDetail(id, mediaType)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
