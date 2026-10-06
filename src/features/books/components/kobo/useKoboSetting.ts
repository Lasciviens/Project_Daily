import { useCallback, useMemo } from 'react'
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
  /** The owner set a value in the app (a reset is stored as null and does not count). */
  const isChanged = useCallback((key: string) => {
    const v = wanted?.[key]
    return v !== undefined && v !== null
  }, [wanted])
  /** The value the Kobo uses, or will use once it syncs (for the "only applies when…" rules). */
  const valueOf = useCallback((key: string): Value | undefined => {
    const def = index.get(key)
    return def ? settingView(def, wanted, reported).value : undefined
  }, [index, wanted, reported])
  return {
    loading: config.isLoading,
    view: (key: string) => {
      const def = index.get(key)
      return def ? settingView(def, wanted, reported) : null
    },
    valueOf,
    /** The fonts the Kobo reported (plugin 1.3), or null before it has. */
    fonts: device.data?.report?.fonts ?? null,
    def: (key: string) => index.get(key) ?? null,
    set: (key: string, value: Value) => save.mutate(settingPatch(config.data, key, value)),
    isChanged,
    saving: save.isPending,
    hasReport: !!device.data?.report,
  }
}
