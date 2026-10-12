import { cx } from '../../../../shared/ui'
import { STRAVA_ORANGE } from '../../stravaMeta'
import type { DayMark } from './monthGrid'

// One mark per calendar day, told apart by SHAPE as well as colour (a solid
// bar, a ring, an outline): done = solid success bar · a plan still open
// today = warn ring · upcoming = info ring · missed = danger outline ·
// not logged yet (a late workout still counts) = dashed warn outline ·
// skipped = a grey bar.
const MARK: Record<DayMark, string> = {
  done:     'h-1.5 w-4 rounded-full bg-success',
  today:    'h-2 w-2 rounded-full border-2 border-warn',
  pending:  'h-1.5 w-4 rounded-full border-[1.5px] border-dashed border-warn',
  upcoming: 'h-2 w-2 rounded-full border-2 border-info',
  missed:   'h-1.5 w-4 rounded-full border-[1.5px] border-danger',
  skipped:  'h-1.5 w-4 rounded-full bg-line-strong',
}

export function DayMarkGlyph({ mark, className }: { mark: DayMark; className?: string }) {
  return <span aria-hidden className={cx('inline-block shrink-0', MARK[mark], className)} />
}

/** Strava's brand orange (an identity colour, not a status). */
export function StravaBar({ className = 'h-0.5 w-3' }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block shrink-0 rounded-full', className)} style={{ backgroundColor: STRAVA_ORANGE }} />
}
