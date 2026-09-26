import { Activity, Bike, Dumbbell, Footprints, PersonStanding, Waves, type LucideIcon } from 'lucide-react'
import type { StravaActivity } from '../types.hevy'

const TYPE_ICON: Record<StravaActivity['type'], LucideIcon> = {
  run: Footprints,
  walk: PersonStanding,
  cycling: Bike,
  swim: Waves,
  yoga: Activity,
  other: Dumbbell,
}

export function StravaTypeIcon({ type, className = 'h-4 w-4' }: { type: StravaActivity['type'] | string; className?: string }) {
  const Icon = TYPE_ICON[type as StravaActivity['type']] ?? Dumbbell
  return <Icon className={className} aria-hidden />
}

export function StravaLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  )
}
