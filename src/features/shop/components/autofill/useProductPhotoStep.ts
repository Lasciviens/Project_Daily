import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../../shared/query'
import { describeClaude } from '../../../ai/claude/claudeApi'
import { useProductPhoto } from '../../../ai/claude/hooks/useProductPhoto'
import { shrinkPhoto } from '../../../ai/claude/photoShrink'
import type { PhotoInput } from '../../../ai/claude/featureRules'
import {
  holdsLink, photoEan, photoPlan, photoWorstCost, PHOTO_WORDS, PRODUCT_PHOTO_LIMITS, PRODUCT_PHOTO_MAX_BYTES, type PhotoDraft, type PhotoQuestion,
} from '../../../ai/claude/photoProductRules'
import { PHOTO_CATEGORIES_MAX } from '../../../ai/claude/photoProductJob'
import { usePreferredHosts } from '../../hooks/useProductPicture'
import { tidyCategories } from '../../tidyModel'
import type { ShopCategory } from '../../types'

/**
 * What the step hands its results to: the body's autofill (`AutofillPanel` sets it while it is mounted), so the draft, a
 * link and a barcode go through the same facts, link reader and barcode lookup as everything else the autofill fills.
 */
export interface PhotoTarget {
  /** The AI's draft as facts "photo + AI" (never over what was typed); its product page gives the picture. */
  fill: (draft: PhotoDraft, callId: string | null) => void
  /** The link reader's own read of one link (free); resolves with what it says. */
  readLink: (url: string) => Promise<string>
  /** The barcode lookup (the owner's things, then Kassalapp; free): whether it filled the thing, and what it says. */
  lookupEan: (code: string) => Promise<{ filled: boolean; note: string }>
}

/** One photo picked for the step: the file in memory and its preview address (released when it goes). */
interface Picked { file: File; url: string }

/**
 * Shop's 📷✨ step (owner, 25.11.2026), one per body (RecordBody): 1–2 photos and an optional line → the `product_photo` job →
 * questions (tap or type an answer) → the draft, handed to the autofill (`target`) to fill the facts. AI last, in order: a
 * link in the line is read alone by the link reader; a typed barcode number, or one the app's own reader finds in the photos,
 * goes to the barcode lookup — and when that fills the thing no AI is asked; only a code it did not find is sent with the
 * photos, as digits. The photos stay in this hook's memory (shrunk once, sent again with the answers) and are let go when
 * the draft lands, a lookup filled the thing, or the step closes — never stored.
 */
export function useProductPhotoStep({ categories, target }: { categories: readonly ShopCategory[]; target: RefObject<PhotoTarget | null> }) {
  const ask = useProductPhoto()
  const preferred = usePreferredHosts()
  const [photos, setPhotos] = useState<Picked[]>([])
  const [text, setText] = useState('')
  const [questions, setQuestions] = useState<PhotoQuestion[] | null>(null)
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [costUsd, setCostUsd] = useState<number | null>(null)
  const [done, setDone] = useState<{ costUsd: number | null; searched: boolean; free?: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // The code the lookup already tried (a typed number, or the photos' barcode): asking again sends it to the AI instead.
  const tried = useRef<string | null>(null)
  // The barcode the photos hold (read once per set of photos) and the one this draft's calls carry.
  const decoded = useRef<{ key: string; code: string | null } | null>(null)
  const ean = useRef<string | null>(null)
  const shrunk = useRef<{ key: string; photos: PhotoInput[] } | null>(null)
  const cats = useMemo(() => tidyCategories(categories, PHOTO_CATEGORIES_MAX), [categories])
  const urls = useRef<string[]>([])
  useEffect(() => { urls.current = photos.map(p => p.url) }, [photos])
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  // The most both calls can cost, from the job's own prices (asked only once the step is open), shown on Ask.
  const open = photos.length > 0
  const describe = useQuery({ queryKey: qk.claude.describe(), queryFn: describeClaude, staleTime: STALE.default, enabled: open })
  const worstUsd = useMemo(() => {
    const about = describe.data
    const job = about?.jobs.find(j => j.name === 'product_photo')
    const price = about?.prices.models.find(m => m.model === job?.defaults.model)
    if (!about || !job || !price) return null
    const catChars = cats.reduce((n, c) => n + c.path.length + 6, 0)
    return photoWorstCost({ webSearchUsdEach: about.prices.webSearchUsdEach, longPromptOverTokens: about.prices.longPromptOverTokens, longPromptMultiplier: about.prices.longPromptMultiplier, model: price },
      { instructionsChars: job.instructions.length, maxOutputTokens: job.defaults.maxOutputTokens }, catChars)
  }, [describe.data, cats])

  const key = photos.map(p => p.url).join(' ')
  const letGo = (list: readonly Picked[]) => { for (const p of list) URL.revokeObjectURL(p.url) }
  const reset = () => {
    letGo(photos); setPhotos([]); setText(''); setQuestions(null); setPicks({}); setCostUsd(null); setProblem(null); setNote(null)
    shrunk.current = null; decoded.current = null; ean.current = null; tried.current = null
  }

  /** Photos picked: two at most (iOS does not hold a picker to a count), pictures only. A pick after the questions starts again. */
  function add(files: readonly File[]) {
    const pics = files.filter(f => f.type.startsWith('image/'))
    if (!pics.length) { setProblem(files.length ? 'Pick a photo (a picture file).' : null); return }
    const keep = questions ? [] : photos
    const room = PRODUCT_PHOTO_LIMITS.photos - keep.length
    if (room <= 0) { setProblem(PHOTO_WORDS.twoAtMost); return }
    if (questions) { letGo(photos); setQuestions(null); setPicks({}); setCostUsd(null) }
    setPhotos([...keep, ...pics.slice(0, room).map(file => ({ file, url: URL.createObjectURL(file) }))])
    setDone(null); setNote(null); setProblem(pics.length > room ? PHOTO_WORDS.twoAtMost : null)
    shrunk.current = null; decoded.current = null; ean.current = null
  }
  function remove(i: number) {
    const gone = photos[i]
    if (gone) URL.revokeObjectURL(gone.url)
    setPhotos(photos.filter((_, j) => j !== i)); setQuestions(null); setPicks({}); setProblem(null)
    shrunk.current = null; decoded.current = null; ean.current = null
  }

  async function photosToSend(): Promise<PhotoInput[]> {
    if (shrunk.current?.key === key) return shrunk.current.photos
    const out: PhotoInput[] = []
    for (const p of photos) out.push(await shrinkPhoto(p.file, { maxBytes: PRODUCT_PHOTO_MAX_BYTES }))
    shrunk.current = { key, photos: out }
    return out
  }

  /** The thing was filled with no AI (its barcode): the photos go, and the line says so. */
  function filledFree(said: string) {
    reset()
    setDone({ costUsd: null, searched: false, free: said })
  }

  /** One call: the first without answers (it may ask), the second with them (it must draft). */
  async function send(answers?: { question: string; answer: string }[]) {
    if (!photos.length || ask.isPending) return
    setProblem(null)
    let sent: PhotoInput[]
    try { sent = await photosToSend() } catch (e) { setProblem((e as Error).message); return }
    try {
      const r = await ask.mutateAsync({ photos: sent, text, ...(ean.current ? { ean: ean.current } : {}), ...(answers ? { answers } : {}), categories: cats, preferredHosts: await preferred() })
      const total = (costUsd ?? 0) + (r.costUsd ?? 0)
      if (r.answer.kind === 'questions') {
        setQuestions(r.answer.questions); setPicks({}); setCostUsd(total)
        return
      }
      const t = target.current
      if (!t) { setProblem(PHOTO_WORDS.notReady); return }
      t.fill(r.answer.draft, r.callId)
      reset()
      setDone({ costUsd: costUsd === null && r.costUsd === null ? null : total, searched: !!r.answer.draft.searched })
    } catch { /* the hook reports it; the step stays as it was, to try again */ }
  }

  /** The barcode lookup with no AI; true when it filled the thing (the step is then done). */
  async function lookUp(t: PhotoTarget, code: string): Promise<boolean> {
    tried.current = code
    const r = await t.lookupEan(code)
    if (r.filled) { filledFree(r.note); return true }
    setNote(`${r.note} Tap Ask to send the photos to the AI.`)
    return false
  }

  /** Ask: code first (a link, a typed barcode, a barcode in the photos), then the AI. */
  async function start() {
    if (!photos.length || working || ask.isPending) return
    setProblem(null); setNote(null)
    const t = target.current
    const plan = photoPlan(text)
    if (plan.kind !== 'ai' && !t) { setProblem(PHOTO_WORDS.notReady); return }
    setWorking(true)
    try {
      if (plan.kind === 'link' && t) {
        // Just the link, read alone by the link reader; the photos stay until it has answered, and the line keeps its words.
        if (!plan.url) { setProblem('That link could not be read as an address — paste it in Link.'); return }
        const said = await t.readLink(plan.url)
        setText(plan.rest)
        setNote(`Read the link instead — free, no AI: ${said}`)
        return
      }
      if (plan.kind === 'barcode' && t) {
        // A typed number: the lookup first; asked again after it found nothing, the number goes to the AI with the photos.
        if (tried.current !== plan.code) { await lookUp(t, plan.code); return }
        ean.current = photoEan(plan.code)
      } else if (t) {
        // A barcode in the photos, read by the app's own reader: the lookup first, the AI only when it found nothing.
        if (decoded.current?.key !== key) {
          const { barcodeInPhotos } = await import('../../stillBarcode')
          decoded.current = { key, code: await barcodeInPhotos(photos.map(p => p.file)) }
        }
        const code = decoded.current.code
        if (code && tried.current !== code && await lookUp(t, code)) return
        ean.current = photoEan(code)
      }
    } finally { setWorking(false) }
    await send()
  }

  /** The answers as the second call sends them: the questions asked and what the owner tapped or typed; unanswered ones are left out. */
  const answers = (questions ?? []).flatMap((q, i) => {
    const a = (picks[i] ?? '').replace(/\s+/g, ' ').trim()
    return a ? [{ question: q.question, answer: [...a].slice(0, PRODUCT_PHOTO_LIMITS.answer).join('') }] : []
  })
  /** Fill: a typed answer that is a link is never sent (the function refuses it too). */
  function fill() {
    if (answers.some(a => holdsLink(a.answer))) { setProblem(PHOTO_WORDS.answerLink); return }
    void send(answers)
  }

  return {
    open, photos, text, setText, questions, picks, setPick: (i: number, v: string) => setPicks(p => ({ ...p, [i]: v })),
    costUsd, worstUsd, done, problem, note, busy: ask.isPending || working,
    add, remove, start: () => { void start() }, fill, skip: () => { void send([]) }, close: () => { reset(); setDone(null) },
  }
}

export type ProductPhotoStep = ReturnType<typeof useProductPhotoStep>
