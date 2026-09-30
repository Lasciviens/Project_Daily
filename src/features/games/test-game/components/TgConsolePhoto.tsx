// A platform page's console-and-controller photo, beside the heading.
// Photos: Evan-Amos (Vanamo Online Game Museum), public domain, via Wikimedia
// Commons — sources in assets/consoles/manifest.json. Bundled as small WebP
// files that load only when their platform page is opened.
const PHOTOS = import.meta.glob<string>('../assets/consoles/*.webp', { eager: true, query: '?url', import: 'default' })

// Platform keys that show another key's photo (the same hardware).
const SAME_AS: Record<string, string> = { snesna: 'snes', megadrive: 'genesis' }

function consolePhotoUrl(platformKey: string): string | null {
  const key = SAME_AS[platformKey] ?? platformKey
  return PHOTOS[`../assets/consoles/${key}.webp`] ?? null
}

export function TgConsolePhoto({ platformKey, name }: { platformKey: string; name: string }) {
  const url = consolePhotoUrl(platformKey)
  if (!url) return null
  return (
    <img
      src={url}
      alt={`${name} console and controller`}
      title="Photo: Evan-Amos, public domain (Wikimedia Commons)"
      loading="lazy"
      decoding="async"
      className="tg-console-photo hidden h-[72px] w-auto max-w-[190px] shrink-0 object-contain md:block"
    />
  )
}
