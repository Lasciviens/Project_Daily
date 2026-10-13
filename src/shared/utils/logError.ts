import { supabase } from '../../integrations/supabase/client'
import { currentUserId } from './requireUser'

// Keys whose values never reach app_error_logs, at any depth (the AI can read
// that table). A raw secret passed as the whole payload is the caller's job:
// useMutationWithFeedback's `logPayload: false`.
const SECRET_KEY = /npsso|token|secret|password|passwd|api[_-]?key|authorization|refresh|code_verifier|p256dh|^auth$/i

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => redactSecrets(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) && v != null && v !== '' ? '[redacted]' : redactSecrets(v, depth + 1)
  }
  return out
}

export async function logError(message: string, context?: Record<string, unknown>): Promise<void> {
  try {
    const userId = await currentUserId()
    if (!userId) return

    // Always capture environment context so a log entry is self-contained and
    // trackable, then merge in whatever the caller passed (payloads, raw API
    // errors, ids, etc.). Kept best-effort — never throw.
    const enriched: Record<string, unknown> = {
      at:         new Date().toISOString(),
      route:      typeof location !== 'undefined' ? location.hash || location.pathname : undefined,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      ...(redactSecrets(context ?? {}) as Record<string, unknown>),
    }

    // Insert new log entry and clean up entries older than 2 days in one go
    await Promise.all([
      supabase.from('app_error_logs').insert({
        user_id: userId,
        message,
        context: enriched,
      }),
      supabase
        .from('app_error_logs')
        .delete()
        .eq('user_id', userId)
        .lt('created_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()),
    ])
  } catch {
    // logError must never throw — it's a best-effort side effect
  }
}
