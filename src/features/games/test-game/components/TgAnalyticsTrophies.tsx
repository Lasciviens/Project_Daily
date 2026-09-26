import { useRef } from 'react'
import { RotateCw } from 'lucide-react'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { isPsnReauthRequired } from '../../api/psnApi'
import { usePsnStatus, usePsnTitles } from '../../hooks/usePlayStation'
import type { TgaLibrary } from './tgAnalyticsModel'
import { useSeenOnce } from './tgAnalyticsTrophiesSeen'
import { TgAnalyticsCard } from './TgAnalyticsCard'
import { TgAnalyticsTrophiesBody, TgAnalyticsTrophiesSkeleton } from './TgAnalyticsTrophiesBody'

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const text = isPsnReauthRequired(error)
    ? 'Sony stopped accepting the stored PlayStation session. Renew it from your profile menu, then try again.'
    : 'Couldn’t load your trophies from PlayStation just now.'
  return (
    <div role="alert" className="flex flex-1 flex-col items-start justify-center gap-3 py-4">
      <p className="text-[13px] leading-relaxed text-[var(--tg-text-2)]">{text}</p>
      <button type="button" onClick={onRetry} className="tg-btn tg-btn-secondary">
        <RotateCw size={15} strokeWidth={2} aria-hidden />Try again
      </button>
    </div>
  )
}

/**
 * The card itself. The trophy-set list is a Sony round trip the rest of the
 * tab doesn't need, so it only starts once the card is scrolled near —
 * until then (and while it loads) the card shows its skeleton.
 */
function TrophyCard({ className }: { className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeenOnce(ref)
  const q = usePsnTitles(seen)
  return (
    <TgAnalyticsCard label="PlayStation trophies" meta="whole account" className={className}>
      <div ref={ref} className="flex flex-1 flex-col">
        <ErrorBoundary label="PlayStation trophies" action="games_analytics_trophies">
          {!seen || q.isPending ? <TgAnalyticsTrophiesSkeleton />
            : q.isError ? <Failed error={q.error} onRetry={() => void q.refetch()} />
            : <TgAnalyticsTrophiesBody titles={q.data} />}
        </ErrorBoundary>
      </div>
    </TgAnalyticsCard>
  )
}

/** Only a connected account gets a card: no connection, or a status still being checked, renders nothing. */
function Connected({ className }: { className: string }) {
  const status = usePsnStatus()
  return status.data?.connected ? <TrophyCard className={className} /> : null
}

/** PlayStation trophies, for the All and PlayStation libraries only. */
export function TgAnalyticsTrophies({ library, className = '' }: { library: TgaLibrary; className?: string }) {
  if (library !== 'all' && library !== 'playstation') return null
  return <Connected className={className} />
}
