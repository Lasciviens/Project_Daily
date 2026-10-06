// When a KOReader setting matters at all — pure, verified by
// scripts/verify-kobo-settings.cjs. A setting that only applies in some mode
// (fixed times only when warmth follows fixed times, the location only when it
// follows the sun…) is hidden while it does not apply, the way KOReader's own
// menu greys it out. Every rule is read from KOReader v2026.07.1's source.

export type RuleValue = boolean | number | string | (number | null)[] | null | undefined

interface Condition {
  key: string
  /** The setting's current value is one of these… */
  in?: (boolean | number | string)[]
  /** …or above this number. */
  above?: number
}

interface Rule {
  /** Every condition must hold. */
  when: Condition[]
  /** Shown where the setting is listed while it does not apply. */
  note: string
  source: string
}

const AW = 'autowarmth_activate'
const AW_ON = [1, 2, 3, 4]
const awOn = { key: AW, in: AW_ON }

export const SETTING_RULES: Record<string, Rule> = {
  // AutoWarmth: what each mode reads (plugins/autowarmth.koplugin/main.lua:348-372).
  autowarmth_scheduler_times: { when: [{ key: AW, in: [2, 3, 4] }], note: 'Used only when warmth changes by fixed times (or a mix).', source: 'plugins/autowarmth.koplugin/main.lua:351' },
  autowarmth_location: { when: [{ key: AW, in: [1, 3, 4] }], note: 'Used only when warmth follows sunrise and sunset (or a mix).', source: 'plugins/autowarmth.koplugin/main.lua:313' },
  autowarmth_latitude: { when: [{ key: AW, in: [1, 3, 4] }], note: 'Used only when warmth follows sunrise and sunset (or a mix).', source: 'plugins/autowarmth.koplugin/main.lua:313' },
  autowarmth_longitude: { when: [{ key: AW, in: [1, 3, 4] }], note: 'Used only when warmth follows sunrise and sunset (or a mix).', source: 'plugins/autowarmth.koplugin/main.lua:313' },
  autowarmth_altitude: { when: [{ key: AW, in: [1, 3, 4] }], note: 'Used only when warmth follows sunrise and sunset (or a mix).', source: 'plugins/autowarmth.koplugin/main.lua:313' },
  autowarmth_timezone: { when: [{ key: AW, in: [1, 3, 4] }], note: 'Used only when warmth follows sunrise and sunset (or a mix).', source: 'plugins/autowarmth.koplugin/main.lua:313' },
  autowarmth_easy_mode: { when: [awOn], note: 'Used only while warmth changes by time.', source: 'plugins/autowarmth.koplugin/main.lua:375' },
  autowarmth_warmth: { when: [awOn], note: 'Used only while warmth changes by time.', source: 'plugins/autowarmth.koplugin/main.lua:327' },
  autowarmth_control_warmth: { when: [awOn], note: 'Used only while warmth changes by time.', source: 'plugins/autowarmth.koplugin/main.lua:327' },
  autowarmth_control_nightmode: { when: [awOn], note: 'Used only while warmth changes by time.', source: 'plugins/autowarmth.koplugin/main.lua:327' },
  autowarmth_hide_nightmode_warning: { when: [awOn, { key: 'autowarmth_control_nightmode', in: [true] }], note: 'Used only while the schedule switches night mode.', source: 'plugins/autowarmth.koplugin/main.lua:228' },
  autowarmth_fl_off_during_day: { when: [awOn], note: 'Used only while warmth changes by time.', source: 'plugins/autowarmth.koplugin/main.lua:327' },
  // The offset is forced to 0 in Simple mode (main.lua:92-94).
  autowarmth_fl_off_during_day_offset_s: {
    when: [awOn, { key: 'autowarmth_fl_off_during_day', in: [true] }, { key: 'autowarmth_easy_mode', in: [false] }],
    note: 'Used only with “Light off in daytime” on and Simple mode off.', source: 'plugins/autowarmth.koplugin/main.lua:92',
  },
  // Automatic dimmer: off while the start time is -1 (plugins/autodim.koplugin/main.lua:35).
  autodim_duration_seconds: { when: [{ key: 'autodim_starttime_minutes', above: 0 }], note: 'Used only while the light dims by itself.', source: 'plugins/autodim.koplugin/main.lua:35' },
  autodim_fraction: { when: [{ key: 'autodim_starttime_minutes', above: 0 }], note: 'Used only while the light dims by itself.', source: 'plugins/autodim.koplugin/main.lua:35' },
  // Sleep screen (frontend/ui/elements/screensaver_menu.lua, screensaver.lua).
  screensaver_stretch_limit_percentage: { when: [{ key: 'screensaver_stretch_images', in: [true] }], note: 'Used only while pictures are stretched.', source: 'frontend/ui/elements/screensaver_menu.lua:122' },
  screensaver_extra_flash_delay: { when: [{ key: 'screensaver_extra_flash_count', above: 0 }], note: 'Used only with extra cleaning flashes.', source: 'frontend/ui/screensaver.lua:671' },
  screensaver_show_exit_message: { when: [{ key: 'screensaver_delay', in: ['gesture'] }], note: 'Used only when the sleep screen stays until the exit gesture.', source: 'frontend/ui/elements/screensaver_menu.lua:151' },
  screensaver_exit_message: { when: [{ key: 'screensaver_delay', in: ['gesture'] }, { key: 'screensaver_show_exit_message', in: [true] }], note: 'Used only when the sleep screen stays until the exit gesture and the hint is shown.', source: 'frontend/ui/elements/screensaver_menu.lua:163' },
  // Battery and memory warnings (frontend/apps/reader/modules/readerdevicestatus.lua).
  device_status_battery_interval_minutes: { when: [{ key: 'device_status_battery_alarm', in: [true] }], note: 'Used only while the battery warning is on.', source: 'frontend/apps/reader/modules/readerdevicestatus.lua:150' },
  device_status_battery_threshold: { when: [{ key: 'device_status_battery_alarm', in: [true] }], note: 'Used only while the battery warning is on.', source: 'frontend/apps/reader/modules/readerdevicestatus.lua:181' },
  device_status_battery_threshold_high: { when: [{ key: 'device_status_battery_alarm', in: [true] }], note: 'Used only while the battery warning is on.', source: 'frontend/apps/reader/modules/readerdevicestatus.lua:181' },
  device_status_memory_interval_minutes: { when: [{ key: 'device_status_memory_alarm', in: [true] }], note: 'Used only while the memory warning is on.', source: 'frontend/apps/reader/modules/readerdevicestatus.lua:241' },
  device_status_memory_threshold: { when: [{ key: 'device_status_memory_alarm', in: [true] }], note: 'Used only while the memory warning is on.', source: 'frontend/apps/reader/modules/readerdevicestatus.lua:271' },
  device_status_memory_auto_restart: { when: [{ key: 'device_status_memory_alarm', in: [true] }], note: 'Used only while the memory warning is on.', source: 'frontend/apps/reader/modules/readerdevicestatus.lua:296' },
}

/** True when the setting matters with the current values (`valueOf` gives what the Kobo uses or will use). */
export function settingApplies(key: string, valueOf: (key: string) => RuleValue): boolean {
  const rule = SETTING_RULES[key]
  if (!rule) return true
  return rule.when.every(c => {
    const v = valueOf(c.key)
    if (c.in) return c.in.some(x => x === v)
    if (c.above !== undefined) return typeof v === 'number' && v > c.above
    return true
  })
}

/** Why a setting is hidden right now, or null when it applies. */
export function ruleNote(key: string, valueOf: (key: string) => RuleValue): string | null {
  return settingApplies(key, valueOf) ? null : SETTING_RULES[key]?.note ?? null
}
