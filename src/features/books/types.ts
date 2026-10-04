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
