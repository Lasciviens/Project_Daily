import type { PlatformFamily } from '../testGameModel'

// Drawing data for platformArt.tsx, kept in a .ts file so the component file
// only exports components (react-refresh).

// ─── Platform icons (24×24) ──────────────────────────────────────────────────
// Stroked line glyphs, except the three brand marks the design draws solid
// (PlayStation, Xbox, GameCube), which are filled shapes.

export type GlyphPart =
  | { d: string }
  /** circle: cx, cy, r */
  | { c: [number, number, number] }
  /** rect: x, y, width, height, rx */
  | { r: [number, number, number, number, number] }
  /** A filled (unstroked) path; `s` scales it about the centre so a full-bleed
   *  mark sits in the same box as the stroked glyphs. */
  | { f: string; s?: number }

// PlayStation and Xbox marks: Simple Icons (CC0) outlines.
const PS_MARK = 'M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.499v-2.385l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.029 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.206 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z'
const XBOX_MARK = 'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z'
const MARK_SCALE = 0.86

export const PLATFORM_GLYPHS: Record<PlatformFamily, GlyphPart[]> = {
  playstation: [{ f: PS_MARK, s: MARK_SCALE }],
  psp: [
    { r: [1.8, 7, 20.4, 10, 5] },
    { r: [7, 9.3, 10, 5.4, 0.8] },
    { d: 'M4.3 12h1.2M18.5 12h1.2' },
  ],
  // A solid isometric cube: its three faces, each inset so a hairline gap parts them.
  gamecube: [
    { f: 'M12 3.36 18.72 7.25 12 11.15 5.28 7.25Z', s: 1.12 },
    { f: 'M4.54 8.53 11.26 12.43v7.79L4.54 16.32Z', s: 1.12 },
    { f: 'M12.74 12.43 19.46 8.53v7.79l-6.72 3.9Z', s: 1.12 },
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
  xbox: [{ f: XBOX_MARK, s: MARK_SCALE }],
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
