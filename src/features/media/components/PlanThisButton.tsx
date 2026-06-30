import { useState } from 'react'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import type { PlanModalConfig, PlanDefaults, PlanSource } from '../../../shared/components/plan-modal'

interface Props {
  entryId: string
  sourceType: 'movie' | 'tv_series'
  title: string
  currentSeason?: number
  currentEpisode?: number
  releaseDate?: string | null
}

/**
 * Media "Plan to watch" entry point. Thin wrapper around UnifiedPlanModal:
 * - config locks Category to Media (caller-side, no modal edits)
 * - TV injects a read-only episode summary via `scheduleExtra` (children slot)
 */
export function PlanThisButton({
  entryId, sourceType, title, currentSeason, currentEpisode,
}: Props) {
  const isTV    = sourceType === 'tv_series'
  const season  = currentSeason ?? 1
  const episode = (currentEpisode ?? 0) + 1
  const [open, setOpen] = useState(false)

  const planTitle = isTV ? `Watch: ${title} S${season}E${episode}` : `Watch: ${title}`

  const config: PlanModalConfig = {
    tabs:               ['schedule'],
    heading:            'Plan to watch',
    lockScheduleFields: ['category'],
  }
  const defaults: PlanDefaults = {
    title:          planTitle,
    startTime:      '20:00',
    duration:       isTV ? 45 : 120,
    category:       'media',
    color:          isTV ? 'blue' : 'purple',
    alsoCreateTask: true,
  }
  const source: PlanSource = {
    sourceType:     'media',
    sourceId:       entryId,
    taskSourceType: sourceType,
  }

  const episodeNote = isTV ? (
    <div className="text-xs text-ink-500 bg-cream-50 border border-ink-200 rounded-xl px-4 py-2.5">
      📺 Next up · <span className="font-semibold text-ink-700">S{season} E{episode}</span>
      <span className="text-ink-400"> — edit the title above to plan a different episode.</span>
    </div>
  ) : undefined

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
        config={config}
        defaults={defaults}
        source={source}
        scheduleExtra={episodeNote}
      />
    </>
  )
}
