import { useEffect, useMemo, useRef, useState } from 'react'
import { useProductPhoto } from '../../../ai/claude/hooks/useProductPhoto'
import { shrinkPhoto } from '../../../ai/claude/photoShrink'
import type { PhotoInput } from '../../../ai/claude/featureRules'
import { photoPlan, PRODUCT_PHOTO_LIMITS, PRODUCT_PHOTO_MAX_BYTES, type PhotoDraft, type PhotoQuestion } from '../../../ai/claude/photoProductRules'
import { PHOTO_CATEGORIES_MAX } from '../../../ai/claude/photoProductJob'
import { usePreferredHosts } from '../../hooks/useProductPicture'
import { tidyCategories } from '../../tidyModel'
import type { ShopCategory } from '../../types'

/** One photo picked for the step: the file in memory and its preview address (released when it goes). */
interface Picked { file: File; url: string }

/**
 * Shop's 📷✨ step (owner, 25.11.2026), inside the one body's autofill: 1–2 photos and an optional line → the `product_photo`
 * job → questions (tap or type an answer) → the draft, handed to `onDraft` to fill the facts. AI last: a link in the line goes
 * to the link reader and a typed barcode number to the barcode lookup, with no call. The photos stay in this hook's memory
 * (shrunk once, sent again with the answers) and are let go when the draft lands or the step closes — never stored.
 */
export function useProductPhotoStep({ categories, onDraft, onBarcode, onLink }: {
  categories: readonly ShopCategory[]
  onDraft: (draft: PhotoDraft, callId: string | null) => void
  /** A typed barcode number: the autofill's own barcode lookup (free). */
  onBarcode: (code: string) => void
  /** A typed link: the autofill's link reader (free). */
  onLink: (url: string) => void
}) {
  const ask = useProductPhoto()
  const preferred = usePreferredHosts()
  const [photos, setPhotos] = useState<Picked[]>([])
  const [text, setText] = useState('')
  const [questions, setQuestions] = useState<PhotoQuestion[] | null>(null)
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [costUsd, setCostUsd] = useState<number | null>(null)
  const [done, setDone] = useState<{ costUsd: number | null; searched: boolean } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // The shrunk photos of the picks now: worked out once, sent again with the answers. Gone with the picks.
  const shrunk = useRef<{ key: string; photos: PhotoInput[] } | null>(null)
  const cats = useMemo(() => tidyCategories(categories, PHOTO_CATEGORIES_MAX), [categories])
  const urls = useRef<string[]>([])
  useEffect(() => { urls.current = photos.map(p => p.url) }, [photos])
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  const letGo = (list: readonly Picked[]) => { for (const p of list) URL.revokeObjectURL(p.url) }
  const reset = () => { letGo(photos); setPhotos([]); setText(''); setQuestions(null); setPicks({}); setCostUsd(null); setProblem(null); shrunk.current = null }

  /** Photos picked: up to two in all (iOS does not hold a picker to a count), pictures only. A new pick starts a new draft. */
  function add(files: readonly File[]) {
    const fresh = files.filter(f => f.type.startsWith('image/')).slice(0, PRODUCT_PHOTO_LIMITS.photos - (questions ? 0 : photos.length))
    if (!fresh.length) { setProblem(files.length ? 'Pick a photo (a picture file).' : null); return }
    const keep = questions ? [] : photos
    if (questions) { letGo(photos); setQuestions(null); setPicks({}); setCostUsd(null) }
    setPhotos([...keep, ...fresh.map(file => ({ file, url: URL.createObjectURL(file) }))].slice(0, PRODUCT_PHOTO_LIMITS.photos))
    setDone(null); setProblem(null); shrunk.current = null
  }
  function remove(i: number) {
    const gone = photos[i]
    if (gone) URL.revokeObjectURL(gone.url)
    setPhotos(photos.filter((_, j) => j !== i)); setQuestions(null); setPicks({}); shrunk.current = null
  }

  async function photosToSend(): Promise<PhotoInput[]> {
    const key = photos.map(p => p.url).join(' ')
    if (shrunk.current?.key === key) return shrunk.current.photos
    const out: PhotoInput[] = []
    for (const p of photos) out.push(await shrinkPhoto(p.file, { maxBytes: PRODUCT_PHOTO_MAX_BYTES }))
    shrunk.current = { key, photos: out }
    return out
  }

  /** One call: the first without answers (it may ask), the second with them (it must draft). */
  async function send(answers?: { question: string; answer: string }[]) {
    if (!photos.length || ask.isPending) return
    setProblem(null)
    let sent: PhotoInput[]
    try { sent = await photosToSend() } catch (e) { setProblem((e as Error).message); return }
    try {
      const r = await ask.mutateAsync({ photos: sent, text, ...(answers ? { answers } : {}), categories: cats, preferredHosts: await preferred() })
      const total = (costUsd ?? 0) + (r.costUsd ?? 0)
      if (r.answer.kind === 'questions') {
        setQuestions(r.answer.questions); setPicks({}); setCostUsd(total)
        return
      }
      onDraft(r.answer.draft, r.callId)
      setDone({ costUsd: costUsd === null && r.costUsd === null ? null : total, searched: !!r.answer.draft.searched })
      reset()
    } catch { /* the hook reports it; the step stays as it was, to try again */ }
  }

  /** Ask: code first (a link, a barcode number), then the AI. */
  function start() {
    const plan = photoPlan(text)
    if (plan.kind === 'link') { onLink(text.trim()); reset(); return }
    if (plan.kind === 'barcode') { onBarcode(plan.code); reset(); return }
    void send()
  }

  /** The answers as the second call sends them: the questions asked and what the owner tapped or typed; unanswered ones are left out. */
  const answers = (questions ?? []).flatMap((q, i) => {
    const a = (picks[i] ?? '').replace(/\s+/g, ' ').trim()
    return a ? [{ question: q.question, answer: [...a].slice(0, PRODUCT_PHOTO_LIMITS.answer).join('') }] : []
  })

  return {
    open: photos.length > 0, photos, text, setText, questions, picks, setPick: (i: number, v: string) => setPicks(p => ({ ...p, [i]: v })),
    costUsd, done, problem, busy: ask.isPending,
    add, remove, start, fill: () => { void send(answers) }, skip: () => { void send([]) }, close: () => { reset(); setDone(null) },
  }
}

export type ProductPhotoStep = ReturnType<typeof useProductPhotoStep>
