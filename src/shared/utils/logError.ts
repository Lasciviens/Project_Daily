import { supabase } from '../../integrations/supabase/client'

export async function logError(message: string, context?: Record<string, unknown>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Insert new log entry and clean up entries older than 2 days in one go
    await Promise.all([
      supabase.from('app_error_logs').insert({
        user_id: user.id,
        message,
        context: context ?? null,
      }),
      supabase
        .from('app_error_logs')
        .delete()
        .eq('user_id', user.id)
        .lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()),
    ])
  } catch {
    // logError must never throw — it's a best-effort side effect
  }
}
