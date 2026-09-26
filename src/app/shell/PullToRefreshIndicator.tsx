import { RotateCw } from 'lucide-react'
import { cx } from '../../shared/ui'

/**
 * Phone-only pull-to-refresh dot under the header. Follows the finger with a
 * rotation cue, turns solid accent once letting go will refresh (isReady),
 * and spins while the refetch is in flight.
 */
export function PullToRefreshIndicator({ pullDistance, isRefreshing, isReady }: {
  pullDistance: number
  isRefreshing: boolean
  isReady: boolean
}) {
  const armed = isReady || isRefreshing
  return (
    <div
      aria-hidden
      className={cx(
        'fixed left-1/2 z-chrome grid h-9 w-9 place-items-center rounded-full border shadow-float',
        'transition-[transform,background-color,color] duration-150',
        armed ? 'border-accent-500 bg-accent-500 text-on-accent' : 'glass-chrome border-line text-accent-600',
      )}
      style={{
        top: 'calc(var(--app-header-h) + env(safe-area-inset-top))',
        opacity: pullDistance > 4 || isRefreshing ? 1 : 0,
        transform: `translate(-50%, ${Math.max(pullDistance, isRefreshing ? 44 : 0) - 36}px) scale(${isRefreshing ? 1 : Math.min(0.6 + pullDistance / 88, 1.05)})`,
      }}
    >
      <RotateCw
        className={cx('h-4 w-4', isRefreshing && 'animate-spin')}
        strokeWidth={2.2}
        style={isRefreshing ? undefined : { transform: `rotate(${pullDistance * 3}deg)` }}
      />
    </div>
  )
}
