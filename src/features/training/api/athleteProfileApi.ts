import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  AthleteProfile,
  UpsertAthleteProfileInput,
  AthleteLimitation,
  CreateLimitationInput,
  UpdateLimitationInput,
} from '../types.athlete'

// athlete_profile / athlete_limitations (migration 070) may not be applied
// yet — same guard convention as waterApi.ts / wishesApi.ts. A missing-table
// READ degrades to a safe empty value so no surface breaks on an un-migrated
// DB. A missing-table WRITE, by contrast, must NOT be a silent no-op — that
// would look exactly like data loss — so it throws a message naming the
// missing migration.

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

const NOT_MIGRATED =
  'Athlete profile is not available yet — migration 070 (athlete_profile / athlete_limitations) has not been applied.'

export async function fetchAthleteProfile(): Promise<AthleteProfile | null> {
  const { data, error } = await supabase.from('athlete_profile').select('*').maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  return data
}

export async function upsertAthleteProfile(input: UpsertAthleteProfileInput): Promise<AthleteProfile> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('athlete_profile')
    .upsert({ user_id: user.id, ...input }, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function fetchAthleteLimitations(activeOnly = false): Promise<AthleteLimitation[]> {
  let query = supabase.from('athlete_limitations').select('*').order('created_at', { ascending: false })
  if (activeOnly) query = query.eq('active', true)
  const { data, error } = await query
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return data ?? []
}

export async function createAthleteLimitation(input: CreateLimitationInput): Promise<AthleteLimitation> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('athlete_limitations')
    .insert({
      user_id:          user.id,
      movement_pattern: input.movement_pattern,
      severity:         input.severity ?? 'monitor',
      note:             input.note ?? null,
    })
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function updateAthleteLimitation(id: string, patch: UpdateLimitationInput): Promise<AthleteLimitation> {
  const { data, error } = await supabase
    .from('athlete_limitations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
  return data
}

export async function deleteAthleteLimitation(id: string): Promise<void> {
  const { error } = await supabase.from('athlete_limitations').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED) : error
}
