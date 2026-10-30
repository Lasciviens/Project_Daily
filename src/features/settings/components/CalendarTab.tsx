import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { Button, Card, CardHeader, PageBoard, TonePill } from '../../../shared/ui'
import {
  ALERT_CHOICES, ALERT_MAX, AREA_KEYS, AREA_LABEL, alertLabel, areaProblem, areaSwitches, readCalendarPrefs,
  type AreaKey, type AreaSwitch, type CalendarArea, type CalendarPrefs,
} from '../../calendar/areas/calendarAreas'
import { AreaSwitchDialog } from './AreaSwitchDialog'
import { useCalendarPrefs, useSaveCalendarPrefs } from '../../calendar/areas/useCalendarPrefs'
import { useICloudStatus, useSetupICloudCalendars } from '../../calendar/icloud/useICloud'
import { CALENDAR_SETTINGS_BOARD, type CalendarSettingsSection } from '../settingsBoards'

// Settings → Calendar (owner, 29.10.2026: "Add those to the settings as well,
// and other settings that you are coding but I couldn't change without asking
// you"). The app's calendars in Apple Calendar, one per area: name, emoji,
// colour, default alert, on/off, and where the area's events show — Google
// Calendar or Apple Calendar (2b-2: switching moves them, AreaSwitchDialog).
// docs/features/calendar-plan.md.

const sameDoc = (a: CalendarPrefs, b: CalendarPrefs) => JSON.stringify(a) === JSON.stringify(b)

function AreaRow({ areaKey, area, locked, ready, failure, appleAvailable, onChange }: {
  areaKey: AreaKey
  area: CalendarArea
  /** The saved settings aren't loaded yet: an edit now would be made on the defaults. */
  locked: boolean
  ready: boolean | undefined
  failure: string | undefined
  /** iCloud is connected: Apple Calendar can be picked. */
  appleAvailable: boolean
  onChange: (next: CalendarArea) => void
}) {
  const problem = areaProblem(area)
  const label = AREA_LABEL[areaKey]
  const off = locked || !area.enabled
  // Any whole number of minutes: a saved value that isn't a quick pick opens as Custom.
  const [customPicked, setCustom] = useState(false)
  const custom = customPicked || !ALERT_CHOICES.includes(area.alertMinutes)
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-semibold text-fg-2">{label}</span>
        {!area.enabled ? <TonePill tone="neutral">Off</TonePill>
          : failure ? <TonePill tone="danger">Not made</TonePill>
          : ready ? <TonePill tone="success">Calendar ready</TonePill>
          : ready === false ? <TonePill tone="neutral">No calendar yet</TonePill> : null}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={area.color} aria-label={`${label} colour`} disabled={off}
          onChange={e => onChange({ ...area, color: e.target.value.toUpperCase() })}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-0.5 disabled:opacity-50" />
        <input className="input w-12 shrink-0 text-center" value={area.emoji} aria-label={`${label} emoji`} disabled={off}
          onChange={e => onChange({ ...area, emoji: e.target.value })} />
        <input className="input min-w-0 max-w-md flex-1" value={area.name} aria-label={`${label} calendar name`} disabled={off}
          onChange={e => onChange({ ...area, name: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-1.5 text-meta text-fg-2">
          Alert
          <select className="select w-auto" value={custom ? 'custom' : area.alertMinutes === null ? 'none' : String(area.alertMinutes)} disabled={off}
            onChange={e => {
              const v = e.target.value
              if (v === 'custom') { setCustom(true); return }
              setCustom(false)
              onChange({ ...area, alertMinutes: v === 'none' ? null : Number(v) })
            }}>
            {ALERT_CHOICES.map(m => <option key={m ?? 'none'} value={m === null ? 'none' : String(m)}>{alertLabel(m)}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {custom && (
          <label className="flex items-center gap-1.5 text-meta text-fg-2">
            <input type="number" inputMode="numeric" min={0} max={ALERT_MAX} step={1} className="input w-20" aria-label={`${label} alert, minutes before`} disabled={off}
              value={area.alertMinutes ?? ''}
              onChange={e => onChange({ ...area, alertMinutes: e.target.value === '' ? null : Number(e.target.value) })} />
            <span className="whitespace-nowrap">min before</span>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-meta text-fg-2">
          Shows in
          <select className="select w-auto" value={area.app} disabled={off} aria-label={`${label}: where its events show`}
            onChange={e => onChange({ ...area, app: e.target.value === 'apple' ? 'apple' : 'google' })}>
            <option value="google">Google Calendar</option>
            <option value="apple" disabled={!appleAvailable && area.app !== 'apple'}>Apple Calendar</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-meta text-fg-2">
          <input type="checkbox" className="h-4 w-4 accent-accent-500" checked={area.enabled} disabled={locked} onChange={e => onChange({ ...area, enabled: e.target.checked })} />
          In use
        </label>
      </div>
      {problem && <p role="alert" className="text-meta text-danger">{problem}</p>}
      {failure && <p role="alert" className="text-meta text-danger">{failure}</p>}
    </li>
  )
}

function AreasCard() {
  const { prefs, loaded, failed, retry } = useCalendarPrefs()
  const save = useSaveCalendarPrefs()
  const status = useICloudStatus()
  const setup = useSetupICloudCalendars()
  // Only the areas edited here, over the saved ones: a refetch never loses an edit, an edit never resets another area.
  const [edits, setEdits] = useState<Partial<Record<AreaKey, CalendarArea>>>({})
  const form: CalendarPrefs = { areas: { ...prefs.areas, ...edits } }
  const dirty = !sameDoc(readCalendarPrefs(form), prefs)
  const invalid = AREA_KEYS.some(k => areaProblem(form.areas[k]))
  const connected = status.data?.connected === true
  const ready = (k: AreaKey) => !!status.data?.areas?.[k]?.ready
  const missing = AREA_KEYS.some(k => form.areas[k].enabled && !ready(k))
  const failures = new Map((setup.data?.areas ?? []).filter(a => a.state === 'failed').map(a => [a.area, a.detail ?? 'iCloud did not take it']))
  const busy = save.isPending || setup.isPending
  // An area whose events change app (2b-2): its move is asked about first.
  const switches = loaded ? areaSwitches(prefs, readCalendarPrefs(form)) : []
  const [switching, setSwitching] = useState<AreaSwitch[] | null>(null)

  // One action: save what changed, then bring Apple Calendar up to date with it.
  function apply() {
    if (switches.length) { setSwitching(switches); return }
    if (!dirty) { setup.mutate(); return }
    save.mutate(readCalendarPrefs(form), {
      onSuccess: () => {
        setEdits({})
        if (connected) setup.mutate()
      },
    })
  }

  const label = switches.length ? 'Save and move…'
    : !connected ? 'Save'
    : dirty ? 'Save and update Apple Calendar'
    : missing ? 'Create in Apple Calendar'
    : 'Update Apple Calendar'

  return (
    <Card>
      <CardHeader icon={<CalendarDays />} title="The app's calendars" subtitle="In Apple Calendar through iCloud, one per area." />
      {failed ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-meta text-danger">The calendar settings could not be loaded.</p>
          <Button size="sm" onClick={() => retry()}>Retry</Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col">
            {AREA_KEYS.map(k => (
              <AreaRow key={k} areaKey={k} area={form.areas[k]} locked={!loaded} ready={connected ? ready(k) : undefined}
                failure={failures.get(k)} appleAvailable={connected} onChange={next => setEdits(e => ({ ...e, [k]: next }))} />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!loaded || invalid || (!dirty && !connected) || status.isLoading} loading={busy} onClick={apply}>
              {label}
            </Button>
            {status.isError ? (
              // Never "connect again" on a failed read: Apple shows a password only once.
              <span className="flex items-center gap-2">
                <span role="alert" className="text-meta text-danger">The iCloud connection could not be read.</span>
                <Button size="sm" onClick={() => status.refetch()}>Retry</Button>
              </span>
            ) : status.data?.connected === false && (
              <p className="text-meta text-fg-muted">
                To make them in Apple Calendar, connect iCloud in <Link to={{ search: '?tab=subscriptions' }} className="text-accent-600 underline">Settings → Subscriptions</Link>.
              </p>
            )}
          </div>
          {!setup.data && status.data?.lastError && <p role="alert" className="mt-2 text-meta text-danger">Last problem: {status.data.lastError}</p>}
        </>
      )}
      {switching && (
        <AreaSwitchDialog next={readCalendarPrefs(form)} switches={switching} onClose={() => setSwitching(null)}
          onDone={() => { setSwitching(null); setEdits({}) }} />
      )}
    </Card>
  )
}

export function CalendarTab() {
  const sections: Record<CalendarSettingsSection, ReactNode> = { areas: <AreasCard /> }
  return <PageBoard sections={sections} layout={CALENDAR_SETTINGS_BOARD} stackClassName="max-w-2xl" />
}
