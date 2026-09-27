import { supabase } from '../../../integrations/supabase/client'

// Smart-scale "body composition analysis report" scans, imported via
// phone-gateway's import_body_composition action (migration 085) — see
// CLAUDE.md's iPhone surface section. Read-only from the web app: nothing
// here ever inserts/updates a row, the gateway is the only writer (and it
// never updates one either — rows are immutable once written).
//
// A SEPARATE source from hevy_body_measurements (Hevy app) and health_metrics
// (Apple Health / Health Auto Export) — per CLAUDE.md's explicit rule, never
// merge or join across the three; this file only ever reads its own table.
export interface BodyCompositionReport {
  id:                       string
  measured_at:              string // timestamptz — the real reading instant
  weight_kg:                number
  body_fat_percent:         number
  body_fat_mass_kg:         number
  lean_body_mass_kg:        number
  body_water_percent:       number
  protein_percent:          number
  muscle_percent:           number
  skeletal_muscle_percent:  number
  skeletal_muscle_index:    number
  bmi:                      number
  visceral_fat_index:       number
  subcutaneous_fat_kg:      number
  bmr_kcal:                 number
  body_score:               number
  source:                   string
  created_at:               string
}

// Migration 085 may not be applied yet (this repo's migrations are always
// manual, applied well after the code that reads them ships) — degrade to an
// empty list rather than breaking the Body tab, same guard as
// wishesApi.ts/waterApi.ts use for their own not-yet-migrated tables.
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

// PostgREST caps any single response at 1000 rows server-side regardless of
// an explicit .limit() (AGENTS.md's mandatory-pagination rule) — a daily
// scan habit crosses that in under 3 years, so this paginates like
// fetchHealthMetricSeries rather than assuming "there can't be that many".
const PAGE_SIZE = 1000

export async function fetchBodyCompositionReports(): Promise<BodyCompositionReport[]> {
  const all: BodyCompositionReport[] = []
  let offset = 0

  for (;;) {
    const { data, error } = await supabase
      .from('body_composition_reports')
      .select('*')
      .order('measured_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      if (isMissingTable(error)) return []
      throw error
    }
    const page = (data ?? []) as BodyCompositionReport[]
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}
