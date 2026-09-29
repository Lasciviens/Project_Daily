import { useState } from 'react'
import { Activity, Dumbbell, Footprints, HeartPulse, Moon, Scale } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals'
import { Button, AnimatedNumber } from '../../../../shared/ui'
import { HEALTH_SECTIONS, type HealthSectionId } from '../sectionTypes'
import { fmtClock } from '../../healthTrendStats'
import type { HealthHero as Hero } from './useHealthHero'
import { HeroTile } from './HeroTile'
import { changeTone, hm, num, signed, signedHm } from './heroFormat'
import { ExerciseDetail, SleepDetail, StepsDetail } from './HeroDetailsActivity'
import { RhrDetail, VitalsDetail, WeightDetail } from './HeroDetailsBody'
import { fmtDayMonth } from '../healthFormat'
import { nightMissingText, nightNoun } from '../../healthDateLabels'
import { BENCHMARKS, BETTER_LABEL, TILE_PLAIN, betterFor } from '../../benchmarks/healthBenchmarks'

/** A tile's big number: counts up with the "More" animations; "—" when there is none. */
function counted(v: number | null | undefined, format: (v: number) => string = x => num(x)) {
  return v == null || !Number.isFinite(v) ? '—' : <AnimatedNumber value={v} format={format} />
}

// "How you're doing": the six tier-1 tiles from the metric ranking
// (docs/training-health/research/research-rank.json), in its order. No
// composite score (house rule) — each tile stands on its own reference.

type TileId = 'sleep' | 'steps' | 'exercise' | 'rhr' | 'weight' | 'vitals'

const TITLES: Record<TileId, string> = {
  sleep: 'Sleep', steps: 'Steps', exercise: 'Exercise this week', rhr: 'Resting heart rate', weight: 'Weight', vitals: 'Overnight vitals',
}

/** The window that holds each tile's full charts. */
const TILE_SECTION: Record<TileId, HealthSectionId> = {
  sleep: 'sleep', steps: 'activity', exercise: 'activity', rhr: 'heart', weight: 'body', vitals: 'heart',
}

export function HealthHero({ hero, onViewDay, onOpenSection }: {
  hero: Hero
  onViewDay: (date: string) => void
  onOpenSection?: (id: HealthSectionId) => void
}) {
  const [open, setOpen] = useState<TileId | null>(null)
  // "View this day" from a sheet's chart closes the sheet first.
  const viewDay = (date: string) => { setOpen(null); onViewDay(date) }
  const target = open ? HEALTH_SECTIONS.find(s => s.id === TILE_SECTION[open]) : undefined
  const footer = open && target && onOpenSection
    ? <Button className="w-full sm:w-auto" onClick={() => { setOpen(null); onOpenSection(target.id) }}>Open the {target.label} tab</Button>
    : undefined
  const { sleep, steps, exercise, rhr, weight, vitals } = hero
  const band = (c: { label: string; tone: 'danger' | 'warn' | 'neutral' | 'success' | 'info' } | null, prefix = '') =>
    c ? { label: `${prefix}${c.label}`, tone: c.tone } : null

  const sleepDelta = sleep.avg7 != null && sleep.prevAvg7 != null ? sleep.avg7 - sleep.prevAvg7 : null
  const stepsDelta = steps.avg7 != null && steps.prevAvg7 != null ? steps.avg7 - steps.prevAvg7 : null
  const exDelta = exercise.minutes7 != null && exercise.prevMinutes7 != null ? exercise.minutes7 - exercise.prevMinutes7 : null
  const hrvDelta = vitals.hrv7 != null && vitals.hrvRange ? vitals.hrv7 - vitals.hrvRange.center : null
  const weightStale = weight.ma7 == null && weight.lastDate != null

  const bodyCls = weight.whtrCls ? band(weight.whtrCls, 'Waist-to-height · ') : band(weight.bmiCls, 'BMI · ')
  const bodyExtras = [
    weight.bmi != null ? `BMI ${num(weight.bmi, 1)}` : null,
    weight.whtr != null ? `WHtR ${num(weight.whtr, 2)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <section aria-labelledby="health-hero-title" className="flex flex-col gap-3">
      <h2 id="health-hero-title" className="text-lead font-semibold text-fg">
        How you’re doing <span className="text-meta font-normal text-fg-muted">· as of {hero.isToday ? 'today' : fmtDayMonth(hero.anchor)}</span>
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {/* Only the night that ended on this day counts as "last night" — a
            missing night says so; it is never replaced by an older one. */}
        <HeroTile icon={<Moon />} label="Sleep" onOpen={() => setOpen('sleep')} isLoading={sleep.isLoading}
          empty={sleep.avg7 == null && sleep.lastNight == null ? `${nightMissingText(hero.anchor, hero.today)}, and too few nights this week for an average.` : null}
          value={counted(sleep.lastNight, hm)}
          unit={nightNoun(hero.anchor, hero.today)}
          sub={<>
            {sleep.lastNight == null && <>{nightMissingText(hero.anchor, hero.today)}. </>}
            {sleep.avg7 != null && <>7-night average {hm(sleep.avg7)} · </>}
            {sleep.wake ? <>wake {fmtClock(sleep.wake.center)} ± {Math.round(sleep.wake.sd)} min</> : 'wake-time spread needs 5 nights'}
          </>}
          change={sleepDelta != null ? { text: `${signedHm(sleepDelta)} vs previous 7`, tone: changeTone(sleepDelta, 'up', 0.25) } : null}
          band={band(sleep.cls)} better="7–9 h is best, and a steady wake time" aim={hero.aims.sleep}
          plain={BENCHMARKS.sleep_duration.plain} />

        <HeroTile icon={<Footprints />} label="Steps" onOpen={() => setOpen('steps')} isLoading={steps.isLoading}
          empty={steps.avg7 == null ? 'Too few days with steps in the last week.' : null}
          value={counted(steps.avg7)} unit="/day, 7-day average"
          sub={hero.isToday ? <>Today so far {num(steps.todaySoFar)}</> : null}
          change={stepsDelta != null ? { text: `${signed(stepsDelta)} vs previous 7`, tone: changeTone(stepsDelta, 'up', 500) } : null}
          band={band(steps.cls)} better={BETTER_LABEL[betterFor(BENCHMARKS.step_count.higherIsBetter)]} aim={hero.aims.steps}
          plain={BENCHMARKS.step_count.plain} />

        <HeroTile icon={<Dumbbell />} label="Exercise this week" onOpen={() => setOpen('exercise')} isLoading={exercise.isLoading}
          empty={exercise.minutes7 == null && exercise.strengthDays7 === 0 ? 'No exercise minutes or workouts in the last 7 days.' : null}
          value={counted(exercise.minutes7 ?? 0)} unit="of 150 min"
          sub={<>Strength days {exercise.strengthDays7} of 2 (Hevy)</>}
          change={exDelta != null ? { text: `${signed(exDelta)} min vs previous 7`, tone: changeTone(exDelta, 'up', 20) } : null}
          band={band(exercise.cls)} better={BETTER_LABEL.higher} aim={hero.aims.exercise}
          plain={TILE_PLAIN.exercise} />

        <HeroTile icon={<HeartPulse />} label="Resting heart rate" onOpen={() => setOpen('rhr')} isLoading={rhr.isLoading}
          empty={rhr.avg7 == null ? 'Too few resting heart-rate readings this week.' : null}
          value={counted(rhr.avg7)} unit="bpm, 7-day average"
          sub={rhr.baseline ? <>Your 60-day baseline {num(rhr.baseline.median)} bpm</> : 'Baseline needs 14 days of readings'}
          change={rhr.delta != null ? { text: `${signed(rhr.delta)} bpm vs baseline`, tone: rhr.delta >= 5 ? 'warn' : rhr.delta <= -3 ? 'success' : 'neutral' } : null}
          band={band(rhr.cls)} better={BETTER_LABEL.lower} aim={hero.aims.rhr}
          plain={BENCHMARKS.resting_heart_rate.plain} />

        <HeroTile icon={<Scale />} label="Weight" onOpen={() => setOpen('weight')} isLoading={weight.isLoading}
          empty={weight.lastKg == null ? 'No weigh-ins yet.' : null}
          value={counted(weight.ma7 ?? weight.lastKg, v => num(v, 1))} unit={weightStale ? 'kg, last weigh-in' : 'kg, 7-day average'}
          sub={<>
            {weight.lastDate && <>Last weigh-in {fmtDayMonth(weight.lastDate)}</>}
            {bodyExtras && <> · {bodyExtras}</>}
          </>}
          change={weight.perWeek != null ? { text: `${signed(weight.perWeek, 2)} kg/week (28 days)`, tone: 'neutral' } : null}
          band={bodyCls} better={BETTER_LABEL.range} aim={hero.aims.weight}
          plain={TILE_PLAIN.weight} />

        <HeroTile icon={<Activity />} label="Overnight vitals" onOpen={() => setOpen('vitals')} isLoading={vitals.isLoading}
          empty={vitals.hrv7 == null && vitals.summary.checked === 0 ? 'Not enough overnight readings yet.' : null}
          value={counted(vitals.hrv7)} unit="ms HRV, 7-day average"
          sub={vitals.hrvRange ? <>Your usual {num(vitals.hrvRange.low)}–{num(vitals.hrvRange.high)} ms</> : 'Usual range needs 14 days of HRV'}
          change={hrvDelta != null ? { text: `${signed(hrvDelta)} ms vs your average`, tone: 'neutral' } : null}
          band={vitals.summary.tone ? { label: vitals.summary.text, tone: vitals.summary.tone } : null}
          better="Inside your own usual range is best" aim={hero.aims.vitals}
          plain={TILE_PLAIN.vitals} />
      </div>

      <ModalShell open={open != null} onClose={() => setOpen(null)} title={open ? TITLES[open] : ''} size="lg" footer={footer}>
        {open === 'sleep' && <SleepDetail hero={hero} onViewDay={viewDay} />}
        {open === 'steps' && <StepsDetail hero={hero} onViewDay={viewDay} />}
        {open === 'exercise' && <ExerciseDetail hero={hero} onViewDay={viewDay} />}
        {open === 'rhr' && <RhrDetail hero={hero} onViewDay={viewDay} />}
        {open === 'weight' && <WeightDetail hero={hero} onViewDay={viewDay} />}
        {open === 'vitals' && <VitalsDetail hero={hero} onViewDay={viewDay} />}
      </ModalShell>
    </section>
  )
}
