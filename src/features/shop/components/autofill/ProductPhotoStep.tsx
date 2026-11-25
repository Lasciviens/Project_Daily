import { useEffect, useRef } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { Button, IconButton, cx } from '../../../../shared/ui'
import { useMotion } from '../../../../shared/hooks/useMotion'
import { PhotoButton } from '../../../ai/claude/components/PhotoButton'
import { costNote } from '../../../ai/claude/featureRules'
import { PRODUCT_PHOTO_LIMITS } from '../../../ai/claude/photoProductRules'
import { ItemThumb } from '../shopKit'
import { ChoiceChip } from '../shopPickers'
import type { ProductPhotoStep } from './useProductPhotoStep'

const PHOTO_TIP = 'Photo — take or pick 1–2 photos; AI drafts the product from them and your words (it may ask a few questions first). Nothing is saved until you tap Save; the photos are not kept.'

/** The 📷✨ in the link row: the camera or the photo library, up to two photos. */
export function PhotoAskButton({ step, disabled }: { step: ProductPhotoStep; disabled?: boolean }) {
  return (
    <PhotoButton iconOnly bordered multiple onFiles={step.add} onFile={f => step.add([f])} disabled={disabled || step.busy} loading={step.busy} tip={PHOTO_TIP}>
      Photo
    </PhotoButton>
  )
}

/**
 * The step under the link row (owner, 25.11.2026): the photos and a line, then the AI's questions (tap a choice or type an
 * answer), then the draft fills the facts below and a line says what it cost. Questions and choices are the AI's words, shown
 * as text; nothing here is saved.
 */
export function ProductPhotoPanel({ step }: { step: ProductPhotoStep }) {
  const motion = useMotion()
  const box = useRef<HTMLDivElement>(null)
  // On a phone the step sits under the facts: it comes into view when it opens and when the questions land (the owner asked for it).
  const asking = !!step.questions
  useEffect(() => {
    if (step.open) box.current?.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
  }, [step.open, asking, motion])
  if (!step.open) {
    if (!step.done && !step.problem) return null
    return (
      <p className="text-meta text-fg-muted" role="status">
        {step.done ? `Filled from photo + AI${costNote(step.done.costUsd) ? ` · ${costNote(step.done.costUsd)}` : ''}${step.done.searched ? ' · searched the web' : ''} — check it below.` : step.problem}
      </p>
    )
  }
  const asked = asking
  return (
    <div ref={box} className="flex scroll-mb-4 flex-col gap-2 rounded-row border border-line bg-surface-2 p-2" role="group" aria-label="A thing from photos">
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
            <Button size="sm" variant="primary" icon={<Sparkles />} loading={step.busy} onClick={step.start}
              tip="Ask — the AI looks at the photos and your words; it may ask a few questions, then fills the draft">Ask</Button>
          </>
        )}
        <IconButton size="sm" label="Close — drop the photos" onClick={step.close} disabled={step.busy} className={cx(asked && 'ml-auto')}><X aria-hidden /></IconButton>
      </div>
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
