import type { PlatformFamily } from '../testGameModel'

// Drawing data for platformArt.tsx, kept in a .ts file so the component file
// only exports components (react-refresh).

// ─── Platform icons (24×24, stroked) ─────────────────────────────────────────

export type GlyphPart =
  | { d: string }
  /** circle: cx, cy, r */
  | { c: [number, number, number] }
  /** rect: x, y, width, height, rx */
  | { r: [number, number, number, number, number] }

export const PLATFORM_GLYPHS: Record<PlatformFamily, GlyphPart[]> = {
  playstation: [
    { d: 'M9.2 20.3V3.6c4.6.9 8.3 2.1 8.3 5.6 0 3-2.3 3.4-4.4 2.7V6.9' },
    { d: 'M9.2 15.9 4.6 17.5c-1.7.6-1.4 1.7.5 1.9 1.3.1 2.7 0 4.1-.5' },
    { d: 'm13.1 16.6 4.9-1.7c1.9-.6 3.5.4 1.5 1.3l-6.4 2.3' },
  ],
  psp: [
    { r: [1.8, 7, 20.4, 10, 5] },
    { r: [7, 9.3, 10, 5.4, 0.8] },
    { d: 'M4.3 12h1.2M18.5 12h1.2' },
  ],
  gamecube: [
    { d: 'M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z' },
    { d: 'M4 7.4 12 12l8-4.6M12 12v9.2' },
    { d: 'M12 7.2 8.2 9.4M15.8 11.6v4.4' },
  ],
  switch: [
    { d: 'M10.5 3h-3A4.5 4.5 0 0 0 3 7.5v9A4.5 4.5 0 0 0 7.5 21h3Z' },
    { d: 'M13.5 3h3A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-3Z' },
    { c: [7.1, 8, 1.3] },
    { c: [16.9, 14.6, 1.3] },
  ],
  wii: [
    { d: 'M3.5 5v8.5a4 4 0 0 0 8 0V9m0 4.5a4 4 0 0 0 8 0V5' },
    { d: 'M20.5 9.5v5' },
  ],
  ds: [
    { r: [4.5, 2.5, 15, 8.5, 1.6] },
    { r: [4.5, 13, 15, 8.5, 1.6] },
    { r: [8, 15, 8, 4.5, 0.6] },
  ],
  xbox: [
    { c: [12, 12, 9] },
    { d: 'M7.5 6.8c2.4 1.7 3.9 3.3 4.5 5.2.6-1.9 2.1-3.5 4.5-5.2' },
    { d: 'M7 17.8c1.6-2.4 3.2-4.3 5-5.8 1.8 1.5 3.4 3.4 5 5.8' },
  ],
  steam: [
    { c: [12, 12, 9] },
    { c: [15.4, 9.6, 2.3] },
    { c: [9.2, 14.9, 1.7] },
    { d: 'm13.6 11.1-2.9 2.6M3.4 13.1l4.3 1.6' },
  ],
  nintendo: [
    { r: [2, 7, 20, 10, 3] },
    { d: 'M7 10v4M5 12h4' },
    { c: [15.6, 13.2, 1] },
    { c: [18.2, 10.8, 1] },
  ],
  gameboy: [
    { r: [5.5, 2, 13, 20, 2] },
    { r: [8, 4.5, 8, 6.5, 0.8] },
    { d: 'M9.2 14.6v3M7.7 16.1h3' },
    { c: [15.4, 17, 0.9] },
    { c: [16.6, 14.9, 0.9] },
  ],
  sega: [
    { d: 'M18.5 5.5H9a3.25 3.25 0 0 0 0 6.5h6a3.25 3.25 0 0 1 0 6.5H5.5' },
  ],
  arcade: [
    { r: [4, 15, 16, 5.5, 1.6] },
    { d: 'M12 15V9.6' },
    { c: [12, 6.6, 3] },
    { d: 'M16.4 17.75h.01' },
  ],
  android: [
    { r: [6.5, 2, 11, 20, 2.4] },
    { d: 'M10.5 5h3M11.4 18.6h1.2' },
  ],
  other: [
    { c: [12, 12, 9] },
    { d: 'M8 12h.01M12 12h.01M16 12h.01' },
  ],
}

// ─── Header wordmarks ────────────────────────────────────────────────────────

/**
 * The geometric line logo of the design's "PS2" header (viewBox 0 0 105 20):
 * P, S, then a third glyph. The PlayStation consoles whose real logos share
 * this family (PS1, PS2, PS3, PSP) are drawn the same way.
 */
export const PS_LINE_P = 'M2 18.5V8.4h30.5V1.5H1.2'
export const PS_LINE_S = 'M35 18.5h15V1.5h16'
export const PS_LINE_LAST: Record<string, string> = {
  psx: 'M81.5 1.5h7v17',
  ps2: 'M72.5 1.5H103v8.3H72.5v8.7H104',
  ps3: 'M72.5 1.5H103v17H72.5M78.5 9.8H103',
  psp: 'M73.4 18.5V8.4H103V1.5H72.6',
}

export interface TextWordmark {
  /** Small caps line above the name ("Nintendo"). */
  prefix?: string
  main: string
  /** Light-weight tail after the name ("360"). */
  suffix?: string
}

const TEXT_WORDMARKS: Record<string, TextWordmark> = {
  playstation:  { main: 'PlayStation', prefix: 'Network' },
  psvita:       { main: 'VITA', prefix: 'PlayStation' },
  gc:           { main: 'GAMECUBE', prefix: 'Nintendo' },
  wii:          { main: 'Wii' },
  wiiu:         { main: 'Wii', suffix: 'U' },
  switch:       { main: 'SWITCH', prefix: 'Nintendo' },
  n3ds:         { main: '3DS', prefix: 'Nintendo' },
  nds:          { main: 'DS', prefix: 'Nintendo' },
  n64:          { main: '64', prefix: 'Nintendo' },
  snes:         { main: 'SNES', prefix: 'Super Nintendo' },
  snesna:       { main: 'SNES', prefix: 'Super Nintendo' },
  nes:          { main: 'NES', prefix: 'Nintendo' },
  gba:          { main: 'ADVANCE', prefix: 'Game Boy' },
  gbc:          { main: 'COLOR', prefix: 'Game Boy' },
  gb:           { main: 'GAME BOY' },
  genesis:      { main: 'GENESIS', prefix: 'Sega' },
  megadrive:    { main: 'MEGA DRIVE', prefix: 'Sega' },
  segacd:       { main: 'SEGA', suffix: 'CD' },
  saturn:       { main: 'SATURN', prefix: 'Sega' },
  dreamcast:    { main: 'Dreamcast', prefix: 'Sega' },
  xbox:         { main: 'XBOX' },
  xbox360:      { main: 'XBOX', suffix: '360' },
  steam:        { main: 'STEAM' },
  fbneo:        { main: 'ARCADE', prefix: 'FinalBurn Neo' },
  mame:         { main: 'ARCADE', prefix: 'MAME' },
  androidapps:  { main: 'android', prefix: 'Apps' },
  androidgames: { main: 'android', prefix: 'Games' },
}

export function textWordmark(key: string, short: string): TextWordmark {
  return TEXT_WORDMARKS[key] ?? { main: short.toUpperCase() }
}

/** Longer names step down so every wordmark fits the header's logo box. */
export function wordmarkSizeClass(main: string): string {
  const n = main.length
  if (n <= 4) return 'text-[24px] tracking-[0.12em]'
  if (n <= 7) return 'text-[19px] tracking-[0.1em]'
  if (n <= 9) return 'text-[16px] tracking-[0.07em]'
  return 'text-[14px] tracking-[0.05em]'
}
