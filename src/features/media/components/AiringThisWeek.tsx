import { useEntityModal } from '../../../shared/modals'
import { SectionLabel, Truncate } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useAiringThisWeek } from '../hooks/useAiringThisWeek'

const weekday = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' })

/** "Airing this week" — new episodes of your shows; a row opens the show. Hidden when none. */
export function AiringThisWeek({ limit = 4, enabled = true }: { limit?: number; enabled?: boolean }) {
  const items = useAiringThisWeek(enabled)
  const modal = useEntityModal()
  if (!enabled || items.length === 0) return null
  return (
    <div>
      <SectionLabel className="mb-1">Airing this week</SectionLabel>
      <ul className="-mx-1">
        {items.slice(0, limit).map(i => (
          <li key={i.key}>
            <button type="button" onClick={() => modal.open({ kind: 'media', tmdbId: i.tmdbId, mediaType: 'tv' })} className="row row-interactive w-full py-1 text-left">
              <img src={posterUrl(i.poster, 'w92')} alt="" loading="lazy" className="h-9 w-6 shrink-0 rounded bg-surface-2 object-cover" />
              <span className="min-w-0 flex-1">
                <Truncate className="text-meta font-medium text-fg">{i.title}</Truncate>
                <span className="block text-micro text-fg-muted tabular-nums">S{i.season} · E{i.episode}{i.episodeTitle ? ` · ${i.episodeTitle}` : ''}</span>
              </span>
              <span className="shrink-0 text-micro font-semibold text-fg-2 tabular-nums">{weekday(i.airDate)} {formatDate(i.airDate).slice(0, 5)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
