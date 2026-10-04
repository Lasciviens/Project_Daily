import { stageTones } from '../../shared/theme/stage'
import type { Tone } from '../../shared/ui'
import type { ReadStatus } from './types'

export const READ_STATUS_LABEL: Record<ReadStatus, string> = {
  want: 'Want to read',
  reading: 'Reading',
  finished: 'Finished',
  paused: 'Paused',
  dropped: 'Dropped',
}

// One meaning, one colour (THEME §2.4): reading is the shared "active" cyan,
// finished the "done" green, want-to-read the "planned" highlight.
export const READ_STATUS_TONE: Record<ReadStatus, Tone> = stageTones({
  want: 'planned',
  reading: 'active',
  finished: 'done',
  paused: 'paused',
  dropped: 'dropped',
})

export const READ_STATUSES: ReadStatus[] = ['reading', 'want', 'finished', 'paused', 'dropped']
