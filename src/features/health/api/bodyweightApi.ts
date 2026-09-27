import { supabase } from '../../../integrations/supabase/client'
import { localDayOf } from '../../../shared/utils/dateUtils'
import { computeDailySeries } from '../healthAggregate'
import { mergeBodyweight, type BodyweightPoint, type BodyweightReading } from '../bodyweight'
import { fetchHealthMetricSeries, fetchLatestHealthValue } from './healthApi'

// Reads for the ONE bodyweight series (see bodyweight.ts for the precedence
// and why). Three tables, each read on its own and never joined in SQL:
//   hevy_body_measurements   — weights typed into Hevy (date column)
//   body_composition_reports — smart-scale scans (measured_at instant)
//   health_metrics           — Apple Health weight_body_mass / body_fat_percentage

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
    .select('date, weight_kg, fat_percent, updated_at')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { date: string; weight_kg: unknown; fat_percent: unknown; updated_at: string | null }[])
    .map(r => ({ date: r.date, at: r.updated_at ?? `${r.date}T12:00:00Z`, kg: num(r.weight_kg), fatPct: num(r.fat_percent) }))
}

async function readScale(from: string, to: string): Promise<BodyweightReading[]> {
  const { data, error } = await supabase
    .from('body_composition_reports')
    .select('measured_at, weight_kg, body_fat_percent')
    .gte('measured_at', localMidnightIso(from))
    .lt('measured_at', localMidnightIso(to, 1))
    .order('measured_at', { ascending: true })
  if (error) {
    // Migration 085 may not be applied: no scale readings rather than no series.
    if (isMissingTable(error)) return []
    throw error
  }
  return ((data ?? []) as { measured_at: string; weight_kg: unknown; body_fat_percent: unknown }[])
    .map(r => ({ date: localDayOf(r.measured_at) ?? r.measured_at.slice(0, 10), at: r.measured_at, kg: num(r.weight_kg), fatPct: num(r.body_fat_percent) }))
}

async function readApple(from: string, to: string): Promise<BodyweightReading[]> {
  const [weightPts, fatPts] = await Promise.all([
    fetchHealthMetricSeries('weight_body_mass', from, to),
    fetchHealthMetricSeries('body_fat_percentage', from, to),
  ])
  const byDate = new Map<string, BodyweightReading>()
  for (const d of computeDailySeries('weight_body_mass', weightPts)) {
    byDate.set(d.date, { date: d.date, at: `${d.date}T12:00:00Z`, kg: d.value, fatPct: null })
  }
  for (const d of computeDailySeries('body_fat_percentage', fatPts)) {
    // Apple stores body fat either as a fraction (0.18) or a percentage (18).
    const pct = d.value <= 1 ? d.value * 100 : d.value
    const cur = byDate.get(d.date) ?? { date: d.date, at: `${d.date}T12:00:00Z`, kg: null, fatPct: null }
    cur.fatPct = pct
    byDate.set(d.date, cur)
  }
  return [...byDate.values()]
}

/** Every day in [from, to] with a weight, one point per day, tagged with the
 *  source that won the day. */
export async function fetchBodyweightSeries(from: string, to: string): Promise<BodyweightPoint[]> {
  const [hevy, scale, apple] = await Promise.all([readHevy(from, to), readScale(from, to), readApple(from, to)])
  return mergeBodyweight({ hevy, scale, apple }, { from, to })
}

/** The newest merged weight on or before `onOrBefore` (default: ever). Each
 *  source's newest day is read with a limit-1 query, then the newest DAY
 *  wins; the source precedence only settles a same-day tie. */
export async function fetchLatestBodyweight(onOrBefore?: string): Promise<BodyweightPoint | null> {
  let hevyQ = supabase.from('hevy_body_measurements').select('date').not('weight_kg', 'is', null)
  if (onOrBefore) hevyQ = hevyQ.lte('date', onOrBefore)
  let scaleQ = supabase.from('body_composition_reports').select('measured_at')
  if (onOrBefore) scaleQ = scaleQ.lt('measured_at', localMidnightIso(onOrBefore, 1))

  const [hevyRes, scaleRes, apple] = await Promise.all([
    hevyQ.order('date', { ascending: false }).limit(1),
    scaleQ.order('measured_at', { ascending: false }).limit(1),
    fetchLatestHealthValue('weight_body_mass', onOrBefore),
  ])
  if (hevyRes.error) throw hevyRes.error
  if (scaleRes.error && !isMissingTable(scaleRes.error)) throw scaleRes.error

  const candidates: string[] = []
  const hevyDate = (hevyRes.data?.[0] as { date?: string } | undefined)?.date
  if (hevyDate) candidates.push(hevyDate)
  const scaleAt = scaleRes.error ? undefined : (scaleRes.data?.[0] as { measured_at?: string } | undefined)?.measured_at
  const scaleDate = localDayOf(scaleAt)
  if (scaleDate) candidates.push(scaleDate)
  if (apple) candidates.push(apple.date)
  if (!candidates.length) return null

  // Read that one day from every source so precedence (and fat %) apply.
  const newest = candidates.sort().at(-1) as string
  const day = await fetchBodyweightSeries(newest, newest)
  return day.at(-1) ?? null
}
