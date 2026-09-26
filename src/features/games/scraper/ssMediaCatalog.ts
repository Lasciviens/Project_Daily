// The ScreenScraper media vocabulary: every type their API answers with, what
// it is called on screen, how it is grouped, and what the scraper does with
// it by default.
//
// Pure and import-free — the edge functions carry a hand-mirrored copy
// (supabase/functions/screenscraper-sync and screenscraper-media). **Change one,
// change the other**, and re-run scripts/verify-screenscraper-v2.cjs.
//
// Defaults are set by the storage budget, not by taste. The Free plan's 1 GB is
// a hard wall (a project over quota ends up answering 402 to EVERY request, not
// just Games), and 537 MB of it already holds ES-DE originals. So only what the
// app actually shows is copied, small — the cover, screenshot, title screen and
// fan art (library, hero, screenshot strip) and the HD logo (the variant's
// wheel_url) — and even those only when the copy will be used (ssPlan.ts
// decideMediaModes). Everything else is shown online through the signed proxy
// when looked at; composites and theme assets are skipped. Measured sizes at
// these widths: box art 24-61 KB at 640 px, a transparent logo ~14 KB.
//
// Pictograms (genre, rating, publisher logos) are not game media — their
// `parent` is not `jeu` — and are kept as an inventory only (extra_media).

/** save a resized copy in Storage · fetch through the proxy when viewed · ignore */
export type MediaMode = 'store' | 'on_demand' | 'skip'

export type MediaGroup = 'box' | 'support' | 'screens' | 'art' | 'logos' | 'extras' | 'documents' | 'video'

/** What kind of file a type is. Only images can be stored; the rest stream. */
export type MediaKind = 'image' | 'pdf' | 'video'

export interface MediaTypeInfo {
  type: string
  label: string
  group: MediaGroup
  kind: MediaKind
  mode: MediaMode
  /** Width asked of ScreenScraper when storing or previewing (their `maxwidth`). */
  width: number
  /** Has transparency — must stay PNG. Opaque art may become JPEG when that is smaller. */
  alpha: boolean
}

export const MEDIA_GROUPS: { key: MediaGroup; label: string }[] = [
  { key: 'box', label: 'Box' },
  { key: 'support', label: 'Cartridge & disc' },
  { key: 'screens', label: 'Screens' },
  { key: 'art', label: 'Artwork' },
  { key: 'logos', label: 'Logos & marquees' },
  { key: 'extras', label: 'Extras' },
  { key: 'documents', label: 'Manual' },
  { key: 'video', label: 'Video' },
]

const T = (type: string, label: string, group: MediaGroup, mode: MediaMode, width: number, alpha = false, kind: MediaKind = 'image'): MediaTypeInfo =>
  ({ type, label, group, kind, mode, width, alpha })

export const MEDIA_TYPES: MediaTypeInfo[] = [
  T('box-2D', 'Box front', 'box', 'store', 640),
  T('box-2D-back', 'Box back', 'box', 'on_demand', 640),
  T('box-2D-side', 'Box spine', 'box', 'on_demand', 320),
  T('box-3D', '3D box', 'box', 'on_demand', 640, true),
  T('box-texture', 'Box texture (unfolded)', 'box', 'on_demand', 1280),
  T('support-2D', 'Cartridge / disc', 'support', 'on_demand', 480, true),
  T('support-texture', 'Label texture', 'support', 'skip', 960),
  T('ss', 'Screenshot', 'screens', 'store', 640),
  T('sstitle', 'Title screen', 'screens', 'store', 640),
  T('fanart', 'Fan art', 'art', 'store', 1280),
  T('steamgrid', 'Steam grid', 'art', 'on_demand', 640),
  T('mixrbv1', 'Mix image 1', 'art', 'skip', 640, true),
  T('mixrbv2', 'Mix image 2', 'art', 'skip', 640, true),
  T('wheel-hd', 'Logo (HD)', 'logos', 'store', 480, true),
  T('wheel', 'Logo', 'logos', 'on_demand', 480, true),
  T('wheel-carbon', 'Logo (carbon)', 'logos', 'skip', 480, true),
  T('wheel-steel', 'Logo (steel)', 'logos', 'skip', 480, true),
  T('marquee', 'Marquee', 'logos', 'on_demand', 640, true),
  T('screenmarquee', 'Screen marquee', 'logos', 'on_demand', 640, true),
  T('screenmarqueesmall', 'Screen marquee (small)', 'logos', 'on_demand', 480, true),
  T('bezel-16-9', 'Bezel 16:9', 'extras', 'skip', 1280, true),
  T('bezel-4-3', 'Bezel 4:3', 'extras', 'skip', 1280, true),
  T('maps', 'Maps', 'extras', 'on_demand', 1280),
  T('box-scan', 'Box scan', 'box', 'on_demand', 1280),
  T('support-scan', 'Cartridge / disc scan', 'support', 'on_demand', 1280),
  T('flyer', 'Flyer', 'art', 'on_demand', 1280),
  T('figurine', 'Figurine', 'art', 'on_demand', 640, true),
  T('themehs', 'HyperSpin theme', 'extras', 'skip', 960, true),
  T('manuel', 'Manual (PDF)', 'documents', 'on_demand', 0, false, 'pdf'),
  T('video-normalized', 'Video (normalized)', 'video', 'skip', 0, false, 'video'),
  T('video', 'Video (original)', 'video', 'skip', 0, false, 'video'),
]

const BY_TYPE = new Map(MEDIA_TYPES.map(m => [m.type, m]))

/** A type ScreenScraper sends that this list does not know yet is still usable:
 *  an image, fetched on demand, labelled by its own name. */
export function mediaInfo(type: string): MediaTypeInfo {
  const known = BY_TYPE.get(type)
  if (known) return known
  const kind: MediaKind = /^video/.test(type) ? 'video' : /^manuel/.test(type) ? 'pdf' : 'image'
  return { type, label: type, group: kind === 'image' ? 'extras' : kind === 'pdf' ? 'documents' : 'video', kind, mode: kind === 'video' ? 'skip' : 'on_demand', width: 640, alpha: true }
}

/** Only images are ever copied into Storage; a manual or video only streams. */
export const canStore = (type: string) => mediaInfo(type).kind === 'image'

/**
 * The media types whose chosen copy also goes into `games.media`, which the
 * library list loads for EVERY game. Exactly what the cover chain, the detail
 * hero and the screenshot strip read (testGameModel.ts) — anything more would
 * be shipped a thousand times on every library load for nothing.
 */
export const LIST_MEDIA_TYPES = ['box-2D', 'box-3D', 'fanart', 'ss', 'sstitle'] as const

/** Media type → the `games` column it also fills (when the field policy allows). */
export const MEDIA_COLUMN: Record<string, 'primary_cover_url' | 'screenshot_url' | 'fanart_url'> = {
  'box-2D': 'primary_cover_url',
  ss: 'screenshot_url',
  fanart: 'fanart_url',
}

/** Is a type's upstream format the kind a pixel-art screenshot comes in? A
 *  native-resolution retro screen is a 3-4 KB palette PNG that a lossy JPEG
 *  makes BIGGER and blurrier, so small originals stay PNG. */
export const SMALL_ORIGINAL_BYTES = 64 * 1024

/**
 * The format asked of ScreenScraper (`outputformat`) for a stored copy.
 * Transparency forces PNG; otherwise PNG only when the original is already
 * small (the keep-whichever-is-smaller rule, decided from the inventory size
 * rather than by downloading both).
 */
export function outputFormatFor(type: string, originalBytes: number | null | undefined): 'png' | 'jpg' {
  const info = mediaInfo(type)
  if (info.alpha) return 'png'
  if (originalBytes != null && originalBytes > 0 && originalBytes <= SMALL_ORIGINAL_BYTES) return 'png'
  return 'jpg'
}
