import type { DeliveryStatus } from './opdsFeed'

export type { DeliveryStatus }

/** One file sent to the Kobo (book_deliveries, migration 125). */
export interface BookDelivery {
  id: string
  storage_path: string
  filename: string
  mime: string
  size_bytes: number
  title: string | null
  author: string | null
  status: DeliveryStatus
  created_at: string
  downloaded_at: string | null
}

/** When the Kobo last read the feed / downloaded a book (kobo_feed_state). */
export interface KoboFeedState {
  last_feed_at: string | null
  last_download_at: string | null
}

export type ReadStatus = 'want' | 'reading' | 'finished' | 'paused' | 'dropped'

/** One book in the library (books, migration 126). */
export interface Book {
  id: string
  koreader_md5: string | null
  kobo_content_id: string | null
  file_path: string | null
  title: string
  author: string | null
  series: string | null
  series_index: string | null
  language: string | null
  isbn: string | null
  publisher: string | null
  published_year: number | null
  description: string | null
  page_count: number | null
  cover_url: string | null
  read_status: ReadStatus
  rating: number | null
  review: string | null
  notes: string | null
  started_at: string | null
  finished_at: string | null
  queue_order: number | null
  progress_pct: number | null
  last_read_at: string | null
  read_seconds: number | null
  read_pages: number | null
  on_device: boolean
  source: 'koreader' | 'kobo' | 'manual'
  meta_source: string | null
  meta_checked_at: string | null
  /** 'news' for a News Downloader issue (migration 127); older rows read as books. */
  kind?: 'book' | 'news'
  cover_source?: 'device' | 'upload' | 'lookup' | 'url' | null
  device_cover_at?: string | null
  created_at: string
  updated_at: string
}

export type BookPatch = Partial<Pick<Book,
  'title' | 'author' | 'series' | 'series_index' | 'language' | 'isbn' | 'publisher' | 'published_year' | 'description' |
  'page_count' | 'cover_url' | 'read_status' | 'rating' | 'review' | 'notes' | 'started_at' | 'finished_at' | 'queue_order' |
  'cover_source'>>

/** One KOReader page-stat row (reading_page_events). */
export interface ReadingEvent {
  book_id: string
  page: number
  started_at: string
  duration_seconds: number
}

export interface ReadingSettings {
  daily_minutes_goal: number
  streak_min_minutes: number
}

/** kobo_feed_state with the plugin's sync columns (migration 126). */
export interface KoboSyncState extends KoboFeedState {
  last_seen_at?: string | null
  last_sync_at?: string | null
  device_id?: string | null
  plugin_version?: string | null
  last_sync_result?: { new_events?: number; books_created?: number; books_updated?: number; unmatched?: number; at?: string } | null
  battery?: number | null
  charging?: boolean | null
  koreader_version?: string | null
}

/** What the app wants on the Kobo (kobo_device_config, migration 127). */
export interface KoboDeviceConfig {
  settings: Record<string, boolean | number | string | null>
  menu_order: Partial<Record<'filemanager' | 'reader', Record<string, string[]>>>
  sleep_image_id: string | null
  rev: number
  updated_at: string
}

/** What the Kobo applied and reported (kobo_device_state). */
export interface KoboDeviceState {
  applied_rev: number | null
  applied_at: string | null
  apply_result: { applied?: string[]; refused?: Record<string, string>; images?: { downloaded?: number; deleted?: number; failed?: number }; menu_changed?: boolean } | null
  report: {
    settings?: Record<string, boolean | number | string>
    menus?: Partial<Record<'filemanager' | 'reader', { order: Record<string, string[]>; labels: Record<string, string> }>>
    plugin_version?: string
  } | null
  reported_at: string | null
}

export interface SleepImage {
  id: string
  storage_path: string
  filename: string
  mime: 'image/jpeg' | 'image/png'
  size_bytes: number
  width: number | null
  height: number | null
  created_at: string
}

/** A question asked on the Kobo about a passage (book_ai_notes). */
export interface BookAiNote {
  id: string
  book_id: string | null
  book_title: string | null
  ask: 'explain' | 'translate' | 'word' | 'character' | 'free'
  question: string | null
  selection: string
  answer: string
  created_at: string
}
