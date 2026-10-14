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

/** A tile's big number: counts up with the motion set; "—" when there is none. */
function counted(v: number | null | undefined, format: (v: number) => string = x => num(x)) {
  return v == null || !Number.isFinite(v) ? '—' : <AnimatedNumber value={v} format={format} />
}

// "How you're doing": the six tier-1 tiles from the metric ranking
// (docs/training-health/research/research-rank.json), in its order. No
// composite score (house rule) — each tile stands on its own reference.
// Every tile follows the range bar: a day shows that day's value, a longer
// period its average (or, for exercise, its weekly total). The labels say
// "average" / "total" only — the range bar already names the period.

type TileId = 'sleep' | 'steps' | 'exercise' | 'rhr' | 'weight' | 'vitals'

const TITLES: Record<TileId, string> = {
  sleep: 'Sleep', steps: 'Steps', exercise: 'Exercise', rhr: 'Resting heart rate', weight: 'Weight', vitals: 'Overnight vitals',
}

const delta = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null)
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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

  const { isDay } = hero
  const before = isDay ? 'the day before' : 'the period before'
  const avg = isDay ? '' : ' · average'
  const sleepDelta = delta(sleep.value, sleep.previous)
  const stepsDelta = delta(steps.value, steps.previous)
  const exDelta = delta(exercise.minutes, exercise.previous)
  const hrvDelta = vitals.hrv != null && vitals.hrvRange ? vitals.hrv - vitals.hrvRange.center : null
  const weightDelta = delta(weight.value, weight.previous)
  const thatNight = isDay ? sleep.timeline.find(t => t.date === hero.anchor) : undefined
  // A 7-day period's exercise is that week's total; a longer one, its average week.
  const exUnit = isDay ? 'min' : hero.days === 7 ? 'of 150 min · total' : 'of 150 min a week · average'
  const strengthDays = hero.days === 7 ? String(Math.round(exercise.strengthDays)) : num(exercise.strengthDays, 1)

  const bodyCls = weight.whtrCls ? band(weight.whtrCls, 'Waist-to-height · ') : band(weight.bmiCls, 'BMI · ')
  const bodyExtras = [
    weight.bmi != null ? `BMI ${num(weight.bmi, 1)}` : null,
    weight.whtr != null ? `WHtR ${num(weight.whtr, 2)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <section aria-labelledby="health-hero-title" className="@container flex flex-col gap-3">
      <h2 id="health-hero-title" className="text-lead font-semibold text-fg">
        How you’re doing <span className="text-meta font-normal text-fg-muted">· as of {hero.isToday ? 'today' : fmtDayMonth(hero.anchor)}</span>
      </h2>
      <div className="grid grid-cols-1 gap-3 @[36rem]:grid-cols-2 @[64rem]:grid-cols-3">
        {/* Only the night that ended on this day counts as "last night" — a
            missing night says so; it is never replaced by an older one. */}
        <HeroTile icon={<Moon />} label="Sleep" onOpen={() => setOpen('sleep')} isLoading={sleep.isLoading}
          empty={sleep.value == null ? (isDay ? `${nightMissingText(hero.anchor, hero.today)}.` : 'No sleep recorded in this period.') : null}
          value={counted(sleep.value, hm)}
          unit={isDay ? nightNoun(hero.anchor, hero.today) : '/night · average'}
          sub={isDay
            ? thatNight ? <>Asleep {fmtClock(thatNight.onset)} · woke {fmtClock(thatNight.wake)}</> : null
            : <>
              {sleep.lastNight != null ? <>{capFirst(nightNoun(hero.anchor, hero.today))} {hm(sleep.lastNight)}</> : nightMissingText(hero.anchor, hero.today)}
              {' · '}{sleep.wake ? <>wake {fmtClock(sleep.wake.center)} ± {Math.round(sleep.wake.sd)} min</> : 'wake-time spread needs 5 nights'}
            </>}
          change={sleepDelta != null ? { text: `${signedHm(sleepDelta)} vs ${isDay ? 'the night before' : before}`, tone: changeTone(sleepDelta, 'up', 0.25) } : null}
          band={band(sleep.cls)} better="7–9 h is best, and a steady wake time" aim={hero.aims.sleep}
          plain={BENCHMARKS.sleep_duration.plain} />

        <HeroTile icon={<Footprints />} label="Steps" onOpen={() => setOpen('steps')} isLoading={steps.isLoading}
          empty={steps.value == null ? `No steps recorded ${isDay ? 'that day' : 'in this period'}.` : null}
          value={counted(steps.value)} unit={isDay ? (steps.partial ? 'so far' : 'steps') : '/day · average'}
          sub={steps.todaySoFar != null ? <>Today so far {num(steps.todaySoFar)}</> : null}
          change={stepsDelta != null ? { text: `${signed(stepsDelta)} vs ${before}`, tone: changeTone(stepsDelta, 'up', 500) } : null}
          band={band(steps.cls)} better={BETTER_LABEL[betterFor(BENCHMARKS.step_count.higherIsBetter)]} aim={hero.aims.steps}
          plain={BENCHMARKS.step_count.plain} />

        <HeroTile icon={<Dumbbell />} label="Exercise" onOpen={() => setOpen('exercise')} isLoading={exercise.isLoading}
          empty={exercise.minutes == null && exercise.strengthDays === 0 ? `No exercise minutes or workouts ${isDay ? 'that day' : 'in this period'}.` : null}
          value={counted(exercise.minutes ?? 0)} unit={exUnit}
          sub={isDay
            ? <>{exercise.strengthDays ? 'A strength workout' : 'No strength workout'} in Hevy</>
            : <>Strength days {strengthDays} of 2{hero.days > 7 ? ' a week' : ''} (Hevy)</>}
          change={exDelta != null ? { text: `${signed(exDelta)} min vs ${before}`, tone: changeTone(exDelta, 'up', 20) } : null}
          band={band(exercise.cls)} better={BETTER_LABEL.higher} aim={hero.aims.exercise}
          plain={TILE_PLAIN.exercise} />

        <HeroTile icon={<HeartPulse />} label="Resting heart rate" onOpen={() => setOpen('rhr')} isLoading={rhr.isLoading}
          empty={rhr.value == null ? (isDay ? 'No resting heart-rate reading that day.' : 'No resting heart-rate readings in this period.') : null}
          value={counted(rhr.value)} unit={`bpm${avg}`}
          sub={rhr.baseline ? <>Your usual {num(rhr.baseline.median)} bpm</> : 'Your usual needs 14 days of readings'}
          change={rhr.delta != null ? { text: `${signed(rhr.delta)} bpm vs your usual`, tone: rhr.delta >= 5 ? 'warn' : rhr.delta <= -3 ? 'success' : 'neutral' } : null}
          band={band(rhr.cls)} better={BETTER_LABEL.lower} aim={hero.aims.rhr}
          plain={BENCHMARKS.resting_heart_rate.plain} />

        <HeroTile icon={<Scale />} label="Weight" onOpen={() => setOpen('weight')} isLoading={weight.isLoading}
          empty={weight.lastKg == null ? 'No weigh-ins yet.' : null}
          value={counted(weight.value ?? weight.lastKg, v => num(v, 1))} unit={weight.value == null ? 'kg · last weigh-in' : `kg${avg}`}
          sub={<>
            {weight.lastDate && <>Last weigh-in {fmtDayMonth(weight.lastDate)}</>}
            {bodyExtras && <> · {bodyExtras}</>}
          </>}
          change={weightDelta != null ? { text: `${signed(weightDelta, 1)} kg vs ${before}`, tone: 'neutral' } : null}
          band={bodyCls} better={BETTER_LABEL.range} aim={hero.aims.weight}
          plain={TILE_PLAIN.weight} />

        <HeroTile icon={<Activity />} label="Overnight vitals" onOpen={() => setOpen('vitals')} isLoading={vitals.isLoading}
          empty={vitals.hrv == null && vitals.summary.checked === 0 ? `Not enough overnight readings ${isDay ? 'that night' : 'in this period'}.` : null}
          value={counted(vitals.hrv)} unit={`ms HRV${avg}`}
          sub={vitals.hrvRange ? <>Your usual {num(vitals.hrvRange.low)}–{num(vitals.hrvRange.high)} ms</> : 'Usual range needs 14 days of HRV'}
          change={hrvDelta != null ? { text: `${signed(hrvDelta)} ms vs your usual`, tone: 'neutral' } : null}
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
