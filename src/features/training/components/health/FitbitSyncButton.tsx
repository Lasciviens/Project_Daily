import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../../integrations/supabase/client'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'

// Manual "Fetch now" for the Google Health (Fitbit Air) poller — invokes the
// google-health-sync edge function with the signed-in user's JWT. The same
// function also runs on a ~3h schedule (cron path, shared-secret auth); this
// button exists for immediate pulls and for testing ahead of the schedule.
interface SyncResult {
  ok?: boolean
  rows?: number
  skipped_non_fitbit?: number
  error?: string
  reconnect_required?: boolean
}

export function FitbitSyncButton() {
  const qc = useQueryClient()
  const sync = useMutationWithFeedback({
    action: 'google_health_sync',
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SyncResult>('google-health-sync', {
        body: { days: 2 },
      })
      if (error) {
        // FunctionsHttpError carries the server's real JSON body in context —
        // surface it instead of the generic "non-2xx" message (real case: a
        // stale Calendar-only token produced "disallowed OAuth scope(s)" and
        // the toast said nothing useful).
        const ctx = (error as { context?: Response }).context
        const body = ctx ? await ctx.json().catch(() => null) as SyncResult | null : null
        if (body?.reconnect_required) throw new Error('Google connection required — Settings → Google → Disconnect → Connect (grant all 5 permissions)')
        if (body?.error?.includes('disallowed OAuth scope')) throw new Error('Stored token has stale permissions — Settings → Google → Disconnect → Connect and re-grant all 5 permissions')
        throw new Error(body?.error ?? error.message)
      }
      if (data?.error) {
        throw new Error(data.reconnect_required
          ? 'Google connection required — Settings → Google → Connect'
          : data.error)
      }
      return data
    },
    successMessage: 'Fitbit synced ✓',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health'] }),
  })

  return (
    <button
      type="button"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      title="Fetch Fitbit Air data now (Google Health API)"
      className="min-h-[44px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors press-feedback disabled:opacity-50"
    >
      <span className={sync.isPending ? 'animate-spin' : ''}>⟳</span>
      Fitbit
    </button>
  )
}
