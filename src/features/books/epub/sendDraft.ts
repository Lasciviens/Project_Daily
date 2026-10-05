// The Send to Kobo preview's form: what the file says, what is missing, and
// what is saved — pure, verified by scripts/verify-library-facets.cjs.

import type { Book, ReadStatus } from '../types'
import { canonical, cleanTags, foldKey, splitAuthors } from '../libraryFacets'
import type { EpubMeta, OpfEdit } from './opf'

export interface SendDraft {
  title: string
  author: string
  series: string
  seriesIndex: string
  language: string
  categories: string[]
  subjects: string[]
  status: Extract<ReadStatus, 'want' | 'reading'>
  /** EPUB only: write the edited details into the file too, so the Kobo shows them. */
  writeIntoFile: boolean
}

/** "Rowling, J K - Harry Potter 1.epub" → "Rowling, J K - Harry Potter 1". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.kepub\.epub$/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').trim()
}

export function draftFromMeta(meta: EpubMeta | null, fileName: string, canWrite: boolean): SendDraft {
  return {
    title: meta?.title ?? titleFromFileName(fileName),
    author: (meta?.authors ?? []).join(' & '),
    series: meta?.series ?? '',
    seriesIndex: meta?.seriesIndex ?? '',
    language: meta?.language ?? '',
    categories: [],
    subjects: meta?.subjects ?? [],
    status: 'want',
    writeIntoFile: canWrite,
  }
}

export type MissingField = 'title' | 'author' | 'language'

/** Fields worth filling before sending (the title is the only one that must be there). */
export function missingFields(d: SendDraft): MissingField[] {
  const out: MissingField[] = []
  if (!d.title.trim()) out.push('title')
  if (!d.author.trim()) out.push('author')
  if (!d.language.trim()) out.push('language')
  return out
}

/** A book already in the library with the same title (and author, when both have one). News is never a match. */
export function findDuplicate(books: readonly Book[], d: SendDraft): Book | null {
  const t = foldKey(d.title)
  if (!t) return null
  const a = foldKey(d.author)
  return books.find(b => b.kind !== 'news' && foldKey(b.title) === t && (!a || !b.author || foldKey(b.author) === a)) ?? null
}

export interface Known { author: string[]; collection: string[]; category: string[]; subject: string[] }

/** The draft with the library's spellings: each author, the collection, categories and subjects. */
export function normalizeDraft(d: SendDraft, known: Known): SendDraft {
  const authors = splitAuthors(d.author).map(a => canonical(known.author, a))
  return {
    ...d,
    title: d.title.replace(/\s+/g, ' ').trim(),
    author: authors.join(' & '),
    series: canonical(known.collection, d.series),
    seriesIndex: d.seriesIndex.trim(),
    language: d.language.trim(),
    categories: cleanTags(known.category, d.categories),
    subjects: cleanTags(known.subject, d.subjects),
  }
}

/** What goes into the EPUB (only when the owner asked for it). */
export function opfEditOf(d: SendDraft): OpfEdit | null {
  if (!d.writeIntoFile || !d.title.trim()) return null
  return {
    title: d.title.trim(),
    authors: splitAuthors(d.author),
    language: d.language.trim() || null,
    series: d.series.trim() || null,
    seriesIndex: d.series.trim() ? d.seriesIndex.trim() || null : null,
    subjects: d.subjects,
  }
}

/** The library row prepared for the file (matched by the Kobo's book id at its next sync). */
export function bookRowOf(d: SendDraft, meta: EpubMeta | null) {
  return {
    title: d.title.trim() || 'Untitled',
    author: d.author.trim() || null,
    series: d.series.trim() || null,
    series_index: d.series.trim() ? d.seriesIndex.trim() || null : null,
    language: d.language.trim() || null,
    categories: d.categories,
    subjects: d.subjects,
    read_status: d.status,
    publisher: meta?.publisher ?? null,
    published_year: meta?.year ?? null,
    isbn: meta?.isbn ?? null,
    description: meta?.description ?? null,
  }
}
