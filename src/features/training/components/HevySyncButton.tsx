import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { useInitialHevySync } from '../hooks/useHevyPRs'
import { useIncrementalHevySync } from '../hooks/useHevyWorkouts'

function useLastSyncTime() {
  return useQuery({
    queryKey: ['hevy', 'sync-cursor'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data } = await supabase
        .from('hevy_workout_events_cursor')
        .select('last_events_since')
        .eq('user_id', user.id)
        .single()
      return data?.last_events_since ?? null
    },
    staleTime: 30_000,
  })
}

function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

export function HevySyncButton() {
  const initialSync = useInitialHevySync()
  const incrementalSync = useIncrementalHevySync()
  const { data: lastSyncTime } = useLastSyncTime()

  const anyPending = initialSync.isPending || incrementalSync.isPending

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => initialSync.mutate(undefined)}
          disabled={anyPending}
          className="min-h-[44px] border border-accent-400 text-accent-600 rounded-xl px-4 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-50 transition-colors"
        >
          {initialSync.isPending ? 'Syncing…' : 'Sync all'}
        </button>
        <button
          onClick={() => incrementalSync.mutate()}
          disabled={anyPending}
          className="min-h-[44px] border border-ink-200 text-ink-600 rounded-xl px-4 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink-50 transition-colors"
        >
          {incrementalSync.isPending ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <p className="text-xs text-ink-400">
        {lastSyncTime
          ? `Last synced: ${formatSyncTime(lastSyncTime)}`
          : 'Never synced — click Sync all to import your Hevy data'}
      </p>
    </div>
  )
}
