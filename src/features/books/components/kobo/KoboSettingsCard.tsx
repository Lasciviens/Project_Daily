import { useMemo, useState } from 'react'
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react'
import { Card, CardHeader, cx } from '../../../../shared/ui'
import { SETTING_GROUPS } from '../../koboSettingsCatalogue'
import { matchesSetting } from '../../kobo/settingsView'
import { SettingControl } from './SettingControl'
import { useKoboSettings } from './useKoboSetting'

/** Groups the sleep screen card already shows. */
const SHOWN_ELSEWHERE = new Set(['sleep_screen', 'bookshelf'])

/** Every other KOReader setting the app can change, grouped as on the Kobo, with a search. */
export function KoboSettingsCard() {
  const s = useKoboSettings()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const groups = useMemo(() => SETTING_GROUPS
    .filter(g => !SHOWN_ELSEWHERE.has(g.id))
    .map(g => ({ ...g, settings: g.settings.filter(d => !d.managed && matchesSetting(d, query)) }))
    .filter(g => g.settings.length > 0), [query])
  const searching = query.trim() !== ''
  return (
    <Card>
      <CardHeader title="KOReader settings" icon={<SlidersHorizontal />}
        subtitle="Changed here, applied by the Kobo at its next sync. Reset goes back to KOReader's own default." wrap />
      <label className="relative mb-2 block max-w-md">
        <span className="sr-only">Search settings</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings" className="input min-h-[44px] w-full pl-9" />
      </label>
      {!s.hasReport && (
        <p className="mb-2 text-meta text-fg-muted">The Kobo has not reported its values yet — they appear after its first sync with plugin 1.1.</p>
      )}
      {groups.length === 0 && <p className="text-meta text-fg-muted">No setting matches “{query}”.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {groups.map(g => {
          const expanded = searching || open === g.id
          const changed = g.settings.filter(d => s.view(d.key)?.changed).length
          return (
            <li key={g.id}>
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(o => (o === g.id ? null : g.id))}
                className="flex min-h-[44px] w-full items-center gap-2 text-left">
                <span className="flex-1 text-body font-semibold text-fg">{g.label}</span>
                <span className="text-micro tabular-nums text-fg-muted">
                  {changed > 0 ? `${changed} changed · ` : ''}{g.settings.length}
                </span>
                <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-muted transition-transform', expanded && 'rotate-180')} />
              </button>
              {expanded && (
                <div className="divide-y divide-line pb-2">
                  {g.settings.map(d => {
                    const view = s.view(d.key)
                    return view && <SettingControl key={d.key} def={d} view={view} disabled={s.loading} onChange={v => s.set(d.key, v)} />
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
