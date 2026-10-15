// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's time and length chips (owner, 15.10.2026: a time without a
//  length = "do it at 14:00" and doesn't block time).
//    "+ Time" → a time (the next half hour) and its picker; the chip then
//    reads "17:30" or "17:30–18:30" and taps open the picker again.
//    "+ Blocks time" shows only once there is a time → a length (1 h) and its
//    presets; "Doesn't block" takes the length off again.
// ─────────────────────────────────────────────────────────────────────────────

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Clock, Hourglass, X } from 'lucide-react'
import { Time24Field } from './fields'
import { chipClass, choiceClass, CHIP_PANEL_CLASS } from './fieldStyles'
import { shiftTime, clampDurationMinutes } from './planModal.config'
import { slotLabel } from '../../../features/items/sheetRules'
import { formatDurationMinutes } from '../../utils/formatDuration'

const LENGTHS = [15, 30, 45, 60, 90, 120, 180] as const

const removeClass = chipClass('remove')

export function TimeChip({ time, duration, nextTime, onChange }: {
  time: string | null
  duration: number | null
  /** What "+ Time" starts with. */
  nextTime: string
  onChange: (time: string | null) => void
}) {
  return (
    <Popover className="contents">
      {({ close }) => (
        <>
          <PopoverButton
            onClick={() => { if (!time) onChange(nextTime) }}
            className={chipClass(time ? 'set' : 'add')}
            aria-label={time ? `Time: ${slotLabel(time, duration)}` : 'Add a time'}
          >
            <Clock aria-hidden />{time ? slotLabel(time, duration) : 'Time'}
          </PopoverButton>
          {/* As wide as one row of the hour, the minute, −30m and +30m. */}
          <PopoverPanel anchor="bottom start" modal={false} className={`${CHIP_PANEL_CLASS} w-max max-w-[calc(100vw-24px)]`}>
            <div className="flex flex-col gap-1.5">
              <Time24Field
                size="sm" value={time ?? nextTime} onChange={v => onChange(v)}
                onShift={delta => onChange(shiftTime(time ?? nextTime, delta))}
              />
              <button type="button" onClick={() => { onChange(null); close() }} className={`${removeClass} self-start`}>
                <X aria-hidden />No time
              </button>
            </div>
          </PopoverPanel>
        </>
      )}
    </Popover>
  )
}

export function LengthChip({ duration, onChange }: {
  duration: number | null
  onChange: (minutes: number | null) => void
}) {
  return (
    <Popover className="contents">
      {({ close }) => (
        <>
          <PopoverButton
            onClick={() => { if (!duration) onChange(60) }}
            className={chipClass(duration ? 'set' : 'add')}
            aria-label={duration ? `Blocks ${formatDurationMinutes(duration)}` : 'Blocks time'}
          >
            <Hourglass aria-hidden />{duration ? `Blocks ${formatDurationMinutes(duration)}` : 'Blocks time'}
          </PopoverButton>
          <PopoverPanel anchor="bottom start" modal={false} className={`${CHIP_PANEL_CLASS} w-max max-w-[calc(100vw-24px)]`}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {LENGTHS.map(m => (
                  <button
                    key={m} type="button" aria-pressed={duration === m}
                    onClick={() => { onChange(m); close() }}
                    className={choiceClass(duration === m, 'tabular-nums', 'sm')}
                  >{formatDurationMinutes(m)}</button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-meta text-fg-muted">
                  Minutes
                  <input
                    type="number" inputMode="numeric" min={1} max={1440} value={duration ?? ''}
                    onChange={e => { const n = Number(e.target.value); if (n > 0) onChange(clampDurationMinutes(n)) }}
                    aria-label="Length in minutes" className="input input-sm w-[4.5rem] tabular-nums"
                  />
                </label>
                <button type="button" onClick={() => { onChange(null); close() }} className={removeClass}>
                  <X aria-hidden />Doesn't block
                </button>
              </div>
            </div>
          </PopoverPanel>
        </>
      )}
    </Popover>
  )
}
