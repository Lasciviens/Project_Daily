// A platform page's console-and-controller photo, beside the heading.
// Photos: Evan-Amos (Vanamo Online Game Museum), public domain, via Wikimedia
// Commons — sources in assets/consoles/manifest.json. Bundled as small WebP
// files that load only when their platform page is opened.
// A cut-out PNG (transparent background) wins over the WebP photo and is
// drawn without the white mat the photos (shot on white) need.
const PHOTOS = import.meta.glob<string>('../assets/consoles/*.{webp,png}', { eager: true, query: '?url', import: 'default' })

// Platform keys that show another key's photo (the same hardware).
const SAME_AS: Record<string, string> = { snesna: 'snes', megadrive: 'genesis' }

function consolePhoto(platformKey: string): { url: string; cutout: boolean } | null {
  const key = SAME_AS[platformKey] ?? platformKey
  const png = PHOTOS[`../assets/consoles/${key}.png`]
  if (png) return { url: png, cutout: true }
  const webp = PHOTOS[`../assets/consoles/${key}.webp`]
  return webp ? { url: webp, cutout: false } : null
}

export function TgConsolePhoto({ platformKey, name }: { platformKey: string; name: string }) {
  const photo = consolePhoto(platformKey)
  if (!photo) return null
  return (
    <img
      src={photo.url}
      alt={`${name} console and controller`}
      title={photo.cutout ? undefined : 'Photo: Evan-Amos, public domain (Wikimedia Commons)'}
      loading="lazy"
      decoding="async"
      className={`${photo.cutout ? '' : 'tg-console-photo '}hidden h-[72px] w-auto max-w-[190px] shrink-0 object-contain md:block`}
    />
  )
}
