import { useMemo } from 'react'
import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, ReferenceLine, ReferenceArea } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeWeeklySetsPerMuscleTrend, lastCompleteWeek, mondayOf } from '../progressAggregate'
import { todayStr } from '../../../shared/utils/dateUtils'
import { fmtWeekRange } from '../dateFormat'
import { buildTemplateMuscleMap, labelForSlug, contribution, MAJOR_MUSCLES } from '../muscleMap'
import { VOLUME_HIGH_MAX, VOLUME_TARGET, volumeBandOf } from '../plan/volumeBands'
import { Card, CardHeader, Skeleton, TonePill, Truncate, useChartColors } from '../../../shared/ui'
import { useTooltipStyle } from '../../../shared/components/charts/chartKit'

// ─────────────────────────────────────────────────────────────────────────────
//  Weekly Sets per Muscle — the sports-scientist review's top-priority "what
//  else" addition (2026-08-31): the SAME currency the body map and Results'
//  Weekly sets card use (hard sets/muscle/week in S18's ranges, plan/volumeBands.ts) — the
//  one training measure in this app with an actual dose-response
//  meta-analysis behind it (Schoenfeld 2017; Pelland 2025) — but as a
//  per-week TREND rather than a single rolling-window snapshot. Reuses
//  muscleMap.ts's contribution() exactly, no parallel volume model; the shaded
//  band is S18's 10–20 target (27.11.2026: it was the RP MEV–MAV landmarks).
//
//  A second review (2026-09-01) replaced the one-at-a-time chip picker with a
//  SMALL-MULTIPLES GRID — one tiny sparkline per muscle, all visible at once —
//  after a research pass found real precedent for exactly this (Hevy's own
//  Statistics tab already overlays multiple muscle groups on one graph;
//  Garmin's Training Load Focus renders separate mini-panels per category
//  side by side). "Which muscles am I under-dosing" is a comparison question;
//  a one-at-a-time picker forced holding numbers in memory across clicks.
//  Also replaced the MEV-MAV band's stacked-Area hack with `ReferenceArea`
//  (semantically a background, not a data series) and made the MRV line
//  neutral grey rather than red — red asserts a danger the guardrail copy
//  immediately retracts ("whether that's too much depends on... nothing here
//  measures").
// ─────────────────────────────────────────────────────────────────────────────

interface MuscleCardData {
  slug: string
  label: string
  weekly: { weekStart: string; sets: number }[]
  latest: number | null
}

function MuscleSparkline({ card }: { card: MuscleCardData }) {
  const { label, weekly, latest } = card
  const chartData = weekly.map(w => ({ ...w }))
  const c = useChartColors()
  const tip = useTooltipStyle()

  return (
    <div className="flex flex-col gap-1.5 rounded-row border border-line bg-surface p-2.5">
      <div className="flex items-center justify-between gap-1">
        <Truncate as="p" className="min-w-0 text-meta font-semibold text-fg">{label}</Truncate>
        {latest != null && (
          <span title="Last complete week" className="inline-flex shrink-0">
            <TonePill tone={volumeBandOf(latest).tone} className="tabular-nums">{Math.round(latest)}/wk</TonePill>
          </span>
        )}
      </div>

      {chartData.every(w => w.sets === 0) ? (
        <p className="py-4 text-center text-micro font-normal text-fg-muted">No sets logged</p>
      ) : (
        <div style={{ height: 56 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              {/* Hidden but present — with no XAxis at all, recharts had no
                  category to key the tooltip's header off, so hovering
                  showed a number with no date attached to it (real user
                  confusion, 2026-09-01). dataKey="weekStart" gives the
                  tooltip a real value to format via labelFormatter below;
                  the axis itself stays invisible, this is a sparkline. */}
              <XAxis dataKey="weekStart" hide />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip
                cursor={false}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
                formatter={(v: any) => [`${v} sets`, label]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts labelFormatter's props type is awkward to import cleanly.
                labelFormatter={(weekStart: any) => fmtWeekRange(weekStart)}
                contentStyle={{ ...tip.contentStyle, fontSize: 10, padding: '2px 6px' }}
                labelStyle={tip.labelStyle}
              />
              <ReferenceArea y1={VOLUME_TARGET.min} y2={VOLUME_TARGET.max} fill={c.success} fillOpacity={0.14} strokeWidth={0} />
              <ReferenceLine y={VOLUME_HIGH_MAX} stroke={c.axis} strokeDasharray="2 2" strokeOpacity={0.6} />
              <Line dataKey="sets" stroke={c.series[0]} strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  )
}

export function WeeklySetsPerMuscleChart() {
  const { data, isLoading } = useTrainingHistory()

  const templateMuscles = useMemo(() => buildTemplateMuscleMap(data?.templates ?? []), [data])

  const cards = useMemo<MuscleCardData[]>(() => {
    if (!data) return []
    // One dense range for every muscle: from your first logged week to the
    // last COMPLETE week (the in-progress week would understate the badge).
    // Dense, so the badge is LAST WEEK's number — a muscle last trained six
    // weeks ago reads 0/wk, not its old count — and the sparkline never joins
    // two trained weeks across a gap.
    const last = lastCompleteWeek(todayStr())
    const firstDate = data.sets.reduce<string | null>((min, s) => (min == null || s.date < min ? s.date : min), null)
    if (!firstDate) return []
    const range = { fromWeek: mondayOf(firstDate), untilWeek: last }
    return [...MAJOR_MUSCLES].map(slug => {
      const weekly = computeWeeklySetsPerMuscleTrend(data.sets, templateMuscles, slug, contribution, range)
      const latest = weekly.length > 0 ? weekly[weekly.length - 1].sets : null
      return { slug, label: labelForSlug(slug), weekly, latest }
    })
  }, [data, templateMuscles])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />

  return (
    <Card className="@container flex flex-col gap-3">
      <CardHeader variant="label" title="Weekly sets per muscle" className="!mb-0" />

      {/* Tiles by the card's own width (it sits in a chart column, not the
          viewport): five across only when a tile keeps room for its name. */}
      <div className="grid grid-cols-2 gap-2 @[30rem]:grid-cols-3 @[54rem]:grid-cols-5">
        {cards.map(card => <MuscleSparkline key={card.slug} card={card} />)}
      </div>

      <div className="flex max-w-3xl flex-col gap-1 text-meta text-fg-muted">
        <p>
          Hard working sets per week — each exercise credits its primary muscle 1 set and each secondary muscle half a set, a reasonable convention,
          not a measured contribution.
        </p>
        <p>
          The shaded band is the 10–20 sets a week most people aim for; the grey dashed line is 30, above which little extra is expected.
          Neither is a warning: more sets add less and less, they never hurt by themselves.
        </p>
        <p>The badge is last complete week&apos;s count. Sets don&apos;t capture effort, tempo or range of motion, none of which are logged. Read the trend, not any single week.</p>
      </div>
    </Card>
  )
}
