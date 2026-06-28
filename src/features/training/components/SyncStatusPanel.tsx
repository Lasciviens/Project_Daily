import { useQuery } from '@tanstack/react-query'
import { fetchHevySyncStatus } from '../api/hevyApi'

function useSyncStatus() {
  return useQuery({
    queryKey: ['hevy', 'sync-status'],
    queryFn:  fetchHevySyncStatus,
    staleTime: 60_000,
  })
}

function formatDate(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

interface StatusRowProps {
  label:  string
  count:  number | string
  note:   string
  dot:    'synced' | 'manual' | 'loading'
}

function StatusRow({ label, count, note, dot }: StatusRowProps) {
  const dotColor =
    dot === 'synced'  ? 'bg-green-400' :
    dot === 'manual'  ? 'bg-accent-400' :
    'bg-ink-300 animate-pulse'

  return (
    <div className="flex items-center gap-3 py-2 border-b border-ink-100 last:border-0">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="w-44 text-sm text-ink-700 shrink-0">{label}</span>
      <span className="text-sm font-medium text-ink-900 w-20 shrink-0">
        {typeof count === 'number' ? `${count} synced` : count}
      </span>
      <span className="text-xs text-ink-400">{note}</span>
    </div>
  )
}

interface Props {
  stravaCount?: number
}

export function SyncStatusPanel({ stravaCount }: Props) {
  const { data, isLoading } = useSyncStatus()

  return (
    <div className="rounded-xl border border-ink-100 bg-cream-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2">Sync Status</p>
      <div className="flex flex-col">
        <StatusRow
          label="Exercise Templates"
          count={isLoading ? '…' : (data?.exercise_templates ?? 0)}
          note="synced from Hevy — read only"
          dot={isLoading ? 'loading' : 'synced'}
        />
        <StatusRow
          label="Routines"
          count={isLoading ? '…' : (data?.routines ?? 0)}
          note="synced from Hevy — read only"
          dot={isLoading ? 'loading' : 'synced'}
        />
        <StatusRow
          label="Workouts"
          count={isLoading ? '…' : (data?.workouts ?? 0)}
          note="synced from Hevy, webhook active"
          dot={isLoading ? 'loading' : 'synced'}
        />
        <StatusRow
          label="Body Measurements"
          count={isLoading ? '…' : (data?.body_measurements ?? 0)}
          note="synced from Hevy — read only"
          dot={isLoading ? 'loading' : 'synced'}
        />
        <StatusRow
          label="Programs"
          count="manual"
          note="web-only — not in Hevy"
          dot="manual"
        />
        <StatusRow
          label="Strava Activities"
          count={stravaCount != null ? stravaCount : '—'}
          note="synced from Strava OAuth"
          dot="synced"
        />
      </div>
      {data?.last_synced && (
        <p className="text-xs text-ink-400 mt-2">
          Last Hevy sync: {formatDate(data.last_synced)}
        </p>
      )}
    </div>
  )
}
