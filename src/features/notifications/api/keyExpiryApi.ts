import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { DurationUnit } from '../keyExpiry'

// The Claude API key's dates (212's integration_expiry): what the owner typed — a start day, a duration and, if
// typed, the key's last 4 characters. Never the key: the app can't read it (it is a server secret). The database
// works the end day out. Before 212 there is no table: nothing stored, and a save says the migration is missing.

export interface KeyDates {
  id: string
  starts_on: string
  duration_count: number
  duration_unit: DurationUnit
  ends_on: string
  key_hint: string | null
}

const isMissingTable = (e: { code?: string } | null) => !!e && ['42P01', 'PGRST205'].includes(e.code ?? '')
const COLUMNS = 'id, starts_on, duration_count, duration_unit, ends_on, key_hint'

function keyDatesFromRow(r: Record<string, unknown> | null): KeyDates | null {
  if (!r || typeof r.id !== 'string' || typeof r.starts_on !== 'string' || typeof r.ends_on !== 'string') return null
  if (typeof r.duration_count !== 'number' || (r.duration_unit !== 'days' && r.duration_unit !== 'months')) return null
  return {
    id: r.id, starts_on: r.starts_on, ends_on: r.ends_on, duration_count: r.duration_count, duration_unit: r.duration_unit,
    key_hint: typeof r.key_hint === 'string' ? r.key_hint : null,
  }
}

export async function fetchClaudeKeyDates(): Promise<KeyDates | null> {
  const { data, error } = await supabase.from('integration_expiry').select(COLUMNS).eq('service', 'anthropic').maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return keyDatesFromRow(data as Record<string, unknown> | null)
}

export async function saveClaudeKeyDates(input: { startsOn: string; count: number; unit: DurationUnit; keyHint: string | null }): Promise<KeyDates> {
  const user = await requireUser()
  // ends_on is the database's: the trigger replaces whatever is sent (a day is needed for the NOT NULL check).
  const { data, error } = await supabase.from('integration_expiry')
    .upsert({
      user_id: user.id, service: 'anthropic', starts_on: input.startsOn, duration_count: input.count,
      duration_unit: input.unit, ends_on: input.startsOn, key_hint: input.keyHint,
    }, { onConflict: 'user_id,service' })
    .select(COLUMNS).single()
  if (error) {
    if (isMissingTable(error)) throw new Error('The key dates need migration 212, which is not applied yet')
    throw error
  }
  const row = keyDatesFromRow(data as Record<string, unknown>)
  if (!row) throw new Error('The key dates came back in a shape the app does not know')
  return row
}
