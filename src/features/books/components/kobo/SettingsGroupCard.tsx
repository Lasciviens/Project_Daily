import { Card } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import type { SettingGroup } from '../../koboSettingsCatalogue'
import { tint } from '../../kobo/settingsAreas'
import { SettingControl } from './SettingControl'
import type { useKoboSettings } from './useKoboSetting'

type Settings = ReturnType<typeof useKoboSettings>

/** One section of an area: its title, what it affects, and its settings in one or two columns. */
export function GroupCard({ group, keys, s, color, areaTitle }: { group: SettingGroup; keys?: string[]; s: Settings; color: number; areaTitle?: string }) {
  const defs = group.settings.filter(d => !d.managed && (!keys || keys.includes(d.key)))
  return (
    <Card>
      <div className="mb-1 flex items-start gap-2 border-b border-line pb-3">
        <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint(color) }} />
        <div className="min-w-0 flex-1">
          {areaTitle && <p className="text-micro font-semibold uppercase tracking-wide text-fg-muted">{areaTitle}</p>}
          <div className="flex items-center gap-2">
            <h3 className="text-body font-semibold text-fg">{group.label}</h3>
            <HelpTip label={`About ${group.label}`}>
              <p className="mb-1 font-semibold text-fg">{group.label}</p>
              <p>{group.summary}</p>
              <p className="mt-2"><span className="font-semibold text-fg">You will notice: </span>{group.affects}</p>
            </HelpTip>
          </div>
          <p className="text-meta text-fg-muted">{group.summary}</p>
        </div>
        <span className="shrink-0 text-micro tabular-nums text-fg-muted">{defs.length}</span>
      </div>
      <div className="@container"><div className="grid grid-cols-1 gap-x-8 @[52rem]:grid-cols-2">
        {defs.map(d => {
          const view = s.view(d.key)
          return view && (
            <div key={d.key} className="border-b border-line last:border-b-0 @[52rem]:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
              <SettingControl def={d} view={view} disabled={s.loading} onChange={v => s.set(d.key, v)} />
            </div>
          )
        })}
      </div></div>
    </Card>
  )
}

