// How far down each phone list was scrolled, per list (section + filters).
// Module state, like a cache: written on scroll, read once when a list
// mounts, so a return to a section renders enough cards to land where it was.
const depth = new Map<string, number>()

export const rememberDepth = (listKey: string, top: number) => { depth.set(listKey, top) }
export const recalledDepth = (listKey: string) => depth.get(listKey) ?? 0
/** Cards to mount so a recalled depth is reachable (a two-card row is ~300px). */
export const cardsForDepth = (top: number) => (Math.ceil(top / 300) + 8) * 2
