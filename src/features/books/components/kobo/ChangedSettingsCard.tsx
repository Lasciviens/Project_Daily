import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, TonePill, Truncate } from '../../../../shared/ui'
import { HelpTip } from '../../../../shared/components/HelpTip'
import { useEntityModal } from '../../../../shared/modals'
import { SETTING_GROUPS } from '../../koboSettingsCatalogue'
import { formatValue } from '../../kobo/settingsView'
import { SettingHelp } from './SettingControl'
import { useKoboSettings } from './useKoboSetting'

const ALL = SETTING_GROUPS.flatMap(g => g.settings)

/** Everything you changed from the app, and whether the Kobo has it yet. */
export function ChangedSettingsCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const s = useKoboSettings()
  const modal = useEntityModal()
  const changed = ALL.filter(d => s.isChanged(d.key))
  return (
    <Card>
      <CardHeader title="Your changes" icon={<SlidersHorizontal />}
        subtitle={changed.length ? `${changed.length} ${changed.length === 1 ? 'setting' : 'settings'} set from the app` : undefined}
        action={<Button size="sm" onClick={onOpenSettings}>Open settings</Button>} />
      {changed.length === 0 ? (
        <p className="text-meta text-fg-muted">Nothing changed from the app yet. Every KOReader setting is under Settings, each with a plain explanation.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {changed.map(d => {
            const v = s.view(d.key)
            return (
              <li key={d.key} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Truncate className="min-w-0 text-body font-medium text-fg">{d.label}</Truncate>
                    <HelpTip size="sm" label={`About “${d.label}”`}><SettingHelp def={d} /></HelpTip>
                  </div>
                  <p className="text-micro text-fg-muted">
                    {formatValue(d, v?.value ?? null)}{v?.pending ? ' · ' : ''}
                    {v?.pending && <TonePill tone="warn">Waiting for the Kobo</TonePill>}
                  </p>
                </div>
                <IconButton label={`Reset “${d.label}” to the default`}
                  onClick={async () => {
                    if (await modal.confirm({ title: `Reset “${d.label}”?`, message: `It goes back to KOReader’s default (${formatValue(d, d.absent)}) at the Kobo’s next sync.`, confirmLabel: 'Reset' })) s.set(d.key, null)
                  }}><RotateCcw /></IconButton>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
