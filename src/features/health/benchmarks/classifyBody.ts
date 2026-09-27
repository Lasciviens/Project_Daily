// Body composition: body fat, BMI, waist-to-height. Pure, import-free apart
// from sibling data.
import { SRC } from './sources'
import { BODY_FAT_GALLAGHER, rowForAge } from './referenceTables'
import { adultAge, ageBandName, build, fmt, nextStep, round, sexWord } from './classifyKit'
import type { BenchmarkContext, Classification } from './types'

// ─── Body fat (Gallagher 2000) ──────────────────────────────────────────────

export function classifyBodyFat(v: number, ctx: BenchmarkContext): Classification | null {
  if (!ctx.sex) return null
  const age = adultAge(ctx.age)
  const pick = rowForAge(BODY_FAT_GALLAGHER[ctx.sex], age ?? 20)!
  const b = pick.row.data
  const band = age == null ? '20–39 (birth year not set)' : ageBandName(pick.row.min, pick.row.max, pick.clamped)
  const ace = ctx.sex === 'male' ? ' ACE, men: athletes 6–13%, fit 14–17%, average 18–24%.' : ''
  const reference =
    `${sexWord(ctx.sex)} ${band}: healthy ${b.underBelow}–${b.healthyBelow - 1}%, above ${b.overfatMax}% matches obesity (Gallagher 2000).${ace}`
  const origin =
    'These ranges come from matching healthy BMI ranges to measured body fat, so their link with health is inherited from the BMI data; they are provisional.'
  const sources = [SRC.gallagher2000, SRC.ace]
  if (v < b.underBelow) {
    return build('body_fat_percentage', { band: 'under', label: 'Below the healthy range', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('body_fat_percentage', `${b.underBelow}% or more`, b.underBelow, v),
      meaning: ctx.sex === 'male'
        ? `Below Gallagher's healthy line. ACE puts essential fat for men at 2–5% and calls under 6% potentially dangerous. ${origin}`
        : `Below Gallagher's healthy line. ${origin}`,
    })
  }
  if (v < b.healthyBelow) {
    return build('body_fat_percentage', { band: 'healthy', label: 'Healthy range', tone: 'success' }, {
      referenceText: reference, sources, meaning: origin,
    })
  }
  if (v <= b.overfatMax) {
    return build('body_fat_percentage', { band: 'overfat', label: 'Above the healthy range', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('body_fat_percentage', `Healthy range (under ${b.healthyBelow}%)`, b.healthyBelow - 0.1, v),
      meaning: `This range matches BMI 25–30 in the reference sample. ${origin}`,
    })
  }
  return build('body_fat_percentage', { band: 'obese', label: 'Obesity range', tone: 'danger' }, {
    referenceText: reference, sources,
    nextStep: nextStep('body_fat_percentage', `${b.overfatMax}% or less`, b.overfatMax, v),
    meaning: `This range matches BMI 30+ in the reference sample. ${origin}`,
  })
}

// ─── BMI ────────────────────────────────────────────────────────────────────

export function computeBmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null
  const m = heightCm / 100
  return round(weightKg / (m * m), 1)
}

export function classifyBmi(v: number, ctx: BenchmarkContext): Classification {
  const reference =
    'Adults: lowest mortality at BMI 20–25 (Global BMI Mortality Collaboration 2016); overweight 25–29.9, obesity 30+ (NICE). Lower lines (23 / 27.5) apply to some ethnic groups.'
  const muscle = 'BMI can’t tell muscle from fat — for a muscular person waist-to-height is the better check (NICE).'
  const hr = (x: string) => `Mortality in never-smokers was ${x} that at BMI 22.5–25 (Global BMI Mortality Collaboration 2016). ${muscle}`
  const h = ctx.heightCm && ctx.heightCm > 0 ? ctx.heightCm / 100 : null
  const kgAt = (bmi: number) => (h ? ` (about ${fmt(bmi * h * h)} kg at your height)` : '')
  const sources = [SRC.gbmc2016, SRC.nice246]
  if (v < 18.5) {
    return build('bmi', { band: 'underweight', label: 'Underweight', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('bmi', `BMI 18.5${kgAt(18.5)}`, 18.5, v),
      meaning: hr('about 1.5×'),
    })
  }
  if (v < 20) {
    return build('bmi', { band: 'low_normal', label: 'Low-normal', tone: 'neutral' }, {
      referenceText: reference, sources, meaning: hr('about 13% above'),
    })
  }
  if (v < 25) {
    return build('bmi', { band: 'healthy', label: 'Healthy weight', tone: 'success' }, {
      referenceText: reference, sources,
      meaning: `This is the range with the lowest mortality in 3.95 million never-smokers. ${muscle}`,
    })
  }
  const above = nextStep('bmi', `BMI under 25${kgAt(24.9)}`, 24.9, v)
  if (v < 27.5) {
    return build('bmi', { band: 'overweight_low', label: 'Overweight (lower half)', tone: 'warn' }, {
      referenceText: reference, sources, nextStep: above, meaning: hr('about 7% above'),
    })
  }
  if (v < 30) {
    return build('bmi', { band: 'overweight_high', label: 'Overweight (upper half)', tone: 'warn' }, {
      referenceText: reference, sources, nextStep: above, meaning: hr('about 20% above'),
    })
  }
  const toOverweight = nextStep('bmi', `BMI under 30${kgAt(29.9)}`, 29.9, v)
  if (v < 35) {
    return build('bmi', { band: 'obesity_1', label: 'Obesity class 1', tone: 'danger' }, {
      referenceText: reference, sources, nextStep: toOverweight, meaning: hr('about 45% above'),
    })
  }
  if (v < 40) {
    return build('bmi', { band: 'obesity_2', label: 'Obesity class 2', tone: 'danger' }, {
      referenceText: reference, sources, nextStep: nextStep('bmi', `BMI under 35${kgAt(34.9)}`, 34.9, v), meaning: hr('about 1.9×'),
    })
  }
  return build('bmi', { band: 'obesity_3', label: 'Obesity class 3', tone: 'danger' }, {
    referenceText: reference, sources, nextStep: nextStep('bmi', `BMI under 40${kgAt(39.9)}`, 39.9, v), meaning: hr('about 2.8×'),
  })
}

// ─── Waist-to-height (NICE) ─────────────────────────────────────────────────

export function computeWaistToHeight(waistCm: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!waistCm || !heightCm || waistCm <= 0 || heightCm <= 0) return null
  return round(waistCm / heightCm, 2)
}

export function classifyWaistToHeight(v: number, ctx: BenchmarkContext): Classification {
  const who = ctx.sex === 'male'
    ? ' WHO waist, men: over 94 cm raised risk, over 102 cm substantially raised.'
    : ctx.sex === 'female' ? ' WHO waist, women: over 80 cm raised risk, over 88 cm substantially raised.' : ''
  const reference =
    `NICE: 0.40–0.49 healthy, 0.50–0.59 increased risk, 0.60 or more high risk. Measure midway between the lowest rib and the top of the hip, after breathing out.${who}`
  const evidence =
    'Waist-to-height picked out high blood pressure, type 2 diabetes, unhealthy blood fats and cardiovascular disease better than waist size or BMI (Ashwell 2012); NICE uses it for adults with BMI under 35, muscular ones included.'
  const h = ctx.heightCm && ctx.heightCm > 0 ? ctx.heightCm : null
  const waistAt = (ratio: number) => (h ? ` (waist under ${fmt(ratio * h)} cm at your height)` : '')
  const sources = [SRC.nice246, SRC.ashwell2012, SRC.who2008Waist]
  if (v < 0.4) {
    return build('waist_to_height', { band: 'below_range', label: 'Below 0.40', tone: 'neutral' }, {
      referenceText: reference, sources, meaning: `NICE's healthy range starts at 0.40; below it usually just means a slim build. ${evidence}`,
    })
  }
  if (v < 0.5) {
    return build('waist_to_height', { band: 'healthy', label: 'Healthy', tone: 'success' }, { referenceText: reference, sources, meaning: evidence })
  }
  if (v < 0.6) {
    return build('waist_to_height', { band: 'increased', label: 'Increased risk', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('waist_to_height', `Under 0.50${waistAt(0.5)}`, 0.49, v),
      meaning: `NICE links this range with higher risk of type 2 diabetes, high blood pressure and cardiovascular disease. ${evidence}`,
    })
  }
  return build('waist_to_height', { band: 'high', label: 'High risk', tone: 'danger' }, {
    referenceText: reference, sources,
    nextStep: nextStep('waist_to_height', `Under 0.60${waistAt(0.6)}`, 0.59, v),
    meaning: `NICE links this range with a further increase in cardiometabolic risk. ${evidence}`,
  })
}
