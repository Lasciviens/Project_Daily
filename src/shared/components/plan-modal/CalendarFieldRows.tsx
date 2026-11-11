// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's calendar fields (step 2 of docs/features/item-screen-plan.md;
//  migration 193 — docs/features/planning-calendar.md → Calendar fields), drawn
//  as iOS Calendar draws them, only on an item with a slot or a repeat:
//    Location   Travel Time      Automatic / None / 5 minutes … 2 hours
//    Options    Alert            Default / None / At time of event … 1 week before
//               Second Alert     (once Alert is a time)
//               Show As          Busy | Free
//    Details    URL              an https link, its problem under it, ↗ shows the
//                                address before it opens
//  End Repeat sits under Repeat (TimeSection → EndRepeatRows). The choices and
//  words come from items/itemCalendarFields.ts; every change goes through
//  planForm.withCalendarField (an edit sends what the owner changed).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { cx, SegmentedControl, Truncate } from '../../ui'
import { allDayAlertDays, eventShowAs, eventTravel } from '../../../features/calendar/calendarEventRules'
import {
  alertChoices, alertLabel, alertRows, alertsOf, showAsLabel, travelLabel, TRAVEL_CHOICES, type AlertRows, type ShowAs,
} from '../../../features/items/itemCalendarFields'
import { ChoiceRow, LINE, NoteRow, Panel, Row, TapRow } from './ItemRows'
import { hostOf, openableUrl } from './itemScreenRules'
import type { PanelKey } from './TimeSection'

interface Opened {
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
}

// ── Alert and Second Alert ──────────────────────────────────────────────────

/** One alert's words in a row: the area's own ("Default"), none, or the time before. */
function alertWords(v: AlertRows['alert'], allDay: boolean): string {
  if (v === 'default') return 'Default'
  if (v === 'none') return 'None'
  return alertLabel(v, allDay)
}

/** Two alerts mean the same moment: the same minutes, or (all day) the same day at 09:00. */
const sameAlert = (a: number, b: number, allDay: boolean) => (allDay ? allDayAlertDays(a) === allDayAlertDays(b) : a === b)

/** Alert, then Second Alert once the first is a time — Apple's two rows, saved as one list (alertsOf). */
export function AlertRows({ alerts, allDay, defaultHint, onChange, mark, open, toggle }: Opened & {
  alerts: number[] | null
  /** No time: the all-day choices (on the day, 1 day, 2 days, a week before — at 09:00). */
  allDay: boolean
  /** What "Default" means where the item goes (its area's alert in Apple Calendar, Google's own default). */
  defaultHint?: string
  onChange: (alerts: number[] | null) => void
  mark?: ReactNode
}) {
  const rows = alertRows(alerts)
  const choices = alertChoices(allDay)
  const first = typeof rows.alert === 'number' ? rows.alert : null
  const pick = (next: AlertRows) => { onChange(alertsOf(next)); toggle(null) }
  return (
    <>
      <TapRow label="Alert" mark={mark} value={alertWords(rows.alert, allDay)} open={open === 'alert'} onClick={() => toggle('alert')} />
      {open === 'alert' && (
        <Panel label="Alert">
          <ChoiceRow label="Default" hint={defaultHint} chosen={rows.alert === 'default'} onClick={() => pick({ alert: 'default', second: null })} />
          <ChoiceRow label="None" chosen={rows.alert === 'none'} onClick={() => pick({ alert: 'none', second: null })} />
          {choices.map(m => (
            <ChoiceRow key={m} label={alertLabel(m, allDay)} chosen={first !== null && sameAlert(first, m, allDay)}
              onClick={() => pick({ alert: m, second: rows.second !== null && !sameAlert(rows.second, m, allDay) ? rows.second : null })} />
          ))}
        </Panel>
      )}
      {first !== null && (
        <>
          <TapRow label="Second Alert" mark={mark} value={rows.second === null ? 'None' : alertLabel(rows.second, allDay)}
            open={open === 'alert2'} onClick={() => toggle('alert2')} />
          {open === 'alert2' && (
            <Panel label="Second Alert">
              <ChoiceRow label="None" chosen={rows.second === null} onClick={() => pick({ alert: first, second: null })} />
              {choices.filter(m => !sameAlert(m, first, allDay)).map(m => (
                <ChoiceRow key={m} label={alertLabel(m, allDay)} chosen={rows.second !== null && sameAlert(rows.second, m, allDay)}
                  onClick={() => pick({ alert: first, second: m })} />
              ))}
            </Panel>
          )}
        </>
      )}
    </>
  )
}

// ── Show As ─────────────────────────────────────────────────────────────────

const SHOW_AS: { value: ShowAs; label: string }[] = [{ value: 'busy', label: 'Busy' }, { value: 'free', label: 'Free' }]

/** Busy or Free; none of its own shows what the length gives (Busy with one, Free without and all day). */
export function ShowAsRow({ showAs, timedWithLength, onChange, mark }: {
  showAs: ShowAs | null
  timedWithLength: boolean
  onChange: (showAs: ShowAs) => void
  mark?: ReactNode
}) {
  const shown: ShowAs = eventShowAs(showAs) ?? (showAsLabel(null, timedWithLength) === 'Busy' ? 'busy' : 'free')
  return (
    <Row label="Show As" mark={mark}>
      <SegmentedControl<ShowAs> size="xs" options={SHOW_AS} value={shown} onChange={onChange} />
    </Row>
  )
}

// ── Travel Time ─────────────────────────────────────────────────────────────

/** Automatic (Time to Leave from the place's map pin), None, or minutes before — Apple's list. */
export function TravelRow({ minutes, hasPin, onChange, mark, open, toggle }: Opened & {
  minutes: number | null
  /** The place has a map pin: Automatic has something to work from. */
  hasPin: boolean
  onChange: (minutes: number | null) => void
  mark?: ReactNode
}) {
  const value = eventTravel(minutes)
  return (
    <>
      <TapRow label="Travel Time" mark={mark} value={travelLabel(value)} open={open === 'travel'} onClick={() => toggle('travel')} />
      {open === 'travel' && (
        <Panel label="Travel Time">
          {TRAVEL_CHOICES.map(m => (
            <ChoiceRow key={m ?? 'auto'} label={travelLabel(m)} chosen={value === m}
              hint={m === null ? (hasPin ? "Time to Leave, from the place's map pin" : 'Needs a place on the map (Location)') : undefined}
              onClick={() => { onChange(m); toggle(null) }} />
          ))}
        </Panel>
      )}
    </>
  )
}

// ── URL ─────────────────────────────────────────────────────────────────────

/**
 * The item's link, a field with no box. Only an https link is taken (cleanItemUrl, the database's item_url_ok); one
 * that isn't says why under the row once the field is left, and nothing saves until it is fixed (the heading says so
 * too). ↗ opens a line under the row with the address it opens — the host first — and Open; nothing opens before.
 */
export function UrlRow({ url, problem, onChange, mark, open, toggle }: Opened & {
  url: string
  /** Why the typed link can't be saved (planForm.urlProblem), or null. */
  problem: string | null
  onChange: (url: string) => void
  mark?: ReactNode
}) {
  const [typing, setTyping] = useState(false)
  const href = openableUrl(url)
  return (
    <>
      <div className={cx(LINE, 'flex min-h-11 w-full items-center gap-2 px-3.5 text-lead')}>
        <input value={url} onChange={e => onChange(e.target.value)} placeholder="URL" aria-label="URL"
          onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          type="text" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"
          aria-invalid={!!problem || undefined}
          className="input-bare min-w-0 flex-1 pb-0 text-lead" />
        {href && (
          <button type="button" onClick={() => toggle('link')} aria-expanded={open === 'link'} aria-label="Open the link — shows its address first"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
            <ExternalLink aria-hidden className="h-4 w-4" />
          </button>
        )}
        {mark}
      </div>
      {problem && !typing && <NoteRow tone="danger">{problem} — nothing is saved until it&apos;s fixed.</NoteRow>}
      {open === 'link' && href && <LinkPanel href={href} onOpened={() => toggle(null)} />}
    </>
  )
}

/** The address before it opens: the host, the whole link (its "More" shows a long one), then Open. */
function LinkPanel({ href, onOpened }: { href: string; onOpened: () => void }) {
  return (
    <Panel label="Open the link">
      <div className="flex flex-col gap-1.5">
        <p className="text-meta text-fg-muted">Opens <bdi className="font-semibold text-fg">{hostOf(href)}</bdi></p>
        <bdi className="block min-w-0 break-all text-meta text-fg-2"><Truncate lines={3}>{href}</Truncate></bdi>
        <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={onOpened}
          className="btn-secondary btn-sm self-start">
          <ExternalLink aria-hidden className="h-4 w-4" /> Open
        </a>
      </div>
    </Panel>
  )
}
