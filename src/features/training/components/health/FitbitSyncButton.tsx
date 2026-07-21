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
      if (error) throw new Error(error.message)
      if (data?.error) {
        throw new Error(data.reconnect_required
          ? 'Google bağlantısı gerekli — Ayarlar → Google → Connect'
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
      title="Fitbit Air verisini şimdi çek (Google Health API)"
      className="min-h-[44px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors press-feedback disabled:opacity-50"
    >
      <span className={sync.isPending ? 'animate-spin' : ''}>⟳</span>
      Fitbit
    </button>
  )
}
