import { useMemo } from 'react'
import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, ReferenceLine, ReferenceArea } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { useAthleteProfile } from '../hooks/useAthleteProfile'
import { computeWeeklySetsPerMuscleTrend } from '../progressAggregate'
import { lastCompleteWeek } from '../trainingInsights'
import { fmtWeekRange } from '../dateFormat'
import { buildTemplateMuscleMap, labelForSlug, contribution, MAJOR_MUSCLES, MUSCLE_LANDMARKS, scaleLandmarksForExperience, bandForWeeklySets, BANDS_META } from '../muscleMap'

// ─────────────────────────────────────────────────────────────────────────────
//  Weekly Sets per Muscle — the sports-scientist review's top-priority "what
//  else" addition (2026-08-31): the SAME currency the Muscles tab already
//  uses (hard sets/muscle/week vs the RP-framework MEV-MAV landmarks) — the
//  one training measure in this app with an actual dose-response
//  meta-analysis behind it (Schoenfeld 2017; Pelland 2025) — but as a
//  per-week TREND rather than a single rolling-window snapshot. Reuses
//  muscleMap.ts's contribution()/MUSCLE_LANDMARKS/scaleLandmarksForExperience
//  exactly, no parallel volume model.
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
  scaled: { mev: number; mav: number; mrv: number } | null
  latest: number | null
  band: number
}

function MuscleSparkline({ card, experienceLevel }: { card: MuscleCardData; experienceLevel: string | null | undefined }) {
  const { label, weekly, scaled, latest, band } = card
  const chartData = weekly.map(w => ({ ...w }))

  return (
    <div className="border border-ink-200 rounded-xl p-2.5 flex flex-col gap-1.5 bg-cream-50">
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs font-semibold text-ink-800 truncate">{label}</p>
        {latest != null && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: `${BANDS_META[band].color}22`, color: BANDS_META[band].color }}>
            {latest}/wk
          </span>
        )}
      </div>

      {chartData.length === 0 ? (
        <p className="text-[10px] text-ink-300 py-4 text-center">No sets logged</p>
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
                contentStyle={{ fontSize: 10, borderRadius: 6, padding: '2px 6px' }}
              />
              {scaled && (
                <>
                  <ReferenceArea y1={scaled.mev} y2={scaled.mav} fill="#22c55e" fillOpacity={0.14} strokeWidth={0} />
                  <ReferenceLine y={scaled.mrv} stroke="rgb(var(--ink-400))" strokeDasharray="2 2" strokeOpacity={0.6} />
                </>
              )}
              <Line dataKey="sets" stroke="#0ea5e9" strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {scaled && (
        <p className="text-[9px] text-ink-300 leading-tight">
          MEV–MAV {scaled.mev}–{scaled.mav} · MRV {scaled.mrv}{experienceLevel ? ' (adj.)' : ''}
        </p>
      )}
    </div>
  )
}

export function WeeklySetsPerMuscleChart() {
  const { data, isLoading } = useTrainingHistory()
  const { data: profile } = useAthleteProfile()

  const templateMuscles = useMemo(() => buildTemplateMuscleMap(data?.templates ?? []), [data])

  const cards = useMemo<MuscleCardData[]>(() => {
    if (!data) return []
    // Exclude the current, still-in-progress week — the badge is the most
    // prominent number on each card, and sourcing it from a partial week
    // understates real weekly volume until the week is actually over
    // (sports-scientist review, 2026-09-01).
    const last = lastCompleteWeek(new Date().toISOString().slice(0, 10))
    return [...MAJOR_MUSCLES].map(slug => {
      const weekly = computeWeeklySetsPerMuscleTrend(data.sets, templateMuscles, slug, contribution).filter(p => p.weekStart <= last)
      const landmarks = MUSCLE_LANDMARKS[slug]
      const scaled = landmarks ? scaleLandmarksForExperience(landmarks, profile?.experience_level) : null
      const latest = weekly.length > 0 ? weekly[weekly.length - 1].sets : null
      return { slug, label: labelForSlug(slug), weekly, scaled, latest, band: latest != null ? bandForWeeklySets(slug, latest) : 0 }
    })
  }, [data, templateMuscles, profile])

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">🎯 Weekly Sets per Muscle</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {cards.map(card => <MuscleSparkline key={card.slug} card={card} experienceLevel={profile?.experience_level} />)}
      </div>

      <div className="flex flex-col gap-1 text-[11px] text-ink-400">
        <p>
          Hard working sets per week — each exercise credits its primary muscle 1 set and each secondary muscle half a set, a reasonable convention
          (RP framework), not a measured contribution.
        </p>
        <p>
          The shaded band (MEV–MAV) and the grey dashed line (MRV) are a practitioner model, not a measured threshold
          {profile?.experience_level ? ', adjusted ±15% for your experience level' : ''} — an unvalidated adjustment on top of an already-heuristic baseline.
          MRV isn&apos;t coloured as a warning: going over it isn&apos;t asserted harmful, since effort, sleep and recovery (all unmeasured here) decide that.
        </p>
        <p className="text-ink-300">Sets don&apos;t capture effort, tempo or range of motion, none of which are logged. Read the trend, not any single week.</p>
      </div>
    </div>
  )
}
