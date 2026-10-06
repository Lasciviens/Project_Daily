import { useMemo, useState, type ComponentType } from 'react'
import {
  ArrowLeft, BatteryMedium, ChevronRight, Hand, Highlighter, Languages, Library, PanelBottom, Search, SunMedium, Type,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Card, EmptyState, SegmentedControl, TonePill, cx } from '../../../../shared/ui'
import { SETTING_GROUPS } from '../../koboSettingsCatalogue'
import { AREAS, summarizeAreas, tint, type AreaId, type AreaSummary, type LevelFilter } from '../../kobo/settingsAreas'
import { GroupCard } from './SettingsGroupCard'
import { useKoboSettings } from './useKoboSetting'

const AREA_ICON: Record<AreaId, ComponentType<{ className?: string }>> = {
  sleep: BatteryMedium, screen: SunMedium, look: Type, bars: PanelBottom,
  touch: Hand, library: Library, notes: Highlighter, system: Languages,
}

const LEVELS = [
  { value: 'basic', label: 'Common' },
  { value: 'all', label: 'All settings' },
] as const

/** Every KOReader setting the app can change, in eight areas, each with a plain "?" explanation. */
export function KoboSettingsCard() {
  const s = useKoboSettings()
  const [params, setParams] = useSearchParams()
  const areaId = AREAS.some(a => a.id === params.get('area')) ? params.get('area') as AreaId : null
  const openArea = (id: AreaId | null) => setParams(p => { if (id) p.set('area', id); else p.delete('area'); return p }, { replace: false })
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>('basic')
  const [changedOnly, setChangedOnly] = useState(false)
  const isChanged = s.isChanged
  const areas = useMemo(() => summarizeAreas(SETTING_GROUPS, { query, level, changedOnly }, isChanged),
    [query, level, changedOnly, isChanged])
  const changedTotal = areas.reduce((t, a) => t + a.changed, 0)
  const searching = query.trim() !== ''
  const area = areaId ? areas.find(a => a.area.id === areaId) ?? null : null

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] max-w-md flex-1">
            <span className="sr-only">Search settings</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search, e.g. “font size” or “battery”" className="input min-h-[44px] w-full pl-9" />
          </label>
          <SegmentedControl size="sm" options={[...LEVELS]} value={level} onChange={v => setLevel(v as LevelFilter)} />
          <button type="button" aria-pressed={changedOnly} onClick={() => setChangedOnly(v => !v)} className="pill-tab shrink-0">
            Changed by me <span className="tabular-nums opacity-70">{changedTotal}</span>
          </button>
        </div>
        <p className="text-meta text-fg-muted">
          {level === 'basic'
            ? 'Showing the settings most readers change. Choose “All settings” to see every one.'
            : 'Showing every setting, including the technical ones.'}
          {' '}Tap <span className="font-semibold text-fg-2">?</span> next to a setting to see what it does. Changes reach the Kobo at its next sync.
        </p>
        {!s.hasReport && (
          <p className="text-meta text-fg-muted">The Kobo has not reported its current values yet; they appear after its next sync.</p>
        )}
      </Card>

      {searching || changedOnly ? (
        <Results areas={areas} s={s} empty={searching ? `No setting matches “${query}”.` : 'You have not changed any setting yet.'} />
      ) : area ? (
        <AreaView summary={area} s={s} onBack={() => openArea(null)} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 @container sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
          {areas.map(a => (
            <li key={a.area.id}><AreaCard summary={a} onOpen={() => openArea(a.area.id)} /></li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Settings = ReturnType<typeof useKoboSettings>

function AreaIcon({ id, color, size = 'md' }: { id: AreaId; color: number; size?: 'md' | 'lg' }) {
  const Icon = AREA_ICON[id]
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-control', size === 'lg' ? 'h-11 w-11' : 'h-10 w-10')}
      style={{ background: tint(color, 0.14), color: tint(color) }}>
      <Icon className={size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'} />
    </span>
  )
}

function AreaCard({ summary, onOpen }: { summary: AreaSummary; onOpen: () => void }) {
  const { area, shown, total, changed } = summary
  return (
    <Card as="button" type="button" interactive onClick={onOpen} className="flex h-full w-full flex-col gap-2"
      style={{ borderTopColor: tint(area.color), borderTopWidth: 3 }}>
      <div className="flex items-center gap-3">
        <AreaIcon id={area.id} color={area.color} />
        <span className="flex-1 text-lead font-semibold text-fg">{area.title}</span>
        <ChevronRight aria-hidden className="h-5 w-5 text-fg-faint" />
      </div>
      <p className="text-meta text-fg-2">{area.summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-micro text-fg-muted">
        <span className="tabular-nums">{shown === total ? `${total} settings` : `${shown} common · ${total} in all`}</span>
        {changed > 0 && <TonePill tone="info">{changed} changed</TonePill>}
      </div>
    </Card>
  )
}

function AreaView({ summary, s, onBack }: { summary: AreaSummary; s: Settings; onBack: () => void }) {
  const { area } = summary
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3" style={{ borderTopColor: tint(area.color), borderTopWidth: 3 }}>
        <button type="button" onClick={onBack} className="flex min-h-[44px] items-center gap-1.5 self-start text-meta font-semibold text-accent-600">
          <ArrowLeft className="h-4 w-4" aria-hidden /> All settings
        </button>
        <div className="flex items-start gap-3">
          <AreaIcon id={area.id} color={area.color} size="lg" />
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-fg">{area.title}</h2>
            <p className="text-meta text-fg-2">{area.summary}</p>
          </div>
        </div>
      </Card>
      {summary.groups.length === 0
        ? <Card><EmptyState icon={<Search />} title="Nothing to show here" description="Choose “All settings” to see the technical ones too." /></Card>
        : summary.groups.map(({ group, settings }) => <GroupCard key={group.id} group={group} keys={settings.map(d => d.key)} s={s} color={area.color} />)}
    </div>
  )
}

function Results({ areas, s, empty }: { areas: AreaSummary[]; s: Settings; empty: string }) {
  const hits = areas.flatMap(a => a.groups.map(g => ({ area: a.area, ...g })))
  if (hits.length === 0) return <Card><EmptyState icon={<Search />} title="Nothing found" description={empty} /></Card>
  return (
    <div className="flex flex-col gap-4">
      {hits.map(h => <GroupCard key={h.group.id} group={h.group} keys={h.settings.map(d => d.key)} s={s} color={h.area.color} areaTitle={h.area.title} showInapplicable />)}
    </div>
  )
}
