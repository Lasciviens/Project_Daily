import { CalendarPlus } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { ceilToQuarter } from '../../../shared/components/plan-modal/planModal.config'

interface Props {
  entryId: string
  title: string
  /** Movie runtime in minutes — becomes the plan duration (rounded up to 15m). */
  runtimeMinutes?: number | null
}

/**
 * Movie "Plan to watch" entry point. TV planning lives in EpisodesPanel (plan
 * selected episodes), so this button is movie-only.
 */
export function PlanThisButton({ entryId, title, runtimeMinutes }: Props) {
  const modal = useEntityModal()
  return (
    <Button
      size="sm"
      icon={<CalendarPlus />}
      onClick={() => modal.open({
        kind: 'time-block',
        config: { heading: 'Plan to watch' },
        defaults: {
          title:          `Watch: ${title}`,
          duration:       ceilToQuarter(runtimeMinutes || 120),
          category:       'media',
          color:          'purple',
          alsoCreateTask: true,
        },
        source: { sourceType: 'movie', sourceId: entryId, taskSourceType: 'movie' },
      })}
    >
      Plan
    </Button>
  )
}
