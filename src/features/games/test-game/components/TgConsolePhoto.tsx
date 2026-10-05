// A platform page's console-and-controller photo, beside the heading, with
// the year the console first came out.
// Photos: Evan-Amos (Vanamo Online Game Museum), public domain, via Wikimedia
// Commons — sources in assets/consoles/manifest.json. Bundled as small
// transparent WebP cut-outs (background removed, 05.10.2026) that load only
// when their platform page is opened, so they sit on the page's own colour.
const PHOTOS = import.meta.glob<string>('../assets/consoles/*.webp', { eager: true, query: '?url', import: 'default' })

// Platform keys that show another key's photo (the same hardware).
const SAME_AS: Record<string, string> = { snesna: 'snes', megadrive: 'genesis' }

/** The first release anywhere (usually Japan) — a fixed fact per console. */
const RELEASE_YEAR: Record<string, number> = {
  nes: 1983, snes: 1990, n64: 1996, gc: 2001, wii: 2006, wiiu: 2012, switch: 2017,
  gb: 1989, gbc: 1998, gba: 2001, nds: 2004, n3ds: 2011,
  genesis: 1988, segacd: 1991, saturn: 1994, dreamcast: 1998,
  psx: 1994, ps2: 2000, ps3: 2006, psp: 2004, psvita: 2011,
  xbox: 2001, xbox360: 2005,
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
          alt={`${name} console${year ? `, released ${year}` : ''}`}
          title="Photo: Evan-Amos, public domain (Wikimedia Commons)"
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
