import { useMemo } from 'react'
import { useKoboConfig, useKoboDeviceState, useSaveKoboConfig, settingPatch } from '../../hooks/useKoboControl'
import { settingIndex } from '../../koboSettings'
import { settingView, type Value } from '../../kobo/settingsView'

/** Read and change KOReader settings from any card on the Kobo tab. */
export function useKoboSettings() {
  const config = useKoboConfig()
  const device = useKoboDeviceState()
  const save = useSaveKoboConfig()
  const index = useMemo(() => settingIndex(), [])
  const wanted = config.data?.settings
  const reported = device.data?.report?.settings
  return {
    loading: config.isLoading,
    view: (key: string) => {
      const def = index.get(key)
      return def ? settingView(def, wanted, reported) : null
    },
    def: (key: string) => index.get(key) ?? null,
    set: (key: string, value: Value | undefined) => save.mutate(settingPatch(config.data, key, value)),
    saving: save.isPending,
    hasReport: !!device.data?.report,
  }
}
