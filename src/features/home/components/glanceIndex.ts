// Which screen each glance tile was left on (this device only — a convenience,
// so it may come back empty: private mode, cleared site data).

const STORE = 'lasci.glance.'

/** The screen a tile was left on (a tap can act on what is showing). */
export function readGlanceIndex(id: string): number {
  try { return Math.max(0, Number(localStorage.getItem(STORE + id)) || 0) } catch { return 0 }
}

export function saveGlanceIndex(id: string, i: number) {
  try { localStorage.setItem(STORE + id, String(i)) } catch { /* only a convenience */ }
}
