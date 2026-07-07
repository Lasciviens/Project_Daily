import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../integrations/supabase/client'
import { useInitialHevySync } from '../hooks/useHevyPRs'
import { useIncrementalHevySync } from '../hooks/useHevyWorkouts'
import { formatTrainingTime } from '../dateFormat'

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
        .maybeSingle()
      return data?.last_events_since ?? null
    },
    staleTime: 30_000,
  })
}

// Deliberately numeric DD/MM/YYYY (not the "12 Aug 2024" style used
// elsewhere in Training) — this is a compact "last synced" timestamp.
function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${date} at ${formatTrainingTime(d)}`
}

interface HevySyncButtonProps {
  compact?: boolean
  iconOnly?: boolean
}

export function HevySyncButton({ compact = false, iconOnly = false }: HevySyncButtonProps) {
  const initialSync     = useInitialHevySync()
  const incrementalSync = useIncrementalHevySync()
  const { data: lastSyncTime } = useLastSyncTime()

  const anyPending = initialSync.isPending || incrementalSync.isPending

  // icon-only = tiny ↻ + gear, no text labels, used in page header
  const sizeClass = iconOnly
    ? 'min-h-[44px] min-w-[44px] text-xs'
    : compact
    ? 'min-h-[44px] px-3 text-xs'
    : 'min-h-[44px] px-4 text-sm rounded-xl'

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-1">
        {/* Main sync button */}
        <button
          type="button"
          onClick={() => incrementalSync.mutate()}
          disabled={anyPending}
          title={incrementalSync.isPending ? 'Syncing…' : 'Sync Hevy'}
          className={`flex items-center justify-center gap-1 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${sizeClass}`}
        >
          <span className={incrementalSync.isPending ? 'animate-spin inline-block' : ''}>↻</span>
          {!iconOnly && <span>{incrementalSync.isPending ? 'Syncing…' : 'Sync'}</span>}
        </button>

        {/* Gear button — opens full-re-sync popover */}
        <Popover className="relative">
          <PopoverButton
            className={`flex items-center justify-center border border-ink-200 rounded-lg text-ink-500 hover:bg-cream-50 hover:text-ink-700 transition-colors ${
              iconOnly ? 'min-h-[44px] min-w-[44px] text-xs' : compact ? 'min-h-[44px] min-w-[44px] text-sm' : 'min-h-[44px] min-w-[44px] rounded-xl text-base'
            }`}
            title="Sync settings"
          >
            ⚙
          </PopoverButton>
          <PopoverPanel
            anchor="bottom end"
            className="z-50 mt-2 w-72 rounded-2xl border border-ink-200 bg-white shadow-lg p-4 flex flex-col gap-3"
          >
            {/* Last synced info */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-0.5">Last synced</p>
              <p className="text-sm text-ink-700">
                {lastSyncTime ? formatSyncTime(lastSyncTime) : 'Never synced'}
              </p>
            </div>

            <div className="border-t border-ink-100" />

            {/* Full re-sync */}
            <div>
              <p className="text-xs font-semibold text-ink-700 mb-1">Full re-sync</p>
              <p className="text-xs text-ink-400 mb-2">
                Imports all data from scratch — takes ~30s
              </p>
              <button
                type="button"
                onClick={() => initialSync.mutate(undefined)}
                disabled={anyPending}
                className="w-full min-h-[44px] border border-accent-400 text-accent-600 rounded-xl text-sm font-medium hover:bg-accent-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {initialSync.isPending ? 'Importing…' : 'Import all from Hevy'}
              </button>
            </div>
          </PopoverPanel>
        </Popover>
      </div>

      {!compact && !iconOnly && !lastSyncTime && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-xl text-xs text-accent-800 font-medium">
          <span>⚠</span>
          <span>No Hevy data yet — click Sync to import your workouts</span>
        </div>
      )}
    </div>
  )
}
