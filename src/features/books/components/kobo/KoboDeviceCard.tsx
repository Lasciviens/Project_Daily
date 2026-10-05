import { BatteryCharging, BatteryLow, BatteryMedium, Tablet } from 'lucide-react'
import { Card, CardHeader, TonePill } from '../../../../shared/ui'
import { formatDateTime } from '../../../../shared/utils/dateFormat'
import { useKoboFeedState } from '../../hooks/useBooks'
import { useKoboConfig, useKoboDeviceState } from '../../hooks/useKoboControl'

/** The Kobo as the app last heard from it, and whether it has the latest changes. */
export function KoboDeviceCard() {
  const state = useKoboFeedState()
  const config = useKoboConfig()
  const device = useKoboDeviceState()
  const s = state.data
  const rev = config.data?.rev ?? null
  const applied = device.data?.applied_rev ?? null
  const refused = Object.keys(device.data?.apply_result?.refused ?? {})
  const battery = s?.battery
  const BatteryIcon = s?.charging ? BatteryCharging : (battery ?? 100) <= 20 ? BatteryLow : BatteryMedium
  return (
    <Card>
      <CardHeader title="Your Kobo" icon={<Tablet />} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-meta">
        <dt className="text-fg-muted">Last sync</dt>
        <dd className="text-fg">{s?.last_sync_at ? formatDateTime(s.last_sync_at) : 'Not yet'}</dd>
        {battery != null && (<>
          <dt className="text-fg-muted">Battery</dt>
          <dd className="flex items-center gap-1.5 text-fg tabular-nums">
            <BatteryIcon aria-hidden className="h-4 w-4" />{battery}%{s?.charging ? ' · charging' : ''}
            {battery <= 20 && !s?.charging && <TonePill tone="warn">Charge it</TonePill>}
            <span className="text-micro text-fg-muted">at last sync</span>
          </dd>
        </>)}
        {s?.koreader_version && (<><dt className="text-fg-muted">KOReader</dt><dd className="text-fg">{s.koreader_version}</dd></>)}
        {s?.plugin_version && (<><dt className="text-fg-muted">Plugin</dt><dd className="text-fg">{s.plugin_version}</dd></>)}
        <dt className="text-fg-muted">Your changes</dt>
        <dd className="text-fg">
          {rev == null ? 'None yet'
            : applied === rev ? `On the Kobo since ${device.data?.applied_at ? formatDateTime(device.data.applied_at) : '—'}`
              : <TonePill tone="warn">Waiting for the next sync</TonePill>}
        </dd>
      </dl>
      {refused.length > 0 && (
        <p className="mt-2 text-micro text-danger">The Kobo refused: {refused.join(', ')}.</p>
      )}
      <p className="mt-3 text-micro text-fg-muted">
        The Kobo picks up changes whenever its Wi-Fi comes on (or Lasci's Board → Sync now). Menu order needs a KOReader restart; the Kobo offers it.
      </p>
    </Card>
  )
}
