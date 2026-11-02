// ─────────────────────────────────────────────────────────────────────────────
//  The Add sheet's time and length chips (owner, 15.10.2026: a time without a
//  length = "do it at 14:00" and doesn't block time).
//    "+ Time" → a time (the next half hour) and its picker; the chip then
//    reads "17:30" or "17:30–18:30" and taps open the picker again.
//    "+ Blocks time" shows only once there is a time → a length (1 h) and its
//    presets; "Doesn't block" takes the length off again.
//    The zone chip (183) shows only when an item's times are in another
//    zone's clock than the phone's: "Oslo time", and taps offer the item's
//    zone or this phone's.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CalendarDays, Clock, Globe, Hourglass, X } from 'lucide-react'
import { Time24Field } from './fields'
import { chipClass, choiceClass, CHIP_PANEL_CLASS } from './fieldStyles'
import { shiftTime, clampDurationMinutes } from './planModal.config'
import { slotLabel } from '../../../features/items/sheetRules'
import { formatDurationMinutes } from '../../utils/formatDuration'
import { phoneTimeZone, zoneCity, zoneTag } from '../../utils/timeZone'
import { itemTimeZone } from '../../../features/calendar/calendarEventRules'

const LENGTHS = [15, 30, 45, 60, 90, 120, 180] as const

const removeClass = chipClass('remove')

export function TimeChip({ time, duration, nextTime, onChange, allDay = false, onAllDay }: {
  time: string | null
  duration: number | null
  /** What "+ Time" starts with. */
  nextTime: string
  onChange: (time: string | null) => void
  /** No time and on Google Calendar: an all-day event there — the chip says so. */
  allDay?: boolean
  /** Offered while Google Calendar is connected on this device (planForm.withAllDay). */
  onAllDay?: () => void
}) {
  return (
    <Popover className="contents">
      {({ close }) => (
        <>
          <PopoverButton
            onClick={() => { if (!time && !allDay) onChange(nextTime) }}
            className={chipClass(time || allDay ? 'set' : 'add')}
            aria-label={time ? `Time: ${slotLabel(time, duration)}` : allDay ? 'All day — change' : 'Add a time'}
          >
            <Clock aria-hidden />{time ? slotLabel(time, duration) : allDay ? 'All day' : 'Time'}
          </PopoverButton>
          {/* As wide as one row of the hour, the minute, −30m and +30m. */}
          <PopoverPanel anchor="bottom start" modal={false} className={`${CHIP_PANEL_CLASS} w-max max-w-[calc(100vw-24px)]`}>
            <div className="flex flex-col gap-1.5">
              <Time24Field
                size="sm" value={time ?? nextTime} onChange={v => onChange(v)}
                onShift={delta => onChange(shiftTime(time ?? nextTime, delta))}
              />
              <div className="flex flex-wrap gap-1.5">
                {onAllDay && (
                  <button type="button" aria-pressed={allDay} onClick={() => { onAllDay(); close() }} className={chipClass(allDay ? 'set' : 'add')}>
                    <CalendarDays aria-hidden />All day
                  </button>
                )}
                <button type="button" onClick={() => { onChange(null); close() }} className={removeClass}>
                  <X aria-hidden />No time
                </button>
              </div>
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
                <MinutesField duration={duration} onChange={onChange} />
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

/**
 * The length typed in minutes. The field keeps what is typed — an empty field
 * included, so "120" can be cleared and "300" typed (owner, 16.10.2026: it
 * snapped back to 120) — and saves each whole number from 1 to 1440 as it
 * comes; leaving it empty or invalid shows the saved length again.
 */
function MinutesField({ duration, onChange }: { duration: number | null; onChange: (minutes: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="flex items-center gap-1.5 text-meta text-fg-muted">
      Minutes
      <input
        type="number" inputMode="numeric" min={1} max={1440}
        value={draft ?? (duration ?? '')}
        onChange={e => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isInteger(n) && n > 0) onChange(clampDurationMinutes(n))
        }}
        onBlur={() => setDraft(null)}
        aria-label="Length in minutes" className="input input-sm w-[4.5rem] tabular-nums"
      />
    </label>
  )
}

/**
 * The zone the item's times are in (183), shown only when it isn't the phone's clock — "Oslo time" on an item made at
 * home, opened in Istanbul — so a time never silently means two things. Its two choices: the item's own zone (the one
 * it was saved in) and this phone's; the times stay as typed, the zone says which clock they are on.
 */
export function ZoneChip({ zone, savedZone, onPick }: {
  /** The zone the sheet's times are in now (null = the home zone). */
  zone: string | null
  /** The zone the item was saved in (undefined for a new item). */
  savedZone?: string | null
  onPick: (zone: string | null) => void
}) {
  const phone = phoneTimeZone()
  if (!phone) return null
  const differs = zoneTag(zone, phone) !== null || (savedZone !== undefined && zoneTag(savedZone, phone) !== null)
  if (!differs) return null
  const current = itemTimeZone(zone)
  const choices: { zone: string | null; label: string }[] = [
    ...(savedZone !== undefined ? [{ zone: savedZone, label: `${zoneCity(itemTimeZone(savedZone))} time` }] : []),
    ...(itemTimeZone(savedZone) !== phone ? [{ zone: phone, label: `${zoneCity(phone)} time · this phone` }] : []),
  ]
  return (
    <Popover className="contents">
      {({ close }) => (
        <>
          <PopoverButton className={chipClass('set')} aria-label={`Times are ${zoneCity(current)} time — change`}>
            <Globe aria-hidden />{zoneCity(current)} time
          </PopoverButton>
          <PopoverPanel anchor="bottom start" modal={false} className={`${CHIP_PANEL_CLASS} w-max max-w-[calc(100vw-24px)]`}>
            <div className="flex flex-col gap-1.5">
              {choices.map(c => (
                <button
                  key={c.label} type="button" aria-pressed={itemTimeZone(c.zone) === current}
                  onClick={() => { onPick(c.zone); close() }}
                  className={choiceClass(itemTimeZone(c.zone) === current, 'justify-start', 'sm')}
                >{c.label}</button>
              ))}
            </div>
          </PopoverPanel>
        </>
      )}
    </Popover>
  )
}
