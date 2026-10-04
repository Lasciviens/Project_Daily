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
  created_at: string
  updated_at: string
}

export type BookPatch = Partial<Pick<Book,
  'title' | 'author' | 'series' | 'series_index' | 'language' | 'isbn' | 'publisher' | 'published_year' | 'description' |
  'page_count' | 'cover_url' | 'read_status' | 'rating' | 'review' | 'notes' | 'started_at' | 'finished_at' | 'queue_order'>>

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
}
