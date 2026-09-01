import { useMemo, useState } from 'react'
import { Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, ReferenceLine } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { useAthleteProfile } from '../hooks/useAthleteProfile'
import { computeWeeklySetsPerMuscleTrend } from '../progressAggregate'
import { lastCompleteWeek } from '../trainingInsights'
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
// ─────────────────────────────────────────────────────────────────────────────

function fmtWeek(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function WeeklySetsPerMuscleChart() {
  const { data, isLoading } = useTrainingHistory()
  const { data: profile } = useAthleteProfile()
  const [slug, setSlug] = useState<string>('chest')

  const templateMuscles = useMemo(() => buildTemplateMuscleMap(data?.templates ?? []), [data])

  const chartData = useMemo(() => {
    if (!data) return []
    // Exclude the current, still-in-progress week — its badge (below) is the
    // most prominent number on this card, and sourcing it from a partial
    // week understates real weekly volume until the week is actually over
    // (sports-scientist review, 2026-09-01).
    const last = lastCompleteWeek(new Date().toISOString().slice(0, 10))
    return computeWeeklySetsPerMuscleTrend(data.sets, templateMuscles, slug, contribution)
      .filter(p => p.weekStart <= last)
      .map(p => ({ ...p, label: fmtWeek(p.weekStart) }))
  }, [data, templateMuscles, slug])

  const landmarks = MUSCLE_LANDMARKS[slug]
  const scaled = landmarks ? scaleLandmarksForExperience(landmarks, profile?.experience_level) : null
  const latest = chartData[chartData.length - 1]
  const band = latest ? bandForWeeklySets(slug, latest.sets) : 0

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">🎯 Weekly Sets per Muscle</p>

      <div className="flex flex-wrap gap-1.5">
        {[...MAJOR_MUSCLES].map(s => (
          <button
            key={s} type="button" onClick={() => setSlug(s)}
            className={`px-2.5 min-h-[36px] rounded-full text-[11px] font-semibold border transition-colors ${
              slug === s ? 'bg-ink-950 text-white border-ink-950' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-ink-400'
            }`}
          >
            {labelForSlug(s)}
          </button>
        ))}
      </div>

      {chartData.length === 0 ? (
        <p className="text-xs text-ink-300 py-8 text-center">No {labelForSlug(slug)} sets logged in the last 6 months.</p>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-ink-800">{labelForSlug(slug)}</p>
            {latest && (
              <span className="px-2 py-1 rounded-md text-[11px] font-semibold" style={{ backgroundColor: `${BANDS_META[band].color}22`, color: BANDS_META[band].color }}>
                {latest.sets}/wk · {BANDS_META[band].label}
              </span>
            )}
          </div>

          <div style={{ height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} domain={[0, 'auto']} />
                <Tooltip
                  cursor={false}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
                  formatter={(v: any) => [`${v} sets`, 'This week']}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                {/* MEV–MAV band, shaded via a stacked-Area trick: an invisible
                    base up to mev, then a tinted slice from mev to mav. */}
                {scaled && (
                  <>
                    <Area dataKey={() => scaled.mev} stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
                    <Area dataKey={() => scaled.mav - scaled.mev} stackId="band" stroke="none" fill="#22c55e" fillOpacity={0.12} isAnimationActive={false} />
                    <ReferenceLine y={scaled.mrv} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                  </>
                )}
                <Line dataKey="sets" name="Weekly sets" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {scaled && (
            <p className="text-[10px] text-ink-400">
              Shaded band = MEV–MAV ({scaled.mev}–{scaled.mav}/wk) · red dashed line = MRV ({scaled.mrv}/wk)
              {profile?.experience_level ? ' — adjusted ±15% for your experience level' : ''}.
            </p>
          )}

          <div className="flex flex-col gap-1 text-[11px] text-ink-400">
            <p>
              Hard working sets per week — each exercise credits its primary muscle 1 set and each secondary muscle half a set, a reasonable convention
              (RP framework), not a measured contribution.
            </p>
            <p>
              The shaded band is a practitioner model, not a measured threshold, and{profile?.experience_level ? ' is' : ' would be'} adjusted ±15% for
              experience level — an unvalidated adjustment on top of an already-heuristic baseline.
            </p>
            <p className="text-ink-300">Sets don&apos;t capture effort, tempo or range of motion, none of which are logged. Read the trend, not any single week.</p>
          </div>
        </>
      )}
    </div>
  )
}
