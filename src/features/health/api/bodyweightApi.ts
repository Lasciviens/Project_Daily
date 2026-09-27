import { supabase } from '../../../integrations/supabase/client'
import { localDayOf } from '../../../shared/utils/dateUtils'
import {
  APPLE_BODY_METRICS, mergeBodyweight, splitAppleBodyRows, type BodyweightPoint, type BodyweightReading,
} from '../bodyweight'
import { fetchHealthMetricsBatch, fetchLatestHealthValue } from './healthApi'

// Reads for the ONE bodyweight series (see bodyweight.ts for the precedence
// and why). Three tables, each read on its own and never joined in SQL:
//   health_metrics           — the smart scale via Apple Health (weight, body
//                              fat %, lean mass), minus rows Hevy wrote there
//   body_composition_reports — the scale's photo-imported reports
//   hevy_body_measurements   — weights typed into Hevy (date column)

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

// numeric columns normally arrive as JSON numbers; coerce defensively so a
// string never silently fails the kg sanity guard.
function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// The local day a date string starts on, as an instant (measured_at is a
// timestamptz; `date` columns are local days already).
function localMidnightIso(date: string, addDays = 0): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d + addDays).toISOString()
}

async function readHevy(from: string, to: string): Promise<BodyweightReading[]> {
  const { data, error } = await supabase
    .from('hevy_body_measurements')
    .select('date, weight_kg, fat_percent, lean_mass_kg, updated_at')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { date: string; weight_kg: unknown; fat_percent: unknown; lean_mass_kg: unknown; updated_at: string | null }[])
    .map(r => ({ date: r.date, at: r.updated_at ?? `${r.date}T12:00:00Z`, kg: num(r.weight_kg), fatPct: num(r.fat_percent), leanKg: num(r.lean_mass_kg) }))
}

async function readReport(from: string, to: string): Promise<BodyweightReading[]> {
  const { data, error } = await supabase
    .from('body_composition_reports')
    .select('measured_at, weight_kg, body_fat_percent, lean_body_mass_kg')
    .gte('measured_at', localMidnightIso(from))
    .lt('measured_at', localMidnightIso(to, 1))
    .order('measured_at', { ascending: true })
  if (error) {
    // Migration 085 may not be applied: no report readings rather than no series.
    if (isMissingTable(error)) return []
    throw error
  }
  return ((data ?? []) as { measured_at: string; weight_kg: unknown; body_fat_percent: unknown; lean_body_mass_kg: unknown }[])
    .map(r => ({
      date: localDayOf(r.measured_at) ?? r.measured_at.slice(0, 10), at: r.measured_at,
      kg: num(r.weight_kg), fatPct: num(r.body_fat_percent), leanKg: num(r.lean_body_mass_kg),
    }))
}

// One request for all three metrics; every row keeps its own instant and
// source, so the split can tell the scale's rows from ones Hevy wrote.
async function readApple(from: string, to: string): Promise<{ scale: BodyweightReading[]; hevy: BodyweightReading[] }> {
  const byMetric = await fetchHealthMetricsBatch(APPLE_BODY_METRICS, from, to)
  const rows = Object.values(byMetric).flat().map(r => ({
    metric: r.metric_name, date: r.date, at: r.recorded_at, source: r.source,
    qty: typeof r.value?.qty === 'number' ? r.value.qty : null,
  }))
  return splitAppleBodyRows(rows)
}

/** Every day in [from, to] with a weight, one point per day, tagged with the
 *  source that won the day. */
export async function fetchBodyweightSeries(from: string, to: string): Promise<BodyweightPoint[]> {
  const [hevy, report, apple] = await Promise.all([readHevy(from, to), readReport(from, to), readApple(from, to)])
  return mergeBodyweight({ scale: apple.scale, report, hevy: [...hevy, ...apple.hevy] }, { from, to })
}

/** The newest merged weight on or before `onOrBefore` (default: ever). Each
 *  source's newest day is read with a limit-1 query, then the newest DAY
 *  wins; the source precedence only settles a same-day tie. */
export async function fetchLatestBodyweight(onOrBefore?: string): Promise<BodyweightPoint | null> {
  let hevyQ = supabase.from('hevy_body_measurements').select('date').not('weight_kg', 'is', null)
  if (onOrBefore) hevyQ = hevyQ.lte('date', onOrBefore)
  let reportQ = supabase.from('body_composition_reports').select('measured_at')
  if (onOrBefore) reportQ = reportQ.lt('measured_at', localMidnightIso(onOrBefore, 1))

  const [hevyRes, reportRes, apple] = await Promise.all([
    hevyQ.order('date', { ascending: false }).limit(1),
    reportQ.order('measured_at', { ascending: false }).limit(1),
    fetchLatestHealthValue('weight_body_mass', onOrBefore),
  ])
  if (hevyRes.error) throw hevyRes.error
  if (reportRes.error && !isMissingTable(reportRes.error)) throw reportRes.error

  const candidates: string[] = []
  const hevyDate = (hevyRes.data?.[0] as { date?: string } | undefined)?.date
  if (hevyDate) candidates.push(hevyDate)
  const reportAt = reportRes.error ? undefined : (reportRes.data?.[0] as { measured_at?: string } | undefined)?.measured_at
  const reportDate = localDayOf(reportAt)
  if (reportDate) candidates.push(reportDate)
  if (apple) candidates.push(apple.date)
  if (!candidates.length) return null

  // Read that one day from every source so precedence (and fat %) apply.
  const newest = candidates.sort().at(-1) as string
  const day = await fetchBodyweightSeries(newest, newest)
  return day.at(-1) ?? null
}
