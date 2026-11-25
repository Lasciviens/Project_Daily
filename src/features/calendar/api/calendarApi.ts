import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'

// The one Google sign-in (calendar-oauth / calendar-token / calendar-disconnect keep their names; since Google
// Calendar went, 25.11.2026, the sign-in serves Google Tasks only — GOOGLE_SCOPES in ../googleScopes.ts). Every
// function takes the client as a parameter, so this file stays free of the live singletons.

export async function exchangeCalendarCode(
  supabase: SupabaseClient,
  code: string
): Promise<{ access_token: string; expires_in: number }> {
  const { data, error } = await supabase.functions.invoke('calendar-oauth', {
    body: { code },
  })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new Error((body?.error as string | undefined) ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as { access_token: string; expires_in: number }
}

export async function refreshCalendarToken(
  supabase: SupabaseClient
): Promise<{ access_token: string; expires_in: number }> {
  const { data, error } = await supabase.functions.invoke('calendar-token', {
    body: {},
  })
  if (error) throw new Error(error.message)
  if (data.error) throw new Error(data.error)
  return data as { access_token: string; expires_in: number }
}

export async function disconnectCalendar(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.functions.invoke('calendar-disconnect', {
    body: {},
  })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new Error((body?.error as string | undefined) ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
}
