import { supabase } from '../../../integrations/supabase/client'

// water_log_entries (migration 067) is its own table — water is never counted in
// the nutrition calorie ring. Daily total = SUM(amount_ml) for the date. Every
// path guards a missing table (pre-067) so the nutrition surfaces never break on
// an un-migrated DB — water simply reads as 0 until the migration is applied.

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

export async function fetchWaterMl(date: string): Promise<number> {
  const { data, error } = await supabase
    .from('water_log_entries')
    .select('amount_ml')
    .eq('date', date)
  if (error) {
    if (isMissingTable(error)) return 0
    throw error
  }
  return (data ?? []).reduce((sum, r) => sum + (r.amount_ml ?? 0), 0)
}

export async function addWaterMl(date: string, amount_ml: number): Promise<void> {
  const { error } = await supabase.from('water_log_entries').insert({ date, amount_ml })
  if (error) throw error
}

// Undo = delete the most recently logged amount for the date (matches how the
// user thinks about it — "oops, take that last one back").
export async function undoLastWaterMl(date: string): Promise<void> {
  const { data, error } = await supabase
    .from('water_log_entries')
    .select('id')
    .eq('date', date)
    .order('logged_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const id = data?.[0]?.id
  if (!id) return
  const { error: delErr } = await supabase.from('water_log_entries').delete().eq('id', id)
  if (delErr) throw delErr
}
