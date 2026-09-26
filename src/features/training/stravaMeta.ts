import type { StravaActivity } from './types.hevy'

// Strava's brand orange is identity data, not theme chrome (THEME.md §2.5).
export const STRAVA_ORANGE = '#FC4C02'

export const STRAVA_TYPE_LABEL: Record<StravaActivity['type'], string> = {
  run: 'Run', walk: 'Walk', cycling: 'Cycling', swim: 'Swim', yoga: 'Yoga', other: 'Other',
}
