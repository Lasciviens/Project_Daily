import { supabase } from '../../integrations/supabase/client'

export async function logError(message: string, context?: Record<string, unknown>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Always capture environment context so a log entry is self-contained and
    // trackable, then merge in whatever the caller passed (payloads, raw API
    // errors, ids, etc.). Kept best-effort — never throw.
    const enriched: Record<string, unknown> = {
      at:         new Date().toISOString(),
      route:      typeof location !== 'undefined' ? location.hash || location.pathname : undefined,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      ...(context ?? {}),
    }

    // Insert new log entry and clean up entries older than 2 days in one go
    await Promise.all([
      supabase.from('app_error_logs').insert({
        user_id: user.id,
        message,
        context: enriched,
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
