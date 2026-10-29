import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { Button, Card, CardHeader, PageBoard, TonePill } from '../../../shared/ui'
import {
  ALERT_CHOICES, AREA_KEYS, AREA_LABEL, alertLabel, areaProblem, readCalendarPrefs,
  type AreaKey, type CalendarArea, type CalendarPrefs,
} from '../../calendar/areas/calendarAreas'
import { useCalendarPrefs, useSaveCalendarPrefs } from '../../calendar/areas/useCalendarPrefs'
import { useICloudStatus, useSetupICloudCalendars } from '../../calendar/icloud/useICloud'
import { CALENDAR_SETTINGS_BOARD, type CalendarSettingsSection } from '../settingsBoards'

// Settings → Calendar (owner, 29.10.2026: "Add those to the settings as well,
// and other settings that you are coding but I couldn't change without asking
// you"). The app's calendars in Apple Calendar, one per area: name, emoji,
// colour, default alert, on/off. Phase 2a only makes the calendars; events
// follow in 2b (docs/features/calendar-plan.md).

const sameDoc = (a: CalendarPrefs, b: CalendarPrefs) => JSON.stringify(a) === JSON.stringify(b)

function AreaRow({ areaKey, area, ready, failure, onChange }: {
  areaKey: AreaKey
  area: CalendarArea
  ready: boolean | undefined
  failure: string | undefined
  onChange: (next: CalendarArea) => void
}) {
  const problem = areaProblem(area)
  const label = AREA_LABEL[areaKey]
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-semibold text-fg-2">{label}</span>
        {!area.enabled ? <TonePill tone="neutral">Off</TonePill>
          : failure ? <TonePill tone="danger">Not made</TonePill>
          : ready ? <TonePill tone="success">In Apple Calendar</TonePill>
          : ready === false ? <TonePill tone="neutral">Not made yet</TonePill> : null}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={area.color} aria-label={`${label} colour`} disabled={!area.enabled}
          onChange={e => onChange({ ...area, color: e.target.value.toUpperCase() })}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-0.5 disabled:opacity-50" />
        <input className="input w-12 shrink-0 text-center" value={area.emoji} aria-label={`${label} emoji`} disabled={!area.enabled}
          onChange={e => onChange({ ...area, emoji: e.target.value })} />
        <input className="input min-w-0 max-w-md flex-1" value={area.name} aria-label={`${label} calendar name`} disabled={!area.enabled}
          onChange={e => onChange({ ...area, name: e.target.value })} />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-meta text-fg-2">
          Alert
          <select className="select w-auto" value={area.alertMinutes === null ? 'none' : String(area.alertMinutes)} disabled={!area.enabled}
            onChange={e => onChange({ ...area, alertMinutes: e.target.value === 'none' ? null : Number(e.target.value) })}>
            {ALERT_CHOICES.map(m => <option key={m ?? 'none'} value={m === null ? 'none' : String(m)}>{alertLabel(m)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-meta text-fg-2">
          <input type="checkbox" checked={area.enabled} onChange={e => onChange({ ...area, enabled: e.target.checked })} />
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
  const [draft, setDraft] = useState<CalendarPrefs | null>(null)
  const form = draft ?? prefs
  const dirty = !!draft && !sameDoc(readCalendarPrefs(draft), prefs)
  const invalid = AREA_KEYS.some(k => areaProblem(form.areas[k]))
  const connected = !!status.data?.connected
  const anyReady = AREA_KEYS.some(k => status.data?.areas?.[k]?.ready)
  const failures = new Map((setup.data?.areas ?? []).filter(a => a.state === 'failed').map(a => [a.area, a.detail ?? 'iCloud did not take it']))

  function change(key: AreaKey, next: CalendarArea) {
    setDraft({ areas: { ...form.areas, [key]: next } })
  }

  return (
    <Card>
      <CardHeader icon={<CalendarDays />} title="The app's calendars" subtitle="In Apple Calendar through iCloud, one per area. Events follow in the next step." />
      {failed ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-meta text-danger">The calendar settings could not be loaded.</p>
          <Button size="sm" onClick={() => retry()}>Retry</Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col">
            {AREA_KEYS.map(k => (
              <AreaRow key={k} areaKey={k} area={form.areas[k]} ready={connected ? !!status.data?.areas?.[k]?.ready : undefined}
                failure={failures.get(k)} onChange={next => change(k, next)} />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant={dirty ? 'primary' : 'secondary'} disabled={!loaded || !dirty || invalid} loading={save.isPending}
              onClick={() => draft && save.mutate(readCalendarPrefs(draft), { onSuccess: () => setDraft(null) })}>
              Save
            </Button>
            {connected ? (
              <Button disabled={!loaded || dirty} loading={setup.isPending} onClick={() => setup.mutate()}>
                {anyReady ? 'Update Apple Calendar' : 'Create in Apple Calendar'}
              </Button>
            ) : (
              <p className="text-meta text-fg-muted">
                Connect iCloud first: <Link to={{ search: '?tab=subscriptions' }} className="text-accent-600 underline">Settings → Subscriptions</Link>.
              </p>
            )}
            {connected && dirty && <span className="text-meta text-fg-muted">Save first</span>}
          </div>
        </>
      )}
    </Card>
  )
}

export function CalendarTab() {
  const sections: Record<CalendarSettingsSection, ReactNode> = { areas: <AreasCard /> }
  return <PageBoard sections={sections} layout={CALENDAR_SETTINGS_BOARD} stackClassName="max-w-2xl" />
}
