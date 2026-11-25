import { useEffect, useRef } from 'react'
import { Package, Plus, Sparkles, X } from 'lucide-react'
import { Button, IconButton } from '../../../../shared/ui'
import { useMotion } from '../../../../shared/hooks/useMotion'
import { PhotoButton } from '../../../ai/claude/components/PhotoButton'
import { costNote } from '../../../ai/claude/featureRules'
import { PRODUCT_PHOTO_LIMITS } from '../../../ai/claude/photoProductRules'
import { ItemThumb } from '../shopKit'
import { ChoiceChip } from '../shopPickers'
import type { ProductPhotoStep } from './useProductPhotoStep'

const PHOTO_TIP = 'Photo — take or pick 1–2 photos of a product; AI drafts it from them and your words (it may ask a few questions first). A link or a barcode is read first, free. Nothing is saved until you tap Save; the photos are not kept.'

/** A box with a small ✨: a thing from photos (its own mark, so it is never taken for the receipt's camera). */
function PackageAi() {
  return <span className="relative inline-flex"><Package aria-hidden /><Sparkles aria-hidden className="absolute -right-1.5 -top-1.5 !h-2.5 !w-2.5" /></span>
}

/** "≤ $0.05": the most both calls can cost, from the job's own prices. */
const worstLabel = (usd: number | null): string | null => (usd == null ? null : `≤ $${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`)

/** The 📷✨ button: the camera or the photo library, up to two photos. It shows where its body puts it (one place at a time). */
export function PhotoAskButton({ step, disabled }: { step: ProductPhotoStep; disabled?: boolean }) {
  return (
    <PhotoButton iconOnly bordered multiple icon={<PackageAi />} onFiles={step.add} onFile={f => step.add([f])} disabled={disabled || step.busy} loading={step.busy} tip={PHOTO_TIP}>
      Photo
    </PhotoButton>
  )
}

/**
 * The step (owner, 25.11.2026): the photos and a line, then the AI's questions (tap a choice or type an answer), then the
 * draft fills the facts and a line says what it cost — or that a link or a barcode filled it with no AI. Questions and
 * choices are the AI's words, shown as text; nothing here is saved.
 */
export function ProductPhotoPanel({ step }: { step: ProductPhotoStep }) {
  const motion = useMotion()
  const box = useRef<HTMLDivElement>(null)
  // On a phone the step can sit under other parts: it comes into view when it opens and when the questions land.
  const asked = !!step.questions
  useEffect(() => {
    if (step.open) box.current?.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
  }, [step.open, asked, motion])
  if (!step.open) {
    if (!step.done && !step.problem) return null
    const done = step.done
    return (
      <p className="text-meta text-fg-muted" role="status">
        {done?.free ? `Found by its barcode — no AI: ${done.free}`
          : done ? `Filled from photo + AI${costNote(done.costUsd) ? ` · ${costNote(done.costUsd)}` : ''}${done.searched ? ' · searched the web' : ''} — check it below.`
          : step.problem}
      </p>
    )
  }
  const worst = worstLabel(step.worstUsd)
  return (
    <div ref={box} className="relative flex scroll-mb-4 flex-col gap-2 rounded-row border border-line bg-surface-2 p-2 pr-11" role="group" aria-label="A thing from photos">
      <IconButton size="sm" label="Close — drop the photos" onClick={step.close} disabled={step.busy} className="absolute right-1 top-1"><X aria-hidden /></IconButton>
      <div className="flex flex-wrap items-center gap-2">
        {step.photos.map((p, i) => (
          <span key={p.url} className="relative">
            <ItemThumb src={p.url} size="sm" />
            <button type="button" onClick={() => step.remove(i)} disabled={step.busy} title="Remove this photo" aria-label="Remove this photo"
              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-fg-muted hover:text-fg">
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        {step.photos.length < PRODUCT_PHOTO_LIMITS.photos && !asked && (
          <PhotoButton iconOnly icon={<Plus />} onFile={f => step.add([f])} disabled={step.busy} tip="Add a second photo (another side, the label)">Add</PhotoButton>
        )}
        {!asked && (
          <>
            <input value={step.text} onChange={e => step.setText(e.target.value)} maxLength={PRODUCT_PHOTO_LIMITS.text} disabled={step.busy}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); step.start() } }}
              aria-label="What it is (optional)" placeholder="What is it? (optional)" className="input input-sm min-w-[9rem] flex-1" />
            {/* The AI is asked only after a link, a typed barcode and a barcode in the photos had their free turn. */}
            <Button size="sm" variant="primary" icon={<Sparkles />} loading={step.busy} onClick={step.start} disabled={worst == null}
              tip={`Ask — a link or a barcode is read first, free; then the AI looks at the photos and your words${worst ? ` (both calls at most ${worst.slice(2)})` : ' (working out the cost)'}`}>
              {worst ? `Ask · ${worst}` : 'Ask'}
            </Button>
          </>
        )}
      </div>
      {step.note && <p className="text-meta text-fg-muted" role="status">{step.note}</p>}
      {step.problem && <p className="text-meta text-warn" role="status">{step.problem}</p>}
      {step.questions && (
        <>
          <p className="text-meta text-fg-muted">A few questions{costNote(step.costUsd) ? ` · ${costNote(step.costUsd)}` : ''} — tap or type an answer</p>
          {step.questions.map((q, i) => {
            const pick = step.picks[i] ?? ''
            const typed = pick && !q.choices.includes(pick)
            return (
              <fieldset key={i} className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
                <legend className="mb-1 text-body font-medium text-fg">{q.question}</legend>
                <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={q.question}>
                  {q.choices.map(c => <ChoiceChip key={c} on={pick === c} onClick={() => step.setPick(i, pick === c ? '' : c)}>{c}</ChoiceChip>)}
                  <input value={typed ? pick : ''} onChange={e => step.setPick(i, e.target.value)} maxLength={PRODUCT_PHOTO_LIMITS.answer} disabled={step.busy}
                    aria-label={`Your own answer: ${q.question}`} placeholder="Other…" className="input input-sm w-32" />
                </div>
              </fieldset>
            )
          })}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon={<Sparkles />} loading={step.busy} onClick={step.fill} tip="Fill — send your answers; the AI fills the draft">Fill</Button>
            <Button size="sm" variant="ghost" disabled={step.busy} onClick={step.skip} tip="Skip — no answers; the AI fills what it can">Skip</Button>
          </div>
        </>
      )}
    </div>
  )
}
