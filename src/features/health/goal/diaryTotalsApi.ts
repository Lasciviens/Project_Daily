import { supabase } from '../../../integrations/supabase/client'

// Eaten diary totals over a date range, for the goal report. A narrow read
// (date + calories + protein only) instead of fetchFoodLogRange's joined rows,
// and paginated: 56 days of a detailed diary can pass PostgREST's 1,000-row cap.
// Totals are the derived eaten macros (migration 106), so they already follow
// later recipe/ingredient edits.

export interface DiaryDayRow { date: string; calories: number | null; protein_g: number | null }

const PAGE = 1000

function isMissingStatus(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /status/i.test(x?.message ?? '')
}

export async function fetchEatenDiaryRows(from: string, to: string): Promise<DiaryDayRow[]> {
  const all: DiaryDayRow[] = []
  let withStatus = true
  for (let offset = 0; ; offset += PAGE) {
    const base = supabase
      .from('food_log_entries')
      .select('date, calories, protein_g')
      .gte('date', from)
      .lte('date', to)
    // Before migration 061 every row was eaten and the column didn't exist.
    const q = withStatus ? base.eq('status', 'eaten') : base
    const { data, error } = await q.order('date', { ascending: true }).order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error && withStatus && isMissingStatus(error)) { withStatus = false; offset -= PAGE; continue }
    if (error) throw error
    const page = (data ?? []) as DiaryDayRow[]
    all.push(...page)
    if (page.length < PAGE) break
  }
  return all
}
