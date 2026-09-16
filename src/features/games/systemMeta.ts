// Display metadata for the `game_platforms.system` string.
//
// The values are ES-DE's own folder names (`snes`, `genesis`, `psx`, …) — fine
// as a key, unreadable as a label on a card. This maps the 24 systems the real
// library actually contains to a short name plus a family colour, so a card can
// say "SNES" in Nintendo red rather than printing the raw folder name.
//
// Free text on the DB side (089), so an unknown value is expected, not a bug:
// `systemMeta` falls back to the uppercased key in a neutral colour. Adding a
// system here is display-only — nothing validates against this map.

export type SystemMeta = { label: string; chip: string }

const FAMILY = {
  nintendo: 'bg-red-500/90 text-white',
  sega:     'bg-blue-600/90 text-white',
  sony:     'bg-slate-700/90 text-white',
  ms:       'bg-green-600/90 text-white',
  pc:       'bg-indigo-600/90 text-white',
  arcade:   'bg-amber-600/90 text-white',
  other:    'bg-ink-600/90 text-white',
} as const

const SYSTEMS: Record<string, SystemMeta> = {
  nes:          { label: 'NES',       chip: FAMILY.nintendo },
  snes:         { label: 'SNES',      chip: FAMILY.nintendo },
  snesna:       { label: 'SNES',      chip: FAMILY.nintendo },
  n64:          { label: 'N64',       chip: FAMILY.nintendo },
  gc:           { label: 'GameCube',  chip: FAMILY.nintendo },
  wii:          { label: 'Wii',       chip: FAMILY.nintendo },
  wiiu:         { label: 'Wii U',     chip: FAMILY.nintendo },
  switch:       { label: 'Switch',    chip: FAMILY.nintendo },
  gba:          { label: 'GBA',       chip: FAMILY.nintendo },
  nds:          { label: 'DS',        chip: FAMILY.nintendo },
  n3ds:         { label: '3DS',       chip: FAMILY.nintendo },
  genesis:      { label: 'Genesis',   chip: FAMILY.sega },
  megadrive:    { label: 'Mega Drive',chip: FAMILY.sega },
  segacd:       { label: 'Sega CD',   chip: FAMILY.sega },
  saturn:       { label: 'Saturn',    chip: FAMILY.sega },
  dreamcast:    { label: 'Dreamcast', chip: FAMILY.sega },
  psx:          { label: 'PS1',       chip: FAMILY.sony },
  ps2:          { label: 'PS2',       chip: FAMILY.sony },
  psp:          { label: 'PSP',       chip: FAMILY.sony },
  xbox360:      { label: 'Xbox 360',  chip: FAMILY.ms },
  steam:        { label: 'Steam',     chip: FAMILY.pc },
  androidapps:  { label: 'Android',   chip: FAMILY.pc },
  androidgames: { label: 'Android',   chip: FAMILY.pc },
  fbneo:        { label: 'Arcade',    chip: FAMILY.arcade },
  emulators:    { label: 'Emulator',  chip: FAMILY.other },
}

export function systemMeta(system: string | null | undefined): SystemMeta {
  const key = (system ?? '').trim().toLowerCase()
  return SYSTEMS[key] ?? { label: (system ?? '—').toUpperCase(), chip: FAMILY.other }
}
