import { useState, useMemo } from 'react'
import { subDays, formatDistanceToNow, format, differenceInCalendarDays } from 'date-fns'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { useMuscleVolume } from '../hooks/useMuscleVolume'
import { useBandColors } from './muscleBandColors'
import { Card, SectionLabel, SegmentedControl, useChartColors, type Tone } from '../../../shared/ui'
import { ArrowDown, ArrowUp, Clock, Dumbbell, Flag, Plus, Scale, Target } from 'lucide-react'
import { ExerciseThumb } from '../exerciseMedia'
import { DateInput } from '../../../shared/components/DateInput'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { useAthleteProfile, useAthleteLimitations } from '../hooks/useAthleteProfile'
import type { AthleteLimitation } from '../types.athlete'
import {
  slugForHevyGroup, contribution, MUSCLE_LANDMARKS, BANDS_META,
  SIDE_SLUGS, labelForSlug, MAJOR_MUSCLES,
  scaleLandmarksForExperience, EXPERIENCE_MULTIPLIER, PATTERN_AFFECTED_SLUGS, MOVEMENT_PATTERN_LABEL,
  type MuscleRole, type Landmarks,
} from '../muscleMap'

const ROLE_LABEL: Record<MuscleRole, string> = { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' }

// A muscle flagged by an active athlete limitation is a THIRD state, deliberately
// not one of BANDS_META's six colours. Violet reads as "train carefully", never
// as green (optimal) or red (over-MRV) — most flagged muscles are still safely
// trainable through a non-conflicting exercise, so a danger-coded colour would
// overstate the restriction (a design-review correction, not a measured claim).
// Colours come from useBandColors().flag.
const FLAG_META: Record<'avoid' | 'limit', { label: string; desc: string }> = {
  avoid: {
    label: 'Training conservatively',
    desc: 'An active limitation restricts the movement pattern that usually loads this muscle hardest, with no easy substitute at heavy load. Still trainable — just favour exercises that respect the limitation.',
  },
  limit: {
    label: 'Flagged — see limitation',
    desc: 'An active limitation touches a movement pattern that helps train this muscle, but other patterns or isolation work can still load it safely.',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles" — weekly HARD-SET VOLUME per muscle vs evidence-based
//  landmarks (MV/MEV/MAV/MRV). Redesigned with a strength-coach + sports-
//  scientist review, for a NON-EXPERT: verdict-first (a plain headline + up to
//  3 fixes), jargon hidden in info bubbles, and three descriptive cues a plain
//  average destroys — FREQUENCY, TREND (vs the prior equal window) and DAYS
//  SINCE trained. Honest by design: this measures VOLUME, not effort/recovery/
//  growth — the copy never overclaims.
// ─────────────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d' | 'custom'
const PRESETS: { id: Exclude<Period, 'custom'>; label: string; days: number }[] = [
  { id: '7d',  label: '7 days',  days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
]

interface ExerciseHit { sets: number; credited: number; role: MuscleRole; lastDate: string; templateId: string }
interface SlugAgg { credited: number; dates: Set<string>; directDates: Set<string>; exercises: Map<string, ExerciseHit> }
type VolumeRow = { templateId: string; workoutId: string; workoutDate: string; workingSets: number }
type Tpl = { primary: Slug | null; secondaries: Slug[]; title: string }
interface SlugFlag { weight: 'avoid' | 'limit'; limitation: AthleteLimitation }

// InfoBubble moved to src/shared/components/InfoBubble.tsx (2026-09-02) —
// every jargon term across the Progress decision engine needed the same
// affordance, so this stopped being a single-file concern.

function RatioRow({ label, a, b, warn, verdict, bubble }: { label: string; a: number; b: number; warn: boolean; verdict: string; bubble: React.ReactNode }) {
  const c = useChartColors()
  const total = a + b || 1
  const pa = Math.round((a / total) * 100)
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between gap-2 text-meta">
        <span className="flex items-center gap-1 text-fg-2">{label} <InfoBubble>{bubble}</InfoBubble></span>
        <span data-tone={warn ? 'warn' : 'success'} className={warn ? 'tone-text font-semibold' : 'text-fg-muted'}>{verdict}{warn ? ' ⚠' : ' ✓'}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" title={`${a.toFixed(1)} vs ${b.toFixed(1)}`}>
        <div style={{ width: `${pa}%`, backgroundColor: c.series[0] }} />
        <div style={{ width: `${100 - pa}%`, backgroundColor: c.series[2] }} />
      </div>
    </div>
  )
}

// Plain-language "what to do", no MEV/MAV jargon in the main text.
function bandGuidance(band: number, L?: { mev: number; mav: number; mrv: number }): string {
  if (!L) return ''
  switch (band) {
    case 1: return `Likely too little to build this muscle — and maybe to hold it long-term. Aim for at least ${L.mev} sets a week to grow it.`
    case 2: return `Enough to maintain, but not to grow. Aim for ${L.mev}–${L.mav} sets a week to build it.`
    case 3: return `In the growth sweet spot (${L.mev}–${L.mav} sets a week). Keep it here.`
    case 4: return `High volume — near the most people recover from (~${L.mrv}/week). Fine short-term; watch fatigue.`
    case 5: return `More than the usual recoverable amount (~${L.mrv}/week). Only cut if you're sore, stalling, or sleeping badly.`
    default: return 'Not trained in this period.'
  }
}

const ROLE_BADGE: Record<MuscleRole, string> = {
  primary:   'bg-surface-hover text-fg',
  secondary: 'bg-surface-2 text-fg-muted',
  tertiary:  'bg-surface-2 text-fg-faint',
}

// Status of a whole-muscle read, for trend/recency cues.
const TREND_TONE: Record<'up' | 'down' | 'flat', Tone> = { up: 'success', down: 'warn', flat: 'neutral' }

// One-word band status for the naked-number chips (a number alone doesn't tell
// a consumer if it's good).
const BAND_WORD = ['—', 'low', 'maintain', 'good', 'high', 'over'] as const

// Aggregate credited working sets per slug from one window's volume rows.
function aggregate(volume: VolumeRow[], tplById: Map<string, Tpl>) {
  const acc: Record<string, SlugAgg> = {}
  const add = (slug: string, credit: number, date: string, title: string, ws: number, role: MuscleRole, direct: boolean, templateId: string) => {
    const e = acc[slug] ?? (acc[slug] = { credited: 0, dates: new Set(), directDates: new Set(), exercises: new Map() })
    e.credited += credit
    const day = date ? date.slice(0, 10) : ''
    if (day) { e.dates.add(day); if (direct) e.directDates.add(day) }
    const prev = e.exercises.get(title)
    e.exercises.set(title, prev
      ? { sets: prev.sets + ws, credited: prev.credited + credit, role: prev.role === 'primary' ? 'primary' : role, lastDate: day > prev.lastDate ? day : prev.lastDate, templateId }
      : { sets: ws, credited: credit, role, lastDate: day, templateId })
  }
  let unattributedSets = 0
  const unattributedTitles = new Set<string>()
  const workouts = new Set<string>()
  let totalWorkingSets = 0
  for (const row of volume) {
    const t = tplById.get(row.templateId)
    if (!t) continue
    workouts.add(row.workoutId)
    totalWorkingSets += row.workingSets
    if (t.primary) {
      add(t.primary, row.workingSets * contribution(row.templateId, t.primary, 'primary'), row.workoutDate, t.title, row.workingSets, 'primary', true, row.templateId)
    } else {
      unattributedSets += row.workingSets
      if (row.workingSets > 0) unattributedTitles.add(t.title)
    }
    for (const s of t.secondaries) {
      add(s, row.workingSets * contribution(row.templateId, s, 'secondary'), row.workoutDate, t.title, row.workingSets, 'secondary', false, row.templateId)
    }
  }
  return {
    perSlug: acc,
    unattributed: { sets: unattributedSets, exercises: unattributedTitles.size },
    totalWorkingSets,
    workoutCount: workouts.size,
  }
}

export function WorkedMuscles() {
  const bandColors = useBandColors()
  const [side, setSide]     = useState<'front' | 'back'>('front')
  const [period, setPeriod] = useState<Period>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const [selected, setSelected] = useState<Set<Slug>>(new Set())
  const [peek, setPeek] = useState<string | null>(null)   // exercise-row GIF peek
  // Hover devices open the GIF peek on hover; touch devices on tap. Binding
  // both fired a synthetic mouseenter+click on touch → open-then-close flicker.
  const hoverCapable = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches, [])

  const anchorDay = format(new Date(), 'yyyy-MM-dd')
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
  const { data: recentWorkouts = [] } = useHevyWorkouts({ limit: 1 })
  const lastAt = recentWorkouts[0]?.start_time ?? recentWorkouts[0]?.hevy_created_at ?? null

  // Athlete profile/limitations — independent of the volume window below.
  // `experienceLevel` flows into every banding/landmark helper further down (a
  // no-op when unset, so a user who never touches the athlete profile sees
  // identical numbers to before this feature existed). Limitations are
  // fetched active-only — a resolved/inactive one stops flagging immediately.
  const { data: athleteProfile } = useAthleteProfile()
  const experienceLevel = athleteProfile?.experience_level ?? null
  const isExperienceAdjusted = experienceLevel != null && EXPERIENCE_MULTIPLIER[experienceLevel] !== 1
  const { data: limitations = [] } = useAthleteLimitations(true)

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

  // Movement-pattern limitation → affected muscle slugs, fanned out per active
  // limitation (a slug can be hit by more than one). Empty when there are no
  // active limitations, so nothing downstream changes for a user who never
  // records one.
  const flagsBySlug = useMemo(() => {
    const map = new Map<Slug, SlugFlag[]>()
    for (const lim of limitations) {
      for (const { slug, weight } of PATTERN_AFFECTED_SLUGS[lim.movement_pattern] ?? []) {
        const arr = map.get(slug) ?? []
        arr.push({ weight, limitation: lim })
        map.set(slug, arr)
      }
    }
    return map
  }, [limitations])

  // 'avoid' wins over 'limit' for the same slug — it's the more restrictive
  // of the two when more than one active limitation flags it.
  function flagWeightFor(slug: string): 'avoid' | 'limit' | null {
    const hits = flagsBySlug.get(slug as Slug)
    if (!hits?.length) return null
    return hits.some(h => h.weight === 'avoid') ? 'avoid' : 'limit'
  }
  function flagFor(slug: string): { weight: 'avoid' | 'limit'; items: SlugFlag[] } | null {
    const weight = flagWeightFor(slug)
    return weight ? { weight, items: flagsBySlug.get(slug as Slug)! } : null
  }

  const { perSlug, unattributed, totalWorkingSets, workoutCount } = useMemo(
    () => aggregate(volume as VolumeRow[], tplById), [volume, tplById])
  const priorAgg = useMemo(() => aggregate(priorVolume as VolumeRow[], tplById), [priorVolume, tplById])
  const priorPerSlug = priorAgg.perSlug
  // No trend without a real baseline: if the prior equal window predates the
  // user's training history (0 workouts in it), comparing against ~0 would flag
  // almost every muscle "up" — misleading for newer lifters. Show "new" instead.
  const priorHasData = priorAgg.workoutCount > 0

  const weeklyOf = (slug: string) => (perSlug[slug]?.credited ?? 0) / weeks

  // Every banding decision and every landmark number shown in this file reads
  // MUSCLE_LANDMARKS through here — scaled to the athlete's experience level
  // (novice/advanced shift MEV+MRV ±15%; intermediate/unset passes through
  // unchanged) — so the body-diagram colour and the numbers in a muscle's own
  // info bubble can never disagree with each other.
  const landmarksFor = (slug: string): Landmarks | undefined => {
    const L0 = MUSCLE_LANDMARKS[slug]
    return L0 ? scaleLandmarksForExperience(L0, experienceLevel) : undefined
  }
  const bandFor = (slug: string, weeklySets: number): number => {
    if (weeklySets <= 0) return 0
    const L = landmarksFor(slug)
    if (!L) return 3
    if (weeklySets < L.mv)   return 1
    if (weeklySets < L.mev)  return 2
    if (weeklySets <= L.mav) return 3
    if (weeklySets <= L.mrv) return 4
    return 5
  }
  // Same "how far from the growth range" math as muscleMap's setDeltaToRange,
  // reimplemented locally so it reads the same experience-scaled landmarks as
  // bandFor above (the exported helper only ever sees the flat table).
  const deltaFor = (slug: string, weeklySets: number):
    | { kind: 'add'; sets: number; sessions: number; mev: number; mav: number }
    | { kind: 'cut'; sets: number; mrv: number }
    | null => {
    const L = landmarksFor(slug)
    if (!L) return null
    if (weeklySets < L.mev) {
      const deficit = Math.max(1, Math.round(L.mev - weeklySets))
      return { kind: 'add', sets: deficit, sessions: Math.max(1, Math.ceil(deficit / 4)), mev: L.mev, mav: L.mav }
    }
    if (weeklySets > L.mrv) {
      return { kind: 'cut', sets: Math.max(1, Math.round(weeklySets - L.mrv)), mrv: L.mrv }
    }
    return null
  }
  const bandOf   = (slug: string) => bandFor(slug, weeklyOf(slug))
  const freqOf   = (slug: string) => (perSlug[slug]?.directDates.size ?? 0) / weeks
  const daysSinceOf = (slug: string): number | null => {
    const d = perSlug[slug]?.directDates
    if (!d || d.size === 0) return null
    const last = [...d].sort().at(-1)!
    return differenceInCalendarDays(new Date(), new Date(`${last}T00:00:00`))
  }
  // Trend: current weekly vs prior-window weekly (same length). Directional only.
  const trendOf = (slug: string): 'up' | 'down' | 'flat' | null => {
    const cur = weeklyOf(slug)
    const prior = (priorPerSlug[slug]?.credited ?? 0) / weeks
    if (cur === 0 && prior === 0) return null
    if (prior === 0) return cur > 0 ? 'up' : null
    const r = cur / prior
    return r > 1.25 ? 'up' : r < 0.75 ? 'down' : 'flat'
  }

  const bodyData = useMemo<ExtendedBodyPart[]>(() => {
    // A flagged muscle is shown even at 0 sets — the flag itself is the point,
    // not its trained-volume state (which would otherwise leave a band-0
    // muscle invisible on the diagram).
    const universe = selected.size > 0 ? [...selected] : [...new Set([...Object.keys(perSlug), ...flagsBySlug.keys()])]
    const out: ExtendedBodyPart[] = []
    for (const slug of universe) {
      const flagWeight = flagWeightFor(slug)
      if (flagWeight) { out.push({ slug: slug as Slug, color: bandColors.flag[flagWeight] }); continue }
      const band = bandFor(slug, (perSlug[slug]?.credited ?? 0) / weeks)
      if (band > 0) out.push({ slug: slug as Slug, color: bandColors.bands[band] })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSlug, selected, weeks, flagsBySlug, experienceLevel, bandColors])

  const sideChips = useMemo(
    () => Object.keys(perSlug)
      .filter(slug => SIDE_SLUGS[side].has(slug as Slug))
      .map(slug => ({ slug: slug as Slug, wk: weeklyOf(slug), band: bandOf(slug) }))
      .sort((a, b) => b.wk - a.wk),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perSlug, side, weeks, experienceLevel],
  )

  // Actionable problem lists — under-dosed limited to MAJOR muscles so we never
  // nag about neck/adductors sitting near zero.
  const { underMajors, untrainedMajors, overMrv, optimalCount, buckets } = useMemo(() => {
    const under: { slug: string; wk: number }[] = []
    const untrained: string[] = []
    const over:  { slug: string; wk: number }[] = []
    let optimal = 0, inGrowth = 0, close = 0, needWork = 0
    // Major-muscle buckets (for the coverage readout + the verdict). A ZERO-set
    // major is band 0 and would otherwise be invisible to the "under" list —
    // an entirely skipped muscle is the most important thing to surface, so it
    // gets its own list and out-ranks a merely-low one.
    for (const slug of MAJOR_MUSCLES) {
      const wk = (perSlug[slug]?.credited ?? 0) / weeks
      const b = bandFor(slug, wk)
      if (b >= 3) inGrowth++
      else if (b === 2) close++
      else needWork++
      if (b === 0) untrained.push(slug)
      else if (b === 1 || b === 2) under.push({ slug, wk })
    }
    for (const slug of Object.keys(perSlug)) {
      const b = bandFor(slug, (perSlug[slug]!.credited) / weeks)
      if (b === 3) optimal++
      if (b === 5) over.push({ slug, wk: (perSlug[slug]!.credited) / weeks })
    }
    under.sort((a, b) => a.wk - b.wk)
    over.sort((a, b) => b.wk - a.wk)
    return { underMajors: under, untrainedMajors: untrained, overMrv: over, optimalCount: optimal, buckets: { inGrowth, close, needWork } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSlug, weeks, experienceLevel])

  const balance = useMemo(() => {
    const s = (slug: string) => weeklyOf(slug)
    const push = s('chest') + s('deltoids') + s('triceps')
    const pull = s('upper-back') + s('biceps') + s('trapezius')
    const quad = s('quadriceps'), ham = s('hamstring')
    return { push, pull, pushPull: pull > 0 ? push / pull : null, quad, ham, quadHam: ham > 0 ? quad / ham : null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSlug, weeks])

  // ── Verdict banner: headline + up to 3 prioritised fixes ──
  const verdict = useMemo(() => {
    if (!workoutCount) return null
    // Over-MRV is a multi-week concept — don't alarm on a muscle that's already
    // trending DOWN (a deliberate deload). Only persistent highs make the banner.
    const persistentOver = overMrv.filter(o => {
      if (!priorHasData) return true
      const priorWk = (priorPerSlug[o.slug]?.credited ?? 0) / weeks
      return !(priorWk > 0 && o.wk / priorWk < 0.75)
    })
    const bullets: { icon: 'down' | 'add' | 'up' | 'balance'; text: string }[] = []
    for (const o of persistentOver.slice(0, 2)) {
      const d = deltaFor(o.slug, o.wk)
      bullets.push({ icon: 'down', text: `Ease off ${labelForSlug(o.slug)} — ${o.wk.toFixed(0)}/wk is more than most recover from${d?.kind === 'cut' ? `; if recovery's suffering, drop ~${d.sets} sets` : ''}.` })
    }
    // Skipped-entirely majors out-rank merely-low ones.
    for (const slug of untrainedMajors.slice(0, 2)) {
      bullets.push({ icon: 'add', text: `Start training ${labelForSlug(slug)} — nothing logged this ${windowDays === 7 ? 'week' : 'period'}. Even one session helps.` })
    }
    for (const u of underMajors.slice(0, 3)) {
      const d = deltaFor(u.slug, u.wk)
      bullets.push({ icon: 'up', text: d?.kind === 'add'
        ? `Add ~${d.sets} sets/wk to ${labelForSlug(u.slug)} (≈ ${d.sessions === 1 ? 'one more session' : `${d.sessions} more sessions`}) to reach the growth range.`
        : `Train ${labelForSlug(u.slug)} more — ${u.wk.toFixed(1)}/wk.` })
    }
    if (balance.pushPull != null && (balance.pushPull > 1.25 || balance.pushPull < 0.8)) {
      bullets.push({ icon: 'balance', text: balance.pushPull > 1.25 ? `You're push-heavy — add back & biceps (pull) work.` : `You're pull-heavy — add chest/shoulder (push) work.` })
    }
    const top = bullets.slice(0, 3)
    const needCount = untrainedMajors.length + underMajors.length
    const needNames = [...untrainedMajors, ...underMajors.map(u => u.slug)].map(labelForSlug)
    let headline: string
    if (smallSample) headline = `Light snapshot — here's your last ${windowDays} days per muscle.`
    else if (persistentOver.length) headline = `Solid work — but you're overcooking ${persistentOver.slice(0, 2).map(o => labelForSlug(o.slug)).join(' & ')}.`
    else if (buckets.inGrowth <= 1 && needCount >= 3) headline = `Just getting started — ${buckets.inGrowth} muscle${buckets.inGrowth !== 1 ? 's' : ''} in the growth range so far. Build from here.`
    else if (needCount >= 3) headline = `Decent base, but ${needCount} muscles need more for growth.`
    else if (needCount) headline = `Mostly on track — just ${needNames.join(' & ')} needs more.`
    else if (optimalCount >= 4) headline = `Dialled in — most muscles are in the growth sweet spot. Keep it up.`
    else headline = `Here's how your last ${windowDays} days stack up per muscle.`
    return { headline, bullets: top, extra: bullets.length - top.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutCount, overMrv, underMajors, untrainedMajors, buckets, balance.pushPull, optimalCount, smallSample, windowDays, priorHasData, priorPerSlug, weeks, experienceLevel])

  function toggle(slug: Slug | null | undefined) {
    if (!slug) return
    setSelected(prev => { const n = new Set(prev); if (n.has(slug)) n.delete(slug); else n.add(slug); return n })
  }

  const hasData = Object.keys(perSlug).length > 0
  const trendIcon = (t: ReturnType<typeof trendOf>) => t === 'up' ? '↑' : t === 'down' ? '↓' : t === 'flat' ? '→' : ''
  const BULLET_ICON = { down: ArrowDown, add: Plus, up: ArrowUp, balance: Scale } as const

  return (
    <div className="@container w-full">
    <div className="flex flex-col gap-4 w-full">

      {/* ── VERDICT BANNER — the plain-language "am I OK?" answer, first ── */}
      {verdict && (
        <Card className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-ui font-semibold text-fg">
            <Target className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />{verdict.headline}
            <InfoBubble>
              <p className="mb-1 font-semibold text-fg">How this is judged</p>
              <p>Each muscle's weekly hard working sets are compared to typical growth landmarks (MEV–MAV–MRV). This measures <strong>volume only</strong> — not how hard you pushed each set, nor recovery. Landmarks are population guidance (±several sets), not personalised targets.</p>
            </InfoBubble>
          </p>
          {verdict.bullets.length > 0 && (
            <ul className="flex flex-col gap-1">
              {verdict.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5 text-body text-fg-2">
                  {(() => { const Icon = BULLET_ICON[b.icon]; return <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden /> })()}
                  <span>{b.text}</span>
                </li>
              ))}
              {verdict.extra > 0 && <li className="text-meta text-fg-muted">+{verdict.extra} more below</li>}
            </ul>
          )}
        </Card>
      )}

    <div className="flex flex-col @3xl:flex-row gap-5 @3xl:gap-8 w-full items-start">
      {/* ── LEFT: body + legend ────────────────────────────────────────── */}
      <div className="w-full @3xl:w-[360px] @5xl:w-[420px] shrink-0 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <SegmentedControl<'front' | 'back'>
            value={side}
            onChange={setSide}
            options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]}
          />
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="btn-ghost btn-sm text-meta">
              Clear ({selected.size})
            </button>
          )}
        </div>

        {/* An always-dark stage in both themes, so the band colours read the same. */}
        <div className="relative flex w-full justify-center rounded-card bg-scrim p-3 sm:p-5">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-scrim/60">
              <span className="flex items-center gap-2 text-meta text-white/80">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
                Loading your volume…
              </span>
            </div>
          )}
          {/* The body SVG is ~1:2.5, so a full-width 340px box renders ~850px
              tall — taller than the usable phone viewport, pushing every stat,
              the legend and the under-dosed list a full swipe below the fold.
              Capped narrower below sm; desktop keeps the original size. */}
          <div className="w-full max-w-[220px] sm:max-w-[340px] [&>svg]:w-full [&>svg]:h-auto">
            <Body data={bodyData} side={side} gender="male" scale={1} defaultFill={bandColors.untrained} border="rgb(255 255 255 / 0.12)" onBodyPartPress={(part) => toggle(part.slug)} />
          </div>
        </div>

        <div className="card w-full max-w-[340px] p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-meta font-semibold text-fg-2">Are you training each muscle the right amount?</span>
            <InfoBubble>
              <p className="mb-1 font-semibold text-fg">How the colours work</p>
              <p className="mb-1.5">Colour = how many <strong>hard working sets per week</strong> each muscle got, vs typical volume landmarks. <strong>Green means the growth sweet spot — that's the goal, not "the most".</strong> Blue/teal = too little to grow it; amber/red = more than the body usually turns into muscle, so extra mostly adds fatigue.</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Primary muscle of an exercise = 1 set; a secondary (helper) = half a set (a convention, not a measured value).</li>
                <li>Warm-up sets don't count.</li>
                <li>Shows <strong>volume</strong>, not effort/recovery — assumes your sets were reasonably hard.</li>
                <li>Landmarks are population averages (±); guidance, not personalised.</li>
                {flagsBySlug.size > 0 && <li>A violet muscle is <strong>flagged</strong> by an active limitation — not "good" or "bad". Open that muscle's card for which limitation and why.</li>}
              </ul>
            </InfoBubble>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {BANDS_META.map(b => (
              <div key={b.idx} className="flex items-center gap-1.5">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: bandColors.bands[b.idx] }} />
                <span className="text-micro font-normal text-fg-muted">{b.label}</span>
              </div>
            ))}
            {flagsBySlug.size > 0 && (['avoid', 'limit'] as const).map(w => (
              <div key={w} className="flex items-center gap-1.5">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: bandColors.flag[w] }} />
                <span className="text-micro font-normal text-fg-muted">{FLAG_META[w].label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-center text-meta text-fg-muted">
          {selected.size > 0 ? 'Tap muscles to add/remove · Clear to reset' : 'Tap a muscle to inspect (multi-select)'}
        </p>
      </div>

      {/* ── RIGHT: stats ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        {lastAt && (
          <div className="flex items-baseline gap-2 rounded-row bg-surface-2 px-3.5 py-2.5">
            <span className="flex items-center gap-1 self-center text-meta text-fg-muted"><Dumbbell className="h-3.5 w-3.5" aria-hidden /> Last workout</span>
            <span className="text-body font-semibold text-fg">{formatDistanceToNow(new Date(lastAt), { addSuffix: true })}</span>
            <span className="ml-auto text-meta tabular-nums text-fg-muted">{format(new Date(lastAt), 'EEE d MMM, HH:mm')}</span>
          </div>
        )}

        {/* Period selector: 7 / 30 / 90 / Custom */}
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

        {/* ── OVERVIEW (balance) ── */}
        {hasData && (balance.pushPull != null || balance.quadHam != null) && (
          <Card className="flex max-w-xl flex-col gap-2.5">
            <SectionLabel>Muscle balance · last {windowDays} days</SectionLabel>
            {balance.pushPull != null && (
              <RatioRow label="Push vs Pull" a={balance.push} b={balance.pull}
                warn={balance.pushPull < 0.8 || balance.pushPull > 1.25}
                verdict={balance.pushPull > 1.25 ? 'push-heavy' : balance.pushPull < 0.8 ? 'pull-heavy' : 'balanced'}
                bubble={<p><strong>Push</strong> = chest, shoulders, triceps. <strong>Pull</strong> = back, biceps, traps. Training them roughly evenly keeps your physique and posture balanced. (A rough balance guide — there's no strong evidence a specific ratio is required.)</p>} />
            )}
            {balance.quadHam != null && (
              <RatioRow label="Quads vs Hamstrings" a={balance.quad} b={balance.ham}
                warn={balance.quadHam > 1.5}
                verdict={balance.quadHam > 1.5 ? 'quad-dominant' : 'balanced'}
                bubble={<p>Front vs back of the thigh. Big quad dominance is often paired with lagging hamstrings — balance it with curls or Romanian deadlifts. (Balance guidance, not a medical claim.)</p>} />
            )}
          </Card>
        )}

        {/* Chips for current side, with a status word so a number isn't naked */}
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

        {/* ── SELECTED MUSCLE ── */}
        {selected.size > 0 ? (
          <div className="flex flex-col gap-3">
            <SectionLabel>Selected muscle{selected.size > 1 ? 's' : ''}</SectionLabel>
            {[...selected].map(slug => {
              const agg = perSlug[slug]
              const wk = (agg?.credited ?? 0) / weeks
              const band = bandFor(slug, wk)
              const flag = flagFor(slug)
              const meta = flag ? FLAG_META[flag.weight] : BANDS_META[band]
              const metaColor = flag ? bandColors.flag[flag.weight] : bandColors.bands[band]
              const L = landmarksFor(slug)
              const exercises = agg ? [...agg.exercises.entries()].sort((a, b) => b[1].credited - a[1].credited) : []
              const dates = agg ? [...agg.dates].sort((a, b) => (a < b ? 1 : -1)) : []
              const freq = freqOf(slug)
              const sessions = agg?.directDates.size ?? 0
              const since = daysSinceOf(slug)
              const trend = trendOf(slug)
              const delta = deltaFor(slug, wk)
              return (
                <div key={slug} className="card overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${metaColor}` }}>
                    <div className="min-w-0">
                      <p className="text-title font-semibold leading-tight text-fg">{labelForSlug(slug)}</p>
                      <span className="flex items-center gap-1.5 text-meta font-semibold text-fg-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: metaColor }} />{meta.label}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-kpi font-bold leading-none tabular-nums text-fg">{wk.toFixed(1)}</p>
                      <p className="mt-0.5 text-micro font-normal text-fg-muted">sets / week</p>
                    </div>
                  </div>

                  <div className="p-4 flex flex-col gap-3">
                    {/* Flag explanation — its own distinct state, named to the
                        source limitation so a violet header never reads as an
                        unexplained colour change. Volume guidance below still
                        proceeds normally: a flag narrows exercise CHOICE, it
                        doesn't erase the muscle's real training-volume read. */}
                    {flag && (
                      <div className="flex flex-col gap-1.5 rounded-row border border-line bg-surface-2 px-3 py-2.5">
                        <p className="flex items-center gap-1.5 text-meta font-semibold text-fg">
                          <Flag className="h-3.5 w-3.5" style={{ color: metaColor }} aria-hidden /> {meta.label}
                          <InfoBubble>{meta.desc} Flagging a muscle never means it can't be trained — it means favouring exercises that don't rely on the flagged movement pattern.</InfoBubble>
                        </p>
                        <ul className="flex flex-col gap-1">
                          {flag.items.map((hit, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-meta text-fg-2">
                              <span className="shrink-0 font-semibold text-fg">{hit.weight === 'avoid' ? '(avoid)' : '(limit)'}</span>
                              <span>{MOVEMENT_PATTERN_LABEL[hit.limitation.movement_pattern]}{hit.limitation.note ? ` — "${hit.limitation.note}"` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Action first — plain-language guidance + concrete "what to do" */}
                    <p className="flex items-start gap-1 text-body text-fg-2">
                      <span>
                        {bandGuidance(band, L)}
                        {delta?.kind === 'add' && ` That's about ${delta.sets} more sets a week — roughly ${delta.sessions === 1 ? 'one more session' : `${delta.sessions} more sessions`}.`}
                        {delta?.kind === 'cut' && ` If you're not recovering well, drop about ${delta.sets} sets.`}
                      </span>
                      <InfoBubble>
                        {BANDS_META[band].desc}
                        {L && (
                          <>
                            <br /><br />
                            Weekly-set landmarks — maintain {L.mv} · start growing (MEV) {L.mev} · best range up to (MAV) {L.mav} · usual ceiling (MRV) {L.mrv}. Population guidance, not personalised. Assumes your sets were reasonably hard.
                            {isExperienceAdjusted && (
                              <>
                                <br /><br />
                                Adjusted ±15% for your experience level — an unvalidated adjustment on top of an already-heuristic baseline, not a measured number.
                              </>
                            )}
                          </>
                        )}
                      </InfoBubble>
                    </p>

                    {/* Descriptive cues, second */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
                      <span className="flex items-center gap-1 text-fg-2">
                        trained <strong className="tabular-nums text-fg">{sessions}×</strong> in {windowDays}d
                        <InfoBubble><p>Days you <strong>directly</strong> trained this muscle (~{freq.toFixed(1)}/week). Days it only assisted another lift aren't counted here. Same weekly sets usually feel better split over 2 days — frequency distributes volume, it isn't a growth multiplier by itself.</p></InfoBubble>
                      </span>
                      {priorHasData ? (trend && (
                        <span data-tone={TREND_TONE[trend]} className="tone-text flex items-center gap-1">
                          {trendIcon(trend)} {trend === 'up' ? 'more than usual' : trend === 'down' ? 'less than usual' : 'steady'}
                          <InfoBubble><p>This window's volume vs the previous {windowDays} days. Descriptive only — more/less lately, not "growing faster". A drop may just be a lighter week.</p></InfoBubble>
                        </span>
                      )) : (
                        <span className="text-fg-muted">new — no baseline yet</span>
                      )}
                      {since != null && (
                        <span data-tone={since > 7 ? 'warn' : undefined} className={`flex items-center gap-1 ${since > 7 ? 'tone-text' : 'text-fg-muted'}`}>
                          {since > 7 && <Clock className="h-3 w-3" aria-hidden />}
                          last trained {since === 0 ? 'today' : `${since}d ago`}
                        </span>
                      )}
                    </div>

                    {/* Bottom line — one closing imperative (mirrors the AI coach) */}
                    <p className="rounded-row bg-surface-2 px-2.5 py-1.5 text-meta font-semibold text-fg">
                      Bottom line: {delta?.kind === 'add'
                        ? `add ~${delta.sets} sets of ${labelForSlug(slug)} work (≈ ${delta.sessions === 1 ? 'one more session' : `${delta.sessions} sessions`}).`
                        : delta?.kind === 'cut'
                          ? `hold volume here; only trim if recovery's suffering.`
                          : `keep it here — progress load (reps then weight), not more sets.`}
                    </p>

                    {exercises.length > 0 && (
                      <div>
                        <p className="section-label mb-1.5 flex items-center gap-1">
                          Which exercises trained it
                          <InfoBubble><p>Full badge = this exercise mainly works this muscle. Half badge = this muscle just assists here, so it counts as half a set toward the weekly total. Hover/tap a row for its demo & last-trained date.</p></InfoBubble>
                        </p>
                        <ul className="flex flex-col gap-1.5">
                          {exercises.map(([name, hit]) => {
                            const key = `${slug}:${name}`
                            const open = peek === key
                            return (
                              <li key={name}
                                {...(hoverCapable
                                  ? { onMouseEnter: () => setPeek(key), onMouseLeave: () => setPeek(p => (p === key ? null : p)) }
                                  : { onClick: () => setPeek(p => (p === key ? null : key)) })}
                                className="cursor-pointer rounded-row transition-colors hover:bg-surface-hover">
                                <div className="flex min-h-[44px] items-center justify-between gap-2 px-1 py-1 text-body">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-bold uppercase ${ROLE_BADGE[hit.role]}`}>{ROLE_LABEL[hit.role]}</span>
                                    <span className="truncate text-fg-2">{name}</span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1.5 text-meta tabular-nums text-fg-muted">
                                    {hit.sets} set{hit.sets !== 1 ? 's' : ''}
                                    <span className="text-fg-faint" aria-hidden>{open ? '▾' : '▸'}</span>
                                  </span>
                                </div>
                                {open && (
                                  <div className="flex items-center gap-3 px-2 pb-2 pt-0.5">
                                    <ExerciseThumb title={name} templateId={hit.templateId} size={64} />
                                    <div className="text-meta text-fg-muted">
                                      <p className="font-medium text-fg-2">{name}</p>
                                      <p>Last trained {formatDistanceToNow(new Date(`${hit.lastDate}T00:00:00`), { addSuffix: true })}</p>
                                      <p className="tabular-nums">{format(new Date(`${hit.lastDate}T00:00:00`), 'EEE d MMM')}</p>
                                    </div>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    <div>
                      <p className="section-label mb-1">
                        Trained {dates.length} day{dates.length !== 1 ? 's' : ''}
                        {dates[0] && <span className="normal-case"> · last {formatDistanceToNow(new Date(`${dates[0]}T00:00:00`), { addSuffix: true })}</span>}
                      </p>
                      {dates.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {dates.slice(0, 12).map((d, i) => (
                            <span key={i} className="chip tabular-nums">{format(new Date(`${d}T00:00:00`), 'd MMM')}</span>
                          ))}
                          {dates.length > 12 && <span className="px-1 py-0.5 text-meta text-fg-muted">+{dates.length - 12}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
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
