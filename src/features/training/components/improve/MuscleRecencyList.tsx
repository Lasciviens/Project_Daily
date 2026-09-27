import { useMemo } from 'react'
import { Card, CardHeader, Skeleton, ToneDot } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { MAJOR_MUSCLES, labelForSlug } from '../../muscleMap'
import { computeMuscleLastTrained, recencyBucket, MIN_CREDIT, RECENCY_LEGEND, RECENCY_TONE, type TemplateMuscleGroups } from '../../plan/recovery'

function agoText(days: number | null): string {
  if (days == null) return 'not in the last 6 months'
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** Days since each muscle last got a real dose (≥2 fractional sets in one
 *  workout), most recent first. A list, not a second body diagram: the one
 *  body map on the page is the weekly-volume map above. Not a readiness score. */
export function MuscleRecencyList() {
  const today = useTodayStr()
  const { data: history, isLoading } = useTrainingHistory()

  const rows = useMemo(() => {
    const tm = new Map<string, TemplateMuscleGroups>((history?.templates ?? []).map(t => [t.id, { primary: t.primary_muscle_group, secondary: t.secondary_muscle_groups }]))
    const last = computeMuscleLastTrained(history?.sets ?? [], tm, today)
    return [...new Set<string>([...MAJOR_MUSCLES, ...last.keys()])]
      .map(slug => ({ slug, info: last.get(slug) ?? null }))
      .sort((a, b) => (a.info?.daysSince ?? 9999) - (b.info?.daysSince ?? 9999) || labelForSlug(a.slug).localeCompare(labelForSlug(b.slug)))
  }, [history, today])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-48 max-w-3xl" />

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title={<span className="inline-flex items-center gap-1.5">Days since each muscle was trained
          <InfoBubble>
            A muscle counts as trained on a day it got at least {MIN_CREDIT} sets in one workout — 1 per set as the main muscle,
            ½ as a helper, warm-ups excluded. There is no validated per-muscle &quot;recovered&quot; clock, so this shows days,
            not readiness: how often you train a muscle matters less for growth than its weekly total, as long as that total
            is reached.
          </InfoBubble>
        </span>}
      />
      <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Colour key">
        {RECENCY_LEGEND.map(l => (
          <li key={l.tone} className="flex items-center gap-1.5 text-meta text-fg-muted"><ToneDot tone={l.tone} />{l.label}</li>
        ))}
      </ul>
      <ul className="grid grid-cols-1 gap-x-6 border-t border-line sm:grid-cols-2">
        {rows.map(({ slug, info }) => (
          <li key={slug} className="flex items-baseline gap-2 border-b border-line py-1.5 text-body">
            <ToneDot tone={RECENCY_TONE[recencyBucket(info?.daysSince)]} className="shrink-0 self-center" />
            <span className="min-w-0 flex-1 truncate text-fg">{labelForSlug(slug)}</span>
            <span className="tabular-nums text-fg-muted">{agoText(info?.daysSince ?? null)}</span>
            {info && info.daysSince > 1 && <span className="hidden text-meta tabular-nums text-fg-faint sm:inline">{fmtDateEnGB(new Date(`${info.lastDate}T12:00:00`), { day: 'numeric', month: 'short' })}</span>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
