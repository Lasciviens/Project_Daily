import type { Tone } from '../../../shared/ui'
import type { Confidence, ProteinBand, RateBand, Reason, Verdict } from './energyBalance'

// Plain-language copy for the cut report. Never a diagnosis: each line says
// what the numbers show and the most common explanation.

export const VERDICT_COPY: Record<Verdict, { title: string; tone: Tone }> = {
  on_track: { title: 'Your scale matches your numbers', tone: 'success' },
  slower: { title: 'Losing slower than your numbers say', tone: 'warn' },
  faster: { title: 'Losing faster than your numbers say', tone: 'info' },
}

export const REASON_COPY: Record<Reason, string> = {
  partial_logging: 'Some days are missing or half-logged in the diary, so the average intake is likely too low.',
  intake_underlogged: 'Most likely: the diary misses some of what you eat. Food records typically miss 19–41 % of intake — oils, sauces, snacks and portion sizes are the usual culprits.',
  apple_overestimates: 'Also common: Apple\'s energy reads high. Wrist wearables were off by ~28 % on average in a 2025 review, mostly overestimating active energy.',
  early_water: 'You are in the first three weeks of the cut. Early loss is largely glycogen and water, which weighs a lot but holds little energy — this settles down.',
  short_window: 'A 14-day window is short: a salty meal or a hard training day can move the scale by a kilo.',
  apple_underestimates: 'Apple may be reading your burn low, or the diary over-counts (rare — logging usually misses food rather than adding it).',
  intake_overlogged: 'If this lasts over several windows, check that eaten portions aren\'t logged twice.',
}

export const CONFIDENCE_COPY: Record<Confidence, { label: string; tone: Tone }> = {
  high: { label: 'High confidence', tone: 'success' },
  medium: { label: 'Medium confidence', tone: 'neutral' },
  low: { label: 'Low confidence', tone: 'warn' },
}

export const RATE_COPY: Record<RateBand, { label: string; tone: Tone; note: string }> = {
  gaining: { label: 'Gaining', tone: 'warn', note: 'The trend is going up, not down.' },
  stalled: { label: 'Barely moving', tone: 'neutral', note: 'Under 0.25 % of bodyweight a week — close to maintenance.' },
  slow: { label: 'Slow', tone: 'info', note: 'A gentle pace. Room to go faster if you want to.' },
  target: { label: 'In the sweet spot', tone: 'success', note: 'Around 0.5–1 % a week. At ~0.7 %/wk lifters in Garthe 2011 gained lean mass while cutting.' },
  fast: { label: 'Fast', tone: 'warn', note: '1–1.4 % a week. In Garthe 2011 lean mass held at ~1.4 %/wk but didn\'t grow.' },
  very_fast: { label: 'Very fast', tone: 'danger', note: 'Over 1.4 % a week — faster than the studied range; more lean mass is at risk.' },
}

export const PROTEIN_COPY: Record<ProteinBand, { label: string; tone: Tone }> = {
  below_floor: { label: 'Below 1.6 g/kg', tone: 'warn' },
  in_range: { label: '1.6–2.2 g/kg', tone: 'success' },
  high: { label: 'Above 2.2 g/kg', tone: 'success' },
}

export function signed(v: number, dp = 0, unit = ''): string {
  const s = Math.abs(v).toFixed(dp)
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${s}${unit}`
}

export function kcal(v: number | null): string {
  return v == null ? '—' : Math.round(v).toLocaleString('en-GB')
}
