import { useState } from 'react'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import { ceilToQuarter } from '../../../shared/components/plan-modal/planModal.config'
import type { PlanModalConfig, PlanDefaults, PlanSource } from '../../../shared/components/plan-modal'

interface Props {
  entryId: string
  title: string
  /** Movie runtime in minutes — becomes the plan duration (rounded up to 15m). */
  runtimeMinutes?: number | null
}

/**
 * Movie "Plan to watch" entry point. TV planning lives in EpisodesPanel (plan
 * selected episodes), so this button is movie-only. Thin wrapper around
 * UnifiedPlanModal — all shaping is done here via config/defaults/source.
 */
export function PlanThisButton({ entryId, title, runtimeMinutes }: Props) {
  const [open, setOpen] = useState(false)

  const config: PlanModalConfig = {
    heading: 'Plan to watch',
  }
  const defaults: PlanDefaults = {
    title:          `Watch: ${title}`,
    duration:       ceilToQuarter(runtimeMinutes || 120),
    category:       'media',
    color:          'purple',
    alsoCreateTask: true,
  }
  const source: PlanSource = {
    sourceType:     'movie',        // valid time_blocks source_type (no-task path)
    sourceId:       entryId,
    taskSourceType: 'movie',
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] font-medium px-2 min-h-[44px] rounded bg-accent-100 text-accent-700 hover:bg-accent-200 transition-colors"
      >
        📅 Plan
      </button>

      <UnifiedPlanModal
        open={open}
        onClose={() => setOpen(false)}
        mode="schedule"
        config={config}
        defaults={defaults}
        source={source}
      />
    </>
  )
}
