// "Your path" — one headline and a few concrete steps from the pace, the fat
// vs muscle split and protein, read through the chosen phase. Pure
// (scripts/verify-body-goal.cjs). Never a diagnosis: each line says what the
// numbers show and the usual fix.

import { PHASE_TARGET, type CompositionResult, type CompositionVerdict, type Phase, type RateVerdict, type Tone } from './bodyGoal'
import type { EnergyReport } from './energyBalance'

export type StepKey = 'calories' | 'protein' | 'training' | 'data' | 'early' | 'keep'
export interface PathStep { key: StepKey; text: string }
export interface GoalPath { title: string; tone: Tone; summary: string[]; steps: PathStep[] }

export interface PathInputs {
  phase: Phase
  rate: RateVerdict | null
  comp: CompositionResult
  energy: EnergyReport
  /** Current trend weight, for protein grams. */
  weightKg: number | null
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const pctAbs = (v: number) => `${Math.abs(v).toFixed(2).replace(/0$/, '')} %`
const fmtKg = (v: number) => `${Math.abs(v).toFixed(2).replace(/0$/, '')} kg`
const LEAN_LOSS: CompositionVerdict[] = ['losing_lean', 'fat_loss_some_lean', 'fat_gain_lean_loss']

export const PHASE_RANGE_LABEL: Record<Phase, string> = {
  cut: '0.5–1 % of bodyweight a week',
  maintain: 'within ±0.25 % a week',
  gain: '0.25–0.5 % of bodyweight a week',
}

export const COMPOSITION_SENTENCE: Record<CompositionVerdict, string> = {
  recomp: 'Fat is going down and lean mass is going up — recomposition.',
  fat_loss_lean_kept: 'Fat is going down and lean mass is holding — the change you want from a cut.',
  fat_loss_some_lean: 'Fat is going down, but some lean mass (mostly muscle and water) is going with it.',
  losing_lean: 'Lean mass is dropping faster than fat — muscle is at risk.',
  lean_gain: 'Lean mass is going up while fat holds — the change you want from a gain.',
  lean_gain_some_fat: 'Mostly lean mass is going up, with some fat — normal for a gain.',
  mostly_fat_gain: 'Most of the change is fat.',
  fat_gain_lean_loss: 'Fat is going up while lean mass goes down.',
  stable: 'Neither fat nor lean mass moved more than the scale\'s noise.',
  not_enough_data: 'Not enough smart-scale readings yet to tell fat from muscle.',
}

function headline(phase: Phase, rate: RateVerdict | null, v: CompositionVerdict): { title: string; tone: Tone } {
  const r = rate?.status ?? null
  const keeping = v === 'fat_loss_lean_kept' || v === 'recomp'
  if (phase === 'cut') {
    if (v === 'losing_lean') return { title: 'Losing muscle faster than fat', tone: 'danger' }
    if (v === 'fat_gain_lean_loss') return { title: 'Gaining fat and losing muscle', tone: 'danger' }
    if (r === 'way_too_fast') return { title: 'Too fast — muscle is at risk', tone: 'danger' }
    if (r === 'too_fast') return keeping ? { title: 'Fast, but muscle is holding so far', tone: 'warn' } : { title: 'A bit fast — slow down to protect muscle', tone: 'warn' }
    if (v === 'fat_loss_some_lean') return { title: 'Losing fat and some muscle', tone: 'warn' }
    if (r === 'wrong_way') return { title: 'Weight is going up, not down', tone: 'warn' }
    if (v === 'mostly_fat_gain' || v === 'lean_gain_some_fat') return { title: 'Fat is going up, not down', tone: 'warn' }
    if (v === 'recomp') return { title: 'Recomposition: fat down, muscle up', tone: 'success' }
    if (r === 'on_track') return v === 'fat_loss_lean_kept' ? { title: 'On track: losing fat, keeping muscle', tone: 'success' } : { title: 'Right pace for a cut', tone: 'success' }
    if (r === 'too_slow') return v === 'fat_loss_lean_kept' ? { title: 'Losing fat, keeping muscle — you can speed up', tone: 'info' } : { title: 'Slow — you can speed up', tone: 'info' }
  } else if (phase === 'gain') {
    if (v === 'fat_gain_lean_loss') return { title: 'Gaining fat and losing muscle', tone: 'danger' }
    if (v === 'mostly_fat_gain') return { title: 'Gaining mostly fat', tone: 'warn' }
    if (r === 'way_too_fast') return { title: 'Too fast — most of the extra is fat', tone: 'warn' }
    if (r === 'too_fast') return { title: 'A bit fast — more of the gain will be fat', tone: 'warn' }
    if (r === 'wrong_way') return { title: 'Weight is going down, not up', tone: 'warn' }
    if (v === 'losing_lean') return { title: 'Losing muscle', tone: 'warn' }
    if (v === 'recomp') return { title: 'Recomposition: fat down, muscle up', tone: 'success' }
    if (r === 'on_track') return v === 'lean_gain' || v === 'lean_gain_some_fat' ? { title: 'On track: gaining lean mass', tone: 'success' } : { title: 'Right pace for a lean gain', tone: 'success' }
    if (r === 'too_slow') return v === 'lean_gain' ? { title: 'Gaining lean mass — room to go a bit faster', tone: 'info' } : { title: 'Slow — you can add a little', tone: 'info' }
  } else {
    if (v === 'fat_gain_lean_loss') return { title: 'Gaining fat and losing muscle', tone: 'danger' }
    if (v === 'losing_lean') return { title: 'Losing muscle', tone: 'warn' }
    if (v === 'mostly_fat_gain') return { title: 'Fat is creeping up', tone: 'warn' }
    if (v === 'recomp') return { title: 'Recomposition at maintenance: fat down, muscle up', tone: 'success' }
    if (r === 'drifting_down') return { title: 'Drifting down', tone: 'info' }
    if (r === 'drifting_up') return { title: 'Drifting up', tone: 'info' }
    if (r === 'stable') return { title: 'Holding steady', tone: 'success' }
  }
  if (v !== 'not_enough_data') return { title: COMPOSITION_TITLE[v], tone: 'neutral' }
  return { title: 'Not enough data for a verdict yet', tone: 'neutral' }
}

const COMPOSITION_TITLE: Record<CompositionVerdict, string> = {
  recomp: 'Fat down, muscle up', fat_loss_lean_kept: 'Losing fat, keeping muscle', fat_loss_some_lean: 'Losing fat and some muscle',
  losing_lean: 'Losing muscle', lean_gain: 'Gaining lean mass', lean_gain_some_fat: 'Gaining lean mass and some fat',
  mostly_fat_gain: 'Gaining mostly fat', fat_gain_lean_loss: 'Gaining fat, losing muscle', stable: 'Body composition steady',
  not_enough_data: 'Not enough data',
}

/** "Losing 0.62 kg a week (0.74 % of bodyweight) — inside the 0.5–1 % range." */
export function paceSentence(phase: Phase, rate: RateVerdict): string {
  const verb = rate.kgPerWeek < 0 ? 'Losing' : rate.kgPerWeek > 0 ? 'Gaining' : 'Holding at'
  const where = rate.status === 'on_track' || rate.status === 'stable' ? 'inside'
    : rate.status === 'too_slow' ? 'slower than' : rate.status === 'wrong_way' ? 'the opposite way to' : rate.status === 'drifting_down' ? 'below'
    : rate.status === 'drifting_up' ? 'above' : 'faster than'
  const lean = phase === 'cut' && (rate.status === 'on_track' || rate.status === 'too_fast') ? ' The leaner you are, the closer to 0.5 % you should stay.' : ''
  return `${verb} ${fmtKg(rate.kgPerWeek)} a week (${pctAbs(rate.pctPerWeek)} of bodyweight) — ${where} the ${PHASE_RANGE_LABEL[phase]} range.${lean}`
}

const LEAD: Partial<Record<RateVerdict['status'], Record<Phase, string>>> = {
  too_slow: { cut: 'To speed up', gain: 'To gain a bit faster', maintain: '' },
  too_fast: { cut: 'To slow down and protect muscle', gain: 'To keep the gain lean', maintain: '' },
  way_too_fast: { cut: 'To slow down and protect muscle', gain: 'To keep the gain lean', maintain: '' },
  wrong_way: { cut: 'To start losing', gain: 'To start gaining', maintain: '' },
  drifting_down: { cut: '', gain: '', maintain: 'To hold steady' },
  drifting_up: { cut: '', gain: '', maintain: 'To hold steady' },
}

function calorieStep(phase: Phase, rate: RateVerdict): PathStep | null {
  if (rate.adjustKcal == null) return null
  const lead = LEAD[rate.status]?.[phase] || 'To reach the range'
  const more = rate.adjustKcal > 0
  const target = phase === 'maintain' ? 'a steady weight' : `about ${pctAbs(PHASE_TARGET[phase].mid)} a week (${fmtKg(rate.targetKgPerWeek)})`
  const intake = rate.suggestedIntake != null ? ` — around ${n0(rate.suggestedIntake)} kcal logged a day` : ''
  return { key: 'calories', text: `${lead}: eat about ${n0(Math.abs(rate.adjustKcal))} kcal a day ${more ? 'more' : 'less'}${intake}, aiming at ${target}.` }
}

export function buildPath({ phase, rate, comp, energy, weightKg }: PathInputs): GoalPath {
  const { title, tone } = headline(phase, rate, comp.verdict)
  const summary: string[] = []
  if (rate) summary.push(paceSentence(phase, rate))
  if (comp.verdict !== 'not_enough_data') summary.push(COMPOSITION_SENTENCE[comp.verdict])

  const steps: PathStep[] = []
  const cal = rate ? calorieStep(phase, rate) : null
  if (cal) steps.push(cal)
  else if (phase === 'gain' && comp.verdict === 'mostly_fat_gain') {
    steps.push({ key: 'calories', text: 'Trim the surplus by about 100–200 kcal a day and aim for the low end of the range (0.25 % a week).' })
  }

  const leanLoss = LEAN_LOSS.includes(comp.verdict)
  const p = energy.protein
  if (weightKg && p.gPerKg != null && p.band === 'below_floor') {
    const upper = phase === 'cut' || leanLoss ? `, up to ${n0(weightKg * 2.2)} g` : ''
    steps.push({ key: 'protein', text: `Raise protein to at least ${n0(weightKg * 1.6)} g a day (1.6 g per kg)${upper} — you average ${n0(energy.intake.meanProteinG ?? 0)} g (${p.gPerKg.toFixed(1)} g/kg).` })
  } else if (weightKg && p.gPerKg != null && leanLoss && p.gPerKg < 2.2) {
    steps.push({ key: 'protein', text: `Push protein toward 2.2 g per kg (about ${n0(weightKg * 2.2)} g a day) — you average ${p.gPerKg.toFixed(1)} g/kg.` })
  } else if (p.gPerKg == null && (phase !== 'maintain' || leanLoss)) {
    steps.push({ key: 'protein', text: 'Log your food to check protein — aim for 1.6–2.2 g per kg of bodyweight a day.' })
  }

  if (phase === 'cut' || leanLoss) {
    steps.push({ key: 'training', text: leanLoss || rate?.status === 'too_fast' || rate?.status === 'way_too_fast'
      ? 'Keep lifting heavy — hard training is what tells your body to hold on to muscle in a deficit.'
      : 'Keep your training heavy while you cut — it is what keeps the muscle.' })
  } else if (phase === 'gain') {
    steps.push({ key: 'training', text: 'Keep adding load or reps over time — a surplus only builds muscle when training asks for it.' })
  }

  if (energy.earlyPhase) {
    steps.push({ key: 'early', text: phase === 'gain'
      ? 'First two weeks of the gain: part of the rise is glycogen and water, so the pace looks faster than the tissue you are adding.'
      : 'First three weeks of the cut: part of the drop is glycogen and water, so the pace looks faster than the fat you are losing.' })
  }
  if (!rate) steps.push({ key: 'data', text: 'Weigh in at least 4 times over a week to see your pace.' })
  if (comp.verdict === 'not_enough_data') {
    steps.push({ key: 'data', text: `${comp.missing ?? ''} Weigh in on the smart scale most mornings — same time, after the toilet, before food or drink — so it can separate fat from muscle.`.trim() })
  }
  if (tone === 'success' && !steps.some(s => s.key === 'calories' || s.key === 'protein')) {
    steps.unshift({ key: 'keep', text: 'Keep doing what you are doing — this is the pace and the change to aim for.' })
  }
  return { title, tone, summary, steps }
}
