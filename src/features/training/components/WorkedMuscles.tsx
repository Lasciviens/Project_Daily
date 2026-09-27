import { useState, useMemo } from 'react'
import { subDays, formatDistanceToNow, format, differenceInCalendarDays } from 'date-fns'
import type { ExtendedBodyPart, Slug } from 'react-muscle-highlighter'
import { Dumbbell } from 'lucide-react'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useRecentHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useMuscleVolume } from '../hooks/useMuscleVolume'
import { useAthleteProfile, useAthleteLimitations } from '../hooks/useAthleteProfile'
import { useBandColors } from './muscleBandColors'
import { SectionLabel, SegmentedControl } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { todayStr } from '../../../shared/utils/dateUtils'
import {
  slugForHevyGroup, MUSCLE_LANDMARKS, SIDE_SLUGS, labelForSlug, MAJOR_MUSCLES,
  scaleLandmarksForExperience, EXPERIENCE_MULTIPLIER, restrictionsBySlug, type Landmarks,
} from '../muscleMap'
import {
  PRESETS, BAND_WORD, aggregateVolume, bandOf, buildVerdict, computeBalance, readMuscle, weeklyOf,
  type MuscleReadContext, type Period, type Tpl, type VolumeRow,
} from './muscles/muscleVolumeModel'
import { MuscleVerdictBanner } from './muscles/MuscleVerdictBanner'
import { MuscleBodyPanel } from './muscles/MuscleBodyPanel'
import { MuscleBalanceCard } from './muscles/MuscleBalanceCard'
import { MuscleDetailCard } from './muscles/MuscleDetailCard'

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles" — weekly HARD-SET VOLUME per muscle vs evidence-based
//  landmarks (MV/MEV/MAV/MRV). Verdict-first for a non-expert (a plain
//  headline + up to 3 fixes), jargon in info bubbles, plus three cues a plain
//  average destroys — FREQUENCY, TREND (vs the prior equal window) and DAYS
//  SINCE trained. Measures VOLUME, not effort/recovery/growth.
//  The math lives in muscles/muscleVolumeModel.ts on top of muscleMap.ts's
//  shared band/landmark/restriction helpers (the ones Training Analysis and
//  the AI coach read), so the screens can't disagree.
// ─────────────────────────────────────────────────────────────────────────────

export function WorkedMuscles() {
  const bandColors = useBandColors()
  const [side, setSide]     = useState<'front' | 'back'>('front')
  const [period, setPeriod] = useState<Period>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const [selected, setSelected] = useState<Set<Slug>>(new Set())

  const anchorDay = todayStr()
  const customValid = period === 'custom' && !!customFrom && !!customTo && customFrom <= customTo

  // Effective window (days) + current/prior ISO ranges. Prior = the equal-length
  // window immediately before the current one (for the trend read).
  const { windowDays, fromIso, toIso, priorFromIso, priorToIso } = useMemo(() => {
    let days: number, end: Date, start: Date
    if (period === 'custom' && customValid) {
      start = new Date(`${customFrom}T00:00:00`)
      end   = new Date(`${customTo}T23:59:59`)
      days  = Math.max(1, differenceInCalendarDays(end, start) + 1)
    } else {
      days = PRESETS.find(p => p.id === period)?.days ?? 30
      end  = new Date(`${anchorDay}T23:59:59`)
      start = subDays(end, days)
    }
    const priorEnd = new Date(start.getTime() - 1000)
    const priorStart = subDays(priorEnd, days)
    return {
      windowDays: days,
      fromIso: start.toISOString(), toIso: end.toISOString(),
      priorFromIso: priorStart.toISOString(), priorToIso: priorEnd.toISOString(),
    }
  }, [period, customValid, customFrom, customTo, anchorDay])

  const weeks = windowDays / 7
  const smallSample = windowDays < 14

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: recentWorkouts = [] } = useRecentHevyWorkouts()
  const lastAt = recentWorkouts[0]?.start_time ?? recentWorkouts[0]?.hevy_created_at ?? null

  // Experience level scales MEV/MRV (a no-op when unset). Limitations are
  // active-only; restrictionsBySlug applies the shared rule (monitor flags
  // nothing, free-text patterns resolved, worst case wins).
  const { data: athleteProfile } = useAthleteProfile()
  const experienceLevel = athleteProfile?.experience_level ?? null
  const isExperienceAdjusted = experienceLevel != null && EXPERIENCE_MULTIPLIER[experienceLevel] !== 1
  const { data: limitations = [] } = useAthleteLimitations(true)
  const restrictions = useMemo(() => restrictionsBySlug(limitations), [limitations])

  const enabled = period !== 'custom' || customValid
  const { data: volume = [], isLoading } = useMuscleVolume(fromIso, toIso, enabled)
  const { data: priorVolume = [] } = useMuscleVolume(priorFromIso, priorToIso, enabled)

  const tplById = useMemo(() => {
    const m = new Map<string, Tpl>()
    for (const t of templates) {
      const primary = slugForHevyGroup(t.primary_muscle_group)
      const secondaries = (t.secondary_muscle_groups ?? []).map(slugForHevyGroup).filter((s): s is Slug => !!s)
      m.set(t.id, { primary, secondaries, title: t.title })
    }
    return m
  }, [templates])

  const current = useMemo(() => aggregateVolume(volume as VolumeRow[], tplById), [volume, tplById])
  const prior = useMemo(() => aggregateVolume(priorVolume as VolumeRow[], tplById), [priorVolume, tplById])
  // No trend without a real baseline: a prior window with 0 workouts would
  // flag almost every muscle "up". Show "new" instead.
  const priorHasData = prior.workoutCount > 0

  const ctx: MuscleReadContext = useMemo(() => ({
    perSlug: current.perSlug,
    priorPerSlug: prior.perSlug,
    weeks,
    today: anchorDay,
    // Every band and landmark number reads MUSCLE_LANDMARKS through here, so
    // the diagram colour and a muscle's own info bubble always agree.
    landmarksFor: (slug: string): Landmarks | undefined => {
      const L0 = MUSCLE_LANDMARKS[slug]
      return L0 ? scaleLandmarksForExperience(L0, experienceLevel) : undefined
    },
    restrictions,
  }), [current.perSlug, prior.perSlug, weeks, anchorDay, experienceLevel, restrictions])

  const bodyData = useMemo<ExtendedBodyPart[]>(() => {
    // A flagged muscle is shown even at 0 sets — the flag itself is the point.
    const universe = selected.size > 0 ? [...selected] : [...new Set([...Object.keys(ctx.perSlug), ...restrictions.keys()])]
    const out: ExtendedBodyPart[] = []
    for (const slug of universe) {
      const r = restrictions.get(slug as Slug)
      if (r) { out.push({ slug: slug as Slug, color: bandColors.flag[r.weight] }); continue }
      const band = bandOf(ctx, slug)
      if (band > 0) out.push({ slug: slug as Slug, color: bandColors.bands[band] })
    }
    return out
  }, [ctx, selected, restrictions, bandColors])

  const sideChips = useMemo(
    () => Object.keys(ctx.perSlug)
      .filter(slug => SIDE_SLUGS[side].has(slug as Slug))
      .map(slug => ({ slug: slug as Slug, wk: weeklyOf(ctx, slug), band: bandOf(ctx, slug) }))
      .sort((a, b) => b.wk - a.wk),
    [ctx, side],
  )

  const balance = useMemo(() => computeBalance(ctx), [ctx])
  const { verdict, buckets } = useMemo(
    () => buildVerdict({ ctx, majors: MAJOR_MUSCLES, priorHasData, windowDays, smallSample, balance }),
    [ctx, priorHasData, windowDays, smallSample, balance])
  const { workoutCount, totalWorkingSets, unattributed } = current

  function toggle(slug: Slug | null | undefined) {
    if (!slug) return
    setSelected(prev => { const n = new Set(prev); if (n.has(slug)) n.delete(slug); else n.add(slug); return n })
  }

  const hasData = Object.keys(ctx.perSlug).length > 0

  return (
    <div className="@container w-full">
    <div className="flex flex-col gap-4 w-full">
      {workoutCount > 0 && <MuscleVerdictBanner verdict={verdict} />}

    <div className="flex flex-col @3xl:flex-row gap-5 @3xl:gap-8 w-full items-start">
      <MuscleBodyPanel
        side={side} onSideChange={setSide} bodyData={bodyData}
        selectedCount={selected.size} onClear={() => setSelected(new Set())} onToggle={toggle}
        isLoading={isLoading} hasFlags={restrictions.size > 0}
      />

      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        {lastAt && (
          <div className="flex items-baseline gap-2 rounded-row bg-surface-2 px-3.5 py-2.5">
            <span className="flex items-center gap-1 self-center text-meta text-fg-muted"><Dumbbell className="h-3.5 w-3.5" aria-hidden /> Last workout</span>
            <span className="text-body font-semibold text-fg">{formatDistanceToNow(new Date(lastAt), { addSuffix: true })}</span>
            <span className="ml-auto text-meta tabular-nums text-fg-muted">{format(new Date(lastAt), 'EEE d MMM, HH:mm')}</span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl<Period>
            value={period}
            onChange={setPeriod}
            options={[...PRESETS.map(p => ({ value: p.id as Period, label: p.label })), { value: 'custom', label: 'Custom' }]}
          />
          <span className="flex items-center gap-1 text-meta text-fg-muted">
            sets / week
            <InfoBubble><p>Everything is shown as <strong>sets per week</strong>: credited sets in the {windowDays}-day window ÷ {weeks.toFixed(1)} weeks, so it lines up with the weekly landmarks.</p></InfoBubble>
          </span>
        </div>

        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
            <DateInput value={customFrom} max={anchorDay} onChange={setCustomFrom} className="input w-40" />
            <span aria-hidden>→</span>
            <DateInput value={customTo} max={anchorDay} onChange={setCustomTo} className="input w-40" />
            {!customValid && <span>pick a start & end date</span>}
          </div>
        )}

        {smallSample && enabled && (
          <p className="w-fit rounded-row bg-warn-soft px-2.5 py-1.5 text-meta text-fg-2">
            One short window is a small snapshot — a rest day or missed session can swing these. Use 30 days for your real trend.
          </p>
        )}

        <p className="flex flex-wrap items-center gap-1 text-body text-fg-muted">
          {!enabled ? 'Pick a start and end date.'
            : isLoading ? 'Loading…'
            : workoutCount > 0
              ? <>
                  <strong className="tabular-nums text-fg">{workoutCount}</strong> workout{workoutCount !== 1 ? 's' : ''} · last {windowDays} days ·
                  {' '}<strong data-tone="success" className="tone-text tabular-nums">{buckets.inGrowth}</strong> in growth range · <span className="tabular-nums">{buckets.close} close</span> · <span data-tone="warn" className="tone-text tabular-nums">{buckets.needWork} need work</span>
                  <InfoBubble><p>Of the {buckets.inGrowth + buckets.close + buckets.needWork} major muscle groups: <strong>in growth range</strong> = at/above the growth-minimum (MEV); <strong>close</strong> = maintenance, just under; <strong>need work</strong> = below or untrained. Not everyone needs all in range at once. ({totalWorkingSets} working sets total.)</p></InfoBubble>
                </>
              : `No workouts logged in the last ${windowDays} days.`}
        </p>

        {hasData && <MuscleBalanceCard balance={balance} windowDays={windowDays} />}

        {sideChips.length > 0 && (
          <div>
            <p className="section-label mb-1.5">{side === 'front' ? 'Front' : 'Back'} muscles · tap to focus</p>
            <div className="flex flex-wrap gap-1.5">
              {sideChips.map(m => (
                <button key={m.slug} type="button" onClick={() => toggle(m.slug)} aria-pressed={selected.has(m.slug)}
                  className="pill-tab gap-1.5 border border-line px-3 text-meta aria-pressed:border-transparent">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bandColors.bands[m.band] }} />
                  {labelForSlug(m.slug)} · {m.wk.toFixed(1)}/wk · {BAND_WORD[m.band]}
                </button>
              ))}
            </div>
          </div>
        )}

        {selected.size > 0 ? (
          <div className="flex flex-col gap-3">
            <SectionLabel>Selected muscle{selected.size > 1 ? 's' : ''}</SectionLabel>
            {[...selected].map(slug => (
              <MuscleDetailCard
                key={slug}
                read={readMuscle(ctx, slug)}
                windowDays={windowDays}
                priorHasData={priorHasData}
                isExperienceAdjusted={isExperienceAdjusted}
              />
            ))}
          </div>
        ) : (
          <p className="max-w-xl py-1 text-body text-fg-muted">
            {hasData
              ? 'Tap a muscle (on the body or a chip) to see, in plain terms, whether you\'re training it enough — plus frequency, trend, which exercises hit it, and when.'
              : 'Log a workout and sync — your muscle volume lights up here.'}
          </p>
        )}

        {unattributed.sets > 0 && (
          <p className="flex items-center gap-1 text-meta text-fg-muted">
            + {unattributed.sets} sets of cardio / full-body / other not shown on the map
            <InfoBubble>Cardio, full-body and "other" exercises don't target one specific muscle, so their primary work isn't coloured on the body. (Their secondary muscles, if any, still count.)</InfoBubble>
          </p>
        )}
      </div>
    </div>
    </div>
    </div>
  )
}
