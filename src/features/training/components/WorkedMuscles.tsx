import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subDays, formatDistanceToNow, format } from 'date-fns'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { fetchMuscleVolume } from '../api/hevyApi'
import {
  slugForHevyGroup, contribution, MUSCLE_LANDMARKS, BANDS_META, bandForWeeklySets,
  UNTRAINED_COLOR, SIDE_SLUGS, labelForSlug, type MuscleRole,
} from '../muscleMap'

const ROLE_LABEL: Record<MuscleRole, string> = { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' }

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles" — a stylised body coloured by weekly HARD-SET VOLUME per
//  muscle against evidence-based per-muscle landmarks (MV/MEV/MAV/MRV). Diverging
//  scale: cold = under-dosed, green = optimal growth range, hot = over your
//  recoverable ceiling. Primary muscle = 1.0 set, secondary = 0.5 (via the
//  contribution() seam, ready for future per-exercise % from the DB). Window:
//  30 days (default) or 90. Tap muscles to inspect (multi-select).
// ─────────────────────────────────────────────────────────────────────────────

type Period = '30d' | '90d'
const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
]

interface ExerciseHit { sets: number; credited: number; role: MuscleRole }
interface SlugAgg { credited: number; dates: Set<string>; exercises: Map<string, ExerciseHit> }

function InfoBubble({ children }: { children: React.ReactNode }) {
  return (
    <Popover className="relative inline-block">
      <PopoverButton className="w-4 h-4 rounded-full bg-ink-200 text-ink-600 text-[10px] font-bold leading-none inline-flex items-center justify-center hover:bg-ink-300 focus:outline-none align-middle">
        i
      </PopoverButton>
      <PopoverPanel anchor="bottom start" className="z-[70] w-72 max-w-[85vw] rounded-xl border border-ink-200 bg-cream-50 p-3 text-xs text-ink-600 leading-relaxed shadow-lg">
        {children}
      </PopoverPanel>
    </Popover>
  )
}

// A labelled dual-bar for a balance ratio — on its own row so the numbers never
// collide (the old inline "Push : Pull 12.0 : 6.1" wrapped into itself).
function RatioRow({ label, a, b, warn, verdict }: { label: string; a: number; b: number; warn: boolean; verdict: string }) {
  const total = a + b || 1
  const pa = Math.round((a / total) * 100)
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[11px] mb-0.5">
        <span className="text-ink-600">{label}</span>
        <span className={warn ? 'text-amber-700 font-semibold' : 'text-ink-400'}>{a.toFixed(1)} vs {b.toFixed(1)} · {verdict}{warn ? ' ⚠' : ''}</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-ink-100">
        <div style={{ width: `${pa}%`, backgroundColor: '#6366f1' }} />
        <div style={{ width: `${100 - pa}%`, backgroundColor: '#f59e0b' }} />
      </div>
    </div>
  )
}

// Plain-language "what does this mean / what to do", no MEV/MAV jargon in the
// main text (that stays in the info bubble).
function bandGuidance(band: number, L?: { mev: number; mav: number; mrv: number }): string {
  if (!L) return ''
  switch (band) {
    case 1: return `Below the level needed even to hold this muscle. Aim for at least ${L.mev} sets a week to start growing it.`
    case 2: return `Enough to maintain, but not to grow. Aim for ${L.mev}–${L.mav} sets a week to build it.`
    case 3: return `In the growth sweet spot (${L.mev}–${L.mav} sets a week). Keep it here.`
    case 4: return `High volume — near the most you can recover from (~${L.mrv}/week). Fine short-term; watch fatigue.`
    case 5: return `Above what you can usually recover from (~${L.mrv}/week). Consider trimming a few sets.`
    default: return 'Not trained in this period.'
  }
}

const ROLE_BADGE: Record<MuscleRole, string> = {
  primary:   'bg-accent-100 text-accent-700',
  secondary: 'bg-cream-200 text-ink-500',
  tertiary:  'bg-cream-100 text-ink-400',
}

export function WorkedMuscles() {
  const [side, setSide]     = useState<'front' | 'back'>('front')
  const [period, setPeriod] = useState<Period>('30d')
  const [selected, setSelected] = useState<Set<Slug>>(new Set())

  const windowDays = PERIODS.find(p => p.id === period)!.days
  const weeks = windowDays / 7

  // The query window must be STABLE across renders or React Query refetches
  // forever (a fresh `new Date()` each render = a new key each render). Anchor
  // to the calendar day so the key only changes when the day or period changes.
  const anchorDay = format(new Date(), 'yyyy-MM-dd')
  const { fromIso, toIso } = useMemo(() => {
    const end = new Date(`${anchorDay}T23:59:59`)
    return { fromIso: subDays(end, windowDays).toISOString(), toIso: end.toISOString() }
  }, [windowDays, anchorDay])

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: recentWorkouts = [] } = useHevyWorkouts({ limit: 1 })
  const lastAt = recentWorkouts[0]?.start_time ?? recentWorkouts[0]?.hevy_created_at ?? null

  const { data: volume = [], isLoading } = useQuery({
    queryKey: ['hevy', 'muscle-volume', windowDays, anchorDay],
    queryFn:  () => fetchMuscleVolume(fromIso, toIso),
    staleTime: 5 * 60_000,
  })

  // templateId → { primary slug|null, secondary slugs[], title }
  const tplById = useMemo(() => {
    const m = new Map<string, { primary: Slug | null; secondaries: Slug[]; title: string }>()
    for (const t of templates) {
      const primary = slugForHevyGroup(t.primary_muscle_group)
      const secondaries = (t.secondary_muscle_groups ?? [])
        .map(slugForHevyGroup)
        .filter((s): s is Slug => !!s)
      m.set(t.id, { primary, secondaries, title: t.title })
    }
    return m
  }, [templates])

  // Aggregate credited working sets per slug + which exercises/dates hit it.
  const { perSlug, unattributed, totalWorkingSets, workoutCount } = useMemo(() => {
    const acc: Record<string, SlugAgg> = {}
    const add = (slug: string, credit: number, date: string, title: string, ws: number, role: MuscleRole) => {
      const e = acc[slug] ?? (acc[slug] = { credited: 0, dates: new Set(), exercises: new Map() })
      e.credited += credit
      if (date) e.dates.add(date.slice(0, 10))
      const prev = e.exercises.get(title)
      e.exercises.set(title, prev
        ? { sets: prev.sets + ws, credited: prev.credited + credit, role: prev.role === 'primary' ? 'primary' : role }
        : { sets: ws, credited: credit, role })
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
        add(t.primary, row.workingSets * contribution(row.templateId, t.primary, 'primary'), row.workoutDate, t.title, row.workingSets, 'primary')
      } else {
        unattributedSets += row.workingSets
        if (row.workingSets > 0) unattributedTitles.add(t.title)
      }
      for (const s of t.secondaries) {
        add(s, row.workingSets * contribution(row.templateId, s, 'secondary'), row.workoutDate, t.title, row.workingSets, 'secondary')
      }
    }
    return {
      perSlug: acc,
      unattributed: { sets: unattributedSets, exercises: unattributedTitles.size },
      totalWorkingSets,
      workoutCount: workouts.size,
    }
  }, [volume, tplById])

  const weeklyOf = (slug: string) => (perSlug[slug]?.credited ?? 0) / weeks
  const bandOf = (slug: string) => bandForWeeklySets(slug, weeklyOf(slug))

  // Body colouring by band (selection-aware: only selected coloured if a
  // selection is active).
  const bodyData = useMemo<ExtendedBodyPart[]>(() => {
    const slugs = selected.size > 0 ? [...selected] : Object.keys(perSlug)
    const out: ExtendedBodyPart[] = []
    for (const slug of slugs) {
      const band = bandForWeeklySets(slug, (perSlug[slug]?.credited ?? 0) / weeks)
      if (band > 0) out.push({ slug: slug as Slug, color: BANDS_META[band].color })
    }
    return out
  }, [perSlug, selected, weeks])

  // Chips for the current side, most-worked first.
  const sideChips = useMemo(
    () => Object.keys(perSlug)
      .filter(slug => SIDE_SLUGS[side].has(slug as Slug))
      .map(slug => ({ slug: slug as Slug, wk: weeklyOf(slug), band: bandOf(slug) }))
      .sort((a, b) => b.wk - a.wk),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perSlug, side, weeks],
  )

  // Under-dosed (worked but below MEV) and over-MRV lists — the actionable payload.
  const { underDosed, overMrv } = useMemo(() => {
    const under: { slug: string; wk: number }[] = []
    const over:  { slug: string; wk: number }[] = []
    for (const slug of Object.keys(perSlug)) {
      const b = bandForWeeklySets(slug, (perSlug[slug]?.credited ?? 0) / weeks)
      if (b === 1 || b === 2) under.push({ slug, wk: (perSlug[slug]!.credited) / weeks })
      if (b === 5) over.push({ slug, wk: (perSlug[slug]!.credited) / weeks })
    }
    under.sort((a, b) => a.wk - b.wk)
    return { underDosed: under, overMrv: over }
  }, [perSlug, weeks])

  // Balance ratios (push/pull, quad/ham).
  const balance = useMemo(() => {
    const s = (slug: string) => weeklyOf(slug)
    const push = s('chest') + s('deltoids') + s('triceps')
    const pull = s('upper-back') + s('biceps') + s('trapezius')
    const quad = s('quadriceps'), ham = s('hamstring')
    return {
      push, pull,
      pushPull: pull > 0 ? push / pull : null,
      quad, ham,
      quadHam: ham > 0 ? quad / ham : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSlug, weeks])

  function toggle(slug: Slug | null | undefined) {
    if (!slug) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug); else next.add(slug)
      return next
    })
  }

  const hasData = Object.keys(perSlug).length > 0

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8 w-full items-start">
      {/* ── LEFT: body + legend ────────────────────────────────────────── */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
            {(['front', 'back'] as const).map(v => (
              <button key={v} type="button" onClick={() => setSide(v)}
                className={`px-4 min-h-[36px] rounded-md text-sm font-semibold capitalize transition-colors ${side === v ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>
                {v}
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())}
              className="min-h-[36px] px-3 text-xs font-medium text-ink-500 hover:text-ink-800 rounded-md hover:bg-cream-100 transition-colors">
              Clear ({selected.size})
            </button>
          )}
        </div>

        <div className="relative w-full flex justify-center rounded-2xl bg-gradient-to-b from-ink-800 to-ink-950 p-5">
          {isLoading && (
            <div className="absolute inset-0 z-10 rounded-2xl bg-ink-900/60 flex items-center justify-center">
              <span className="flex items-center gap-2 text-xs text-ink-200">
                <span className="w-3 h-3 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
                Loading your volume…
              </span>
            </div>
          )}
          <div className="w-full max-w-[340px] [&>svg]:w-full [&>svg]:h-auto">
            <Body
              data={bodyData}
              side={side}
              gender="male"
              scale={1}
              defaultFill={UNTRAINED_COLOR}
              border="#ffffff1f"
              onBodyPartPress={(part) => toggle(part.slug)}
            />
          </div>
        </div>

        {/* Diverging legend with meaning labels + info bubble */}
        <div className="w-full max-w-[340px] rounded-xl border border-ink-200 bg-cream-50 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[11px] font-semibold text-ink-600">Volume vs. your body's needs</span>
            <InfoBubble>
              <p className="font-semibold text-ink-800 mb-1">How the colours work</p>
              <p className="mb-1.5">Colour = how many <strong>hard working sets per week</strong> each muscle got, compared to evidence-based volume landmarks (MEV/MAV/MRV). It's an <strong>absolute</strong> scale, not relative to your other muscles — so green really means "the right amount", not "your most-trained".</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Primary muscle of an exercise = 1 set; a secondary (synergist) = 0.5 set.</li>
                <li>Warm-up sets don't count.</li>
                <li>Shows <strong>volume</strong>, not effort/fatigue/recovery — and assumes your sets were reasonably hard.</li>
                <li>Landmarks are population averages (±); treat as guidance.</li>
              </ul>
            </InfoBubble>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {BANDS_META.map(b => (
              <div key={b.idx} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
                <span className="text-[10px] text-ink-500">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-ink-400 text-center">
          {selected.size > 0 ? 'Tap muscles to add/remove · Clear to reset' : 'Tap a muscle to inspect (multi-select)'}
        </p>
      </div>

      {/* ── RIGHT: stats ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        {lastAt && (
          <div className="flex items-baseline gap-2 rounded-xl bg-cream-100 px-3.5 py-2.5">
            <span className="text-xs text-ink-400">🏋️ Last workout</span>
            <span className="text-sm font-semibold text-ink-800">{formatDistanceToNow(new Date(lastAt), { addSuffix: true })}</span>
            <span className="text-xs text-ink-400 ml-auto">{format(new Date(lastAt), 'EEE d MMM, HH:mm')}</span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg w-fit">
            {PERIODS.map(p => (
              <button key={p.id} type="button" onClick={() => setPeriod(p.id)}
                className={`px-4 min-h-[36px] rounded-md text-sm font-semibold transition-colors ${period === p.id ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-400 flex items-center gap-1">
            weekly-set average
            <InfoBubble>
              <p>Everything is shown as <strong>sets per week</strong>: your total credited sets in the {windowDays}-day window ÷ {weeks.toFixed(1)} weeks, so it's comparable to the weekly landmarks.</p>
            </InfoBubble>
          </span>
        </div>

        <p className="text-sm text-ink-500">
          {isLoading
            ? 'Loading…'
            : workoutCount > 0
              ? <><strong className="text-ink-800">{workoutCount}</strong> workout{workoutCount !== 1 ? 's' : ''} · <strong className="text-ink-800">{totalWorkingSets}</strong> working sets · last {windowDays} days</>
              : `No workouts logged in the last ${windowDays} days.`}
        </p>

        {/* ── GENERAL OVERVIEW (muted card — deliberately distinct from the
              prominent selected-muscle card below) ─────────────────────────── */}
        {hasData && (
          <div className="rounded-xl border border-ink-100 bg-cream-100/40 p-3.5 flex flex-col gap-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Overview · last {windowDays} days</p>

            {(balance.pushPull != null || balance.quadHam != null) && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-ink-600 flex items-center gap-1">
                  Muscle balance
                  <InfoBubble><p><strong>Push</strong> = chest, shoulders, triceps. <strong>Pull</strong> = back, biceps, traps. Keeping push/pull and quads/hamstrings roughly even lowers injury risk and avoids lagging areas.</p></InfoBubble>
                </p>
                {balance.pushPull != null && (
                  <RatioRow label="Push vs Pull" a={balance.push} b={balance.pull}
                    warn={balance.pushPull < 0.8 || balance.pushPull > 1.25}
                    verdict={balance.pushPull > 1.25 ? 'push-heavy' : balance.pushPull < 0.8 ? 'pull-heavy' : 'balanced'} />
                )}
                {balance.quadHam != null && (
                  <RatioRow label="Quads vs Hamstrings" a={balance.quad} b={balance.ham}
                    warn={balance.quadHam > 1.5}
                    verdict={balance.quadHam > 1.5 ? 'quad-dominant' : 'balanced'} />
                )}
              </div>
            )}

            {underDosed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-600 flex items-center gap-1 mb-1.5">
                  Below growth level — add sets
                  <InfoBubble><p>These muscles are getting fewer weekly sets than the minimum shown to build muscle. To grow them, add working sets across the week. Tap one for its target range.</p></InfoBubble>
                </p>
                <div className="flex flex-wrap gap-1">
                  {underDosed.map(u => (
                    <button key={u.slug} onClick={() => toggle(u.slug as Slug)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 hover:border-blue-300 transition-colors">
                      {labelForSlug(u.slug)} · {u.wk.toFixed(1)}/wk
                    </button>
                  ))}
                </div>
              </div>
            )}

            {overMrv.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-600 flex items-center gap-1 mb-1.5">
                  Too much — consider easing off
                  <InfoBubble><p>These are above the volume you can usually recover from. Extra sets here may just add fatigue / injury risk rather than more growth.</p></InfoBubble>
                </p>
                <div className="flex flex-wrap gap-1">
                  {overMrv.map(u => (
                    <button key={u.slug} onClick={() => toggle(u.slug as Slug)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100 hover:border-red-300 transition-colors">
                      {labelForSlug(u.slug)} · {u.wk.toFixed(1)}/wk
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chips for current side */}
        {sideChips.length > 0 && (
          <div>
            <p className="text-[11px] text-ink-400 mb-1.5">{side === 'front' ? 'Front' : 'Back'} muscles · tap to focus</p>
            <div className="flex flex-wrap gap-1.5">
              {sideChips.map(m => (
                <button key={m.slug} onClick={() => toggle(m.slug)}
                  className={`px-3 min-h-[32px] rounded-full text-xs font-medium transition-colors border flex items-center gap-1.5 ${selected.has(m.slug) ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'}`}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BANDS_META[m.band].color }} />
                  {labelForSlug(m.slug)} · {m.wk.toFixed(1)}/wk
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── SELECTED MUSCLE (prominent, band-coloured — clearly the focus) ── */}
        {selected.size > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Selected muscle{selected.size > 1 ? 's' : ''}</p>
            {[...selected].map(slug => {
              const agg = perSlug[slug]
              const wk = (agg?.credited ?? 0) / weeks
              const band = bandForWeeklySets(slug, wk)
              const meta = BANDS_META[band]
              const L = MUSCLE_LANDMARKS[slug]
              const exercises = agg ? [...agg.exercises.entries()].sort((a, b) => b[1].credited - a[1].credited) : []
              const dates = agg ? [...agg.dates].sort((a, b) => (a < b ? 1 : -1)) : []
              return (
                <div key={slug} className="rounded-2xl border-2 bg-cream-50 overflow-hidden shadow-sm" style={{ borderColor: meta.color }}>
                  {/* Header — band colour, big number */}
                  <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ backgroundColor: meta.color + '1f' }}>
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-ink-900 leading-tight">{labelForSlug(slug)}</p>
                      <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-bold leading-none" style={{ color: meta.color }}>{wk.toFixed(1)}</p>
                      <p className="text-[10px] text-ink-400 mt-0.5">sets / week</p>
                    </div>
                  </div>

                  <div className="p-4 flex flex-col gap-3">
                    {/* Plain-language guidance */}
                    <p className="text-sm text-ink-600 flex items-start gap-1">
                      <span>{bandGuidance(band, L)}</span>
                      <InfoBubble>{meta.desc}{L && <><br /><br />Weekly-set landmarks — maintain {L.mv} · start growing (MEV) {L.mev} · best range up to (MAV) {L.mav} · ceiling (MRV) {L.mrv}.</>}</InfoBubble>
                    </p>

                    {exercises.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5 flex items-center gap-1">
                          Which exercises trained it
                          <InfoBubble><p><strong>Primary</strong> = this is the exercise's main target (counts as a full set). <strong>Secondary</strong> = it's a helper/synergist here (counts as half a set). Later we'll store an exact % per exercise.</p></InfoBubble>
                        </p>
                        <ul className="flex flex-col gap-1.5">
                          {exercises.map(([name, hit]) => (
                            <li key={name} className="flex items-center justify-between gap-2 text-sm">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${ROLE_BADGE[hit.role]}`}>{ROLE_LABEL[hit.role]}</span>
                                <span className="text-ink-700 truncate">{name}</span>
                              </span>
                              <span className="text-ink-400 shrink-0">{hit.sets} set{hit.sets !== 1 ? 's' : ''}{hit.role !== 'primary' ? ` · ${hit.credited.toFixed(1)} credited` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
                        Trained {dates.length} day{dates.length !== 1 ? 's' : ''}
                        {dates[0] && <span className="normal-case"> · last {formatDistanceToNow(new Date(dates[0]), { addSuffix: true })}</span>}
                      </p>
                      {dates.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {dates.slice(0, 12).map((d, i) => (
                            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-cream-100 text-ink-600">{format(new Date(d), 'd MMM')}</span>
                          ))}
                          {dates.length > 12 && <span className="text-[11px] text-ink-400 px-1 py-0.5">+{dates.length - 12}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-400 py-1">
            {hasData
              ? 'Tap a muscle (on the body or a chip) to see, in plain terms, whether you\'re training it enough — plus which exercises hit it and when.'
              : 'Log a workout and sync — your muscle volume lights up here.'}
          </p>
        )}

        {/* Unattributed (cardio / full-body) */}
        {unattributed.sets > 0 && (
          <p className="text-[11px] text-ink-400 flex items-center gap-1">
            + {unattributed.sets} sets of cardio / full-body / other not shown on the map
            <InfoBubble>Cardio, full-body and "other" exercises don't target one specific muscle, so their primary work isn't coloured on the body. (Their secondary muscles, if any, still count.)</InfoBubble>
          </p>
        )}
      </div>
    </div>
  )
}
