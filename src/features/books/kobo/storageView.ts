// The Kobo's storage, split into what fills it — pure, verified by
// scripts/verify-kobo-settings.cjs. Totals come from the plugin (1.2+), file
// sizes from the library rows the Kobo reports.

export interface StorageInput {
  storage_total?: number | null
  storage_free?: number | null
  storage_at?: string | null
}

export interface StorageBook { kind?: 'book' | 'news'; on_device: boolean; file_size?: number | null }

export interface StorageBreakdown {
  total: number
  free: number
  used: number
  books: number
  news: number
  /** KOReader, fonts, dictionaries and Kobo's own files: used minus the books we can count. */
  other: number
  /** Books on the Kobo whose size is not known yet (sent by plugin 1.2 on its next library sync). */
  unsized: number
  at: string | null
  /** 0–1 of the total. */
  usedShare: number
}

export function storageBreakdown(state: StorageInput | null | undefined, books: readonly StorageBook[]): StorageBreakdown | null {
  const total = state?.storage_total ?? null
  const free = state?.storage_free ?? null
  if (!total || total <= 0 || free === null || free < 0 || free > total) return null
  const onDevice = books.filter(b => b.on_device)
  const size = (b: StorageBook) => (typeof b.file_size === 'number' && b.file_size > 0 ? b.file_size : 0)
  const booksBytes = onDevice.filter(b => b.kind !== 'news').reduce((t, b) => t + size(b), 0)
  const news = onDevice.filter(b => b.kind === 'news').reduce((t, b) => t + size(b), 0)
  const used = total - free
  const counted = Math.min(booksBytes + news, used)
  return {
    total, free, used,
    books: Math.min(booksBytes, used),
    news: Math.min(news, Math.max(used - booksBytes, 0)),
    other: Math.max(used - counted, 0),
    unsized: onDevice.filter(b => size(b) === 0).length,
    at: state?.storage_at ?? null,
    usedShare: used / total,
  }
}

/** 1.234 GB, 312 MB, 48 KB — base 1024, like the Kobo. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`
  const mb = n / 1024 ** 2
  if (mb >= 1) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}
