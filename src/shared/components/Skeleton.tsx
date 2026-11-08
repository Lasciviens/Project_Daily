interface SkeletonProps {
  className?: string
  rounded?: string
}

export function Skeleton({ className = '', rounded = 'rounded-control' }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`block skeleton ${rounded} ${className}`}
    />
  )
}

interface SkeletonTextProps {
  lines?: number
  className?: string
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <span className={`block space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          rounded="rounded-md"
          // Last line is shorter, mimicking a wrapped paragraph's final line
          className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </span>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <Skeleton rounded="rounded-full" className="h-10 w-10 shrink-0" />
        <span className="flex-1 min-w-0 space-y-2">
          <Skeleton rounded="rounded-md" className="h-3.5 w-1/2" />
          <Skeleton rounded="rounded-md" className="h-3 w-1/3" />
        </span>
      </div>
      <SkeletonText lines={3} className="mt-4" />
    </div>
  )
}

/**
 * A tab whose code is still on its way (a lazyPart's Suspense fallback; THEME.md §5): a screen's worth of room
 * with two cards — never a 0px placeholder, which blanked the page under the tab bar and collapsed it until the
 * code landed.
 */
export function SkeletonTab() {
  return (
    <div aria-busy="true" className="flex min-h-[60vh] flex-col gap-3 sm:gap-4">
      <Skeleton rounded="rounded-card" className="h-40 w-full max-w-2xl" />
      <Skeleton rounded="rounded-card" className="h-64 w-full max-w-2xl" />
    </div>
  )
}
