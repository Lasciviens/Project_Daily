import { useMemo, useState } from 'react'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { Card, CardHeader, SegmentedControl, Skeleton, useChartColors } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { MAJOR_MUSCLES, labelForSlug } from '../../muscleMap'
import { withAlpha } from '../muscleBandColors'
import { computeMuscleLastTrained, recencyBucket, RECENCY_BUCKETS, MIN_CREDIT, type RecencyBucket, type TemplateMuscleGroups } from '../../plan/recovery'

// One hue, fading with time since the muscle was last trained — recency is a
// quantity, not a status, so no traffic-light colours.
const ALPHA: Record<RecencyBucket, number> = { today: 1, d1_2: 0.8, d3_4: 0.6, d5_7: 0.42, d8_14: 0.26, d15: 0.14, never: 0 }

function agoText(days: number | null): string {
  if (days == null) return 'not in the last 6 months'
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** Days since each muscle last got a real dose (≥2 fractional sets in one
 *  workout), on a body diagram. Not a readiness score. */
export function MuscleRecoveryMap() {
  const [side, setSide] = useState<'front' | 'back'>('front')
  const today = useTodayStr()
  const { data: history, isLoading } = useTrainingHistory()
  const c = useChartColors()
  const hue = c.series[0]

  const last = useMemo(() => {
    const tm = new Map<string, TemplateMuscleGroups>((history?.templates ?? []).map(t => [t.id, { primary: t.primary_muscle_group, secondary: t.secondary_muscle_groups }]))
    return computeMuscleLastTrained(history?.sets ?? [], tm, today)
  }, [history, today])

  const data = useMemo<ExtendedBodyPart[]>(() => [...last.values()].map(m => ({
    slug: m.slug as Slug, color: withAlpha(hue, ALPHA[recencyBucket(m.daysSince)]),
  })), [last, hue])

  const rows = [...new Set<string>([...MAJOR_MUSCLES, ...last.keys()])]
    .map(slug => ({ slug, info: last.get(slug) ?? null }))
    .sort((a, b) => (a.info?.daysSince ?? 9999) - (b.info?.daysSince ?? 9999) || labelForSlug(a.slug).localeCompare(labelForSlug(b.slug)))

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-72 max-w-3xl" />

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
        action={<SegmentedControl<'front' | 'back'> size="sm" value={side} onChange={setSide} options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 justify-center rounded-card bg-scrim p-3 sm:w-[240px]">
          <div className="w-full max-w-[180px] [&>svg]:h-auto [&>svg]:w-full">
            <Body data={data} side={side} gender="male" scale={1} defaultFill={c.neutral} border="rgb(255 255 255 / 0.12)" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {RECENCY_BUCKETS.filter(b => b.key !== 'never').map(b => (
              <li key={b.key} className="flex items-center gap-1.5 text-meta text-fg-muted">
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: withAlpha(hue, ALPHA[b.key]) }} />{b.label}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {rows.map(({ slug, info }) => (
              <li key={slug} className="flex items-baseline gap-2 py-1.5 text-body">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 self-center rounded-sm" style={{ backgroundColor: info ? withAlpha(hue, ALPHA[recencyBucket(info.daysSince)]) : c.neutral }} />
                <span className="min-w-0 flex-1 truncate text-fg">{labelForSlug(slug)}</span>
                <span className="tabular-nums text-fg-muted">{agoText(info?.daysSince ?? null)}</span>
                {info && info.daysSince > 1 && <span className="hidden text-meta tabular-nums text-fg-faint sm:inline">{fmtDateEnGB(new Date(`${info.lastDate}T12:00:00`), { day: 'numeric', month: 'short' })}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
