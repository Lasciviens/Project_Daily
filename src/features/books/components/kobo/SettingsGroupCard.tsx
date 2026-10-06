import { Card } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import type { SettingGroup } from '../../koboSettingsCatalogue'
import { tint } from '../../kobo/settingsAreas'
import { ruleNote } from '../../kobo/settingRules'
import { SettingControl } from './SettingControl'
import type { useKoboSettings } from './useKoboSetting'

type Settings = ReturnType<typeof useKoboSettings>

/**
 * One section of an area: its title, what it affects, and its settings in one or
 * two columns. A setting that does not apply with the current choices (fixed
 * times while warmth follows the sun…) is hidden, or — in search results
 * (`showInapplicable`) — shown with a line saying when it applies.
 */
export function GroupCard({ group, keys, s, color, areaTitle, showInapplicable }: {
  group: SettingGroup; keys?: string[]; s: Settings; color: number; areaTitle?: string; showInapplicable?: boolean
}) {
  const listed = group.settings.filter(d => !d.managed && (!keys || keys.includes(d.key)))
  const notes = new Map(listed.map(d => [d.key, ruleNote(d.key, s.valueOf)]))
  const defs = showInapplicable ? listed : listed.filter(d => !notes.get(d.key))
  const hidden = listed.length - defs.length
  const ctx = { valueOf: s.valueOf, fonts: s.fonts }
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
              <SettingControl def={d} view={view} disabled={s.loading} onChange={v => s.set(d.key, v)} ctx={ctx} note={notes.get(d.key)} />
            </div>
          )
        })}
      </div></div>
      {hidden > 0 && (
        <p className="mt-2 text-micro text-fg-muted">
          {hidden === 1 ? '1 more setting appears' : `${hidden} more settings appear`} when a choice above needs them.
        </p>
      )}
    </Card>
  )
}

