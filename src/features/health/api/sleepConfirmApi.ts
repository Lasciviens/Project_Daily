// The sleep nights the owner confirmed complete (migration 164): the "may be
// incomplete" note never comes back for them. Before 164 the read is empty and
// a confirm says which migration is missing (remove the fallback once 164 has
// been live for a while).
import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'

type PgError = { code?: string; message?: string } | null | undefined
const isMissingTable = (e: PgError) => e?.code === '42P01' || e?.code === 'PGRST205' || /could not find the table/i.test(e?.message ?? '')
const MISSING_164 = 'Confirming a night needs migration 164 — it runs with the next deploy.'

/** Wake days (YYYY-MM-DD) of every confirmed night. */
export async function fetchSleepConfirmations(): Promise<string[]> {
  const { data, error } = await supabase.from('sleep_night_confirmations').select('night_date').order('night_date')
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []).map(r => String((r as { night_date: string }).night_date))
}

/** Confirm a night (its wake day); confirming it twice changes nothing. */
export async function confirmSleepNight(nightDate: string): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('sleep_night_confirmations')
    .upsert({ user_id: user.id, night_date: nightDate }, { onConflict: 'user_id,night_date', ignoreDuplicates: true })
  if (error) throw isMissingTable(error) ? new Error(MISSING_164) : error
}

/** Take a confirmation back: the note can show again. */
export async function unconfirmSleepNight(nightDate: string): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('sleep_night_confirmations')
    .delete().eq('user_id', user.id).eq('night_date', nightDate)
  if (error) throw isMissingTable(error) ? new Error(MISSING_164) : error
}
