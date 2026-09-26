import type { Tone } from '../../shared/ui'
import type { HevySet } from './types.hevy'

export type SetType = HevySet['type']

/** The one set-type → label/tone map (routine chips, workout detail, editors). */
export const SET_TYPE_META: Record<SetType, { label: string; short: string; tone: Tone }> = {
  warmup:  { label: 'Warm-up',  short: 'W', tone: 'neutral' },
  normal:  { label: 'Normal',   short: 'N', tone: 'accent' },
  dropset: { label: 'Drop set', short: 'D', tone: 'info' },
  failure: { label: 'Failure',  short: 'F', tone: 'danger' },
}

export const SET_TYPE_OPTIONS = (Object.keys(SET_TYPE_META) as SetType[])
  .sort((a, b) => (a === 'normal' ? -1 : b === 'normal' ? 1 : 0))
  .map(value => ({ value, label: SET_TYPE_META[value].label }))
