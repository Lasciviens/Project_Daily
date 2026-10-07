// A platform page's console-and-controller photo, beside the heading, with
// the year the console first came out.
// Photos from Wikimedia Commons — most by Evan-Amos (Vanamo Online Game
// Museum, public domain); each file's source, author and licence are in
// assets/consoles/manifest.json, and the credit line is read from there.
// Bundled as small transparent WebP cut-outs (background removed) that load
// only when their platform page is opened, so they sit on the page's own colour.
const PHOTOS = import.meta.glob<string>('../assets/consoles/*.webp', { eager: true, query: '?url', import: 'default' })

// `subject` names what the photo shows when it isn't the platform's own console.
type PhotoCredit = { author: string; license: string; subject?: string }
const MANIFEST = Object.values(
  import.meta.glob<Record<string, PhotoCredit>>('../assets/consoles/manifest.json', { eager: true, import: 'default' }),
)[0] ?? {}

// Platform keys that show another key's photo (the same hardware, or the
// closest picture for a library/arcade shelf with no console of its own).
const SAME_AS: Record<string, string> = { snesna: 'snes', megadrive: 'genesis', mame: 'arcade', fbneo: 'arcade' }

function creditOf(key: string): string {
  const c = MANIFEST[key]
  return c ? `Photo: ${c.author}, ${c.license} (Wikimedia Commons)` : 'Photo: Wikimedia Commons'
}

/** The first release anywhere (usually Japan) — a fixed fact per console. */
const RELEASE_YEAR: Record<string, number> = {
  nes: 1983, snes: 1990, n64: 1996, gc: 2001, wii: 2006, wiiu: 2012, switch: 2017,
  gb: 1989, gbc: 1998, gba: 2001, nds: 2004, n3ds: 2011,
  genesis: 1988, segacd: 1991, saturn: 1994, dreamcast: 1998,
  psx: 1994, ps2: 2000, ps3: 2006, psp: 2004, psvita: 2011,
  xbox: 2001, xbox360: 2005,
  steam: 2003,
}

export function TgConsolePhoto({ platformKey, name }: { platformKey: string; name: string }) {
  const key = SAME_AS[platformKey] ?? platformKey
  const url = PHOTOS[`../assets/consoles/${key}.webp`]
  const year = RELEASE_YEAR[key]
  if (!url && !year) return null
  return (
    <figure className="hidden shrink-0 items-center gap-2 md:flex">
      {url && (
        <img
          src={url}
          alt={`${MANIFEST[key]?.subject ?? `${name} console`}${year ? `, released ${year}` : ''}`}
          title={creditOf(key)}
          loading="lazy"
          decoding="async"
          className="h-[72px] w-auto max-w-[190px] object-contain"
        />
      )}
      {year && (
        <figcaption className="text-[11px] leading-4 text-[var(--tg-muted)]">
          Released<br /><span className="text-[15px] font-semibold tabular-nums text-[var(--tg-text)]">{year}</span>
        </figcaption>
      )}
    </figure>
  )
}
