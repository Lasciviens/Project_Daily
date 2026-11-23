import { useId, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, TonePill } from '../../../shared/ui'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { useDescribeGuess, useLogGuess } from '../hooks/useQuickGuess'
import { PhotoButton } from '../../ai/claude/components/PhotoButton'
import { usePhotoGuess } from '../../ai/claude/hooks/useAiFeatures'
import { useReportAiSave } from '../../ai/claude/hooks/useLearn'
import { costNote } from '../../ai/claude/featureRules'
import { draftProblem, EMPTY_DRAFT, KNOWN_GUESS_NOTE, type GuessDraft, type GuessEstimate } from '../quickGuess'
import type { MealSlot } from '../types'
import { DecimalInput } from './foodLogKit'
import { SLOT_OPTIONS } from './foodLogUtils'
import { QuickGuessSheet } from './QuickGuessEditor'

const FORM_ID = 'describe-guess-form'
const MACROS = [
  { key: 'kcal', label: 'Kcal' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'sugar', label: 'Sugar' },
] as const

/**
 * "Describe it": type what you had, the AI estimates it as one diary line
 * (the `quick_guess` job on `claude`, one shot), and you check the numbers — marked "AI estimate",
 * with what it assumed — before you Log it or save it as a preset. The AI
 * never logs anything itself (review-first).
 */
export function DescribeGuessSheet({ initialText = '', date, slot, onClose }: { initialText?: string; date: string; slot: MealSlot; onClose: () => void }) {
  const textId = useId()
  const describe = useDescribeGuess()
  const log = useLogGuess()
  const photo = usePhotoGuess()
  const learn = useReportAiSave()
  const [text, setText] = useState(initialText)
  const [draft, setDraft] = useState<GuessDraft | null>(null)
  const [assumed, setAssumed] = useState<string[]>([])
  const [from, setFrom] = useState<GuessEstimate['from']>(undefined)
  // The AI call the draft came from: the logged line is reported with it (Developer → AI → Learn), never when no AI was asked.
  const [callId, setCallId] = useState<string | null>(null)
  // What the photo's AI call cost (empty after a described or remembered estimate).
  const [photoCost, setPhotoCost] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const slotName = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot
  const set = <K extends keyof GuessDraft>(k: K, v: GuessDraft[K]) => { setDraft(d => (d ? { ...d, [k]: v } : d)); setProblem(null) }

  function applyEstimate(e: GuessEstimate, fallbackName: string) {
    setDraft({ ...EMPTY_DRAFT, name: e.title || fallbackName.slice(0, 60), portion: e.portion, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, sugar: e.sugar })
    setAssumed(e.assumptions)
    setFrom(e.from)
    setCallId(e.callId ?? null)
  }

  async function estimate() {
    if (!text.trim()) { setProblem('Say what you had first'); return }
    setProblem(null)
    try {
      applyEstimate(await describe.mutateAsync(text), text.trim())
      setPhotoCost(null)
    } catch { /* the hook reports it (one toast, shown over this sheet) */ }
  }

  // "From a photo": the photo (and the words, if any) → the same draft, marked AI estimate; the photo is never kept.
  async function fromPhoto(file: File) {
    setProblem(null)
    try {
      const e = await photo.mutateAsync({ file, text })
      applyEstimate(e, text.trim() || 'Meal')
      setPhotoCost(e.costUsd)
    } catch { /* the hook reports it */ }
  }

  function submit() {
    if (!draft) { void estimate(); return }
    const p = draftProblem(draft)
    if (p) { setProblem(p); return }
    const line = { date, slot, title: draft.name.trim(), kcal: draft.kcal ?? 0, protein: draft.protein ?? 0, carbs: draft.carbs ?? 0, fat: draft.fat ?? 0, sugar: draft.sugar ?? 0 }
    log.mutate(line, {
      onSuccess: () => {
        if (callId) learn.mutate({ callId, saved: { title: line.title, portion: draft.portion.trim() || null, calories: line.kcal, protein_g: line.protein, carbs_g: line.carbs, fat_g: line.fat, sugar_g: line.sugar } })
        onClose()
      },
    })
  }

  function saveAsPreset() {
    if (!draft) return
    setSaving(true)
  }

  const busy = describe.isPending || log.isPending || photo.isPending
  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      compact
      dismissible={!log.isPending}
      title="Describe it"
      subtitle={`Logs to ${slotName} after you check it`}
      footer={
        <div className="flex items-center gap-2">
          {draft && <Button size="sm" className="mr-auto" onClick={saveAsPreset} disabled={busy}>Save as preset</Button>}
          <Button size="sm" variant="ghost" className={draft ? '' : 'ml-auto'} onClick={onClose} disabled={log.isPending}>Cancel</Button>
          <Button size="sm" type="submit" form={FORM_ID} variant="primary" loading={draft ? log.isPending : describe.isPending} icon={draft ? undefined : <Sparkles />}>
            {draft ? `Log ${draft.kcal ?? 0} kcal` : 'Estimate'}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="flex flex-col gap-1">
          <div className="flex items-end justify-between gap-2">
            <label htmlFor={textId} className="field-label mb-0">What did you have?</label>
            <PhotoButton variant="ghost" iconOnly={!!draft} className="-my-1.5 ml-auto" onFile={f => { void fromPhoto(f) }} loading={photo.isPending} disabled={describe.isPending || log.isPending}>
              From a photo
            </PhotoButton>
            {draft && (
              <button type="button" className={chipClass('quiet', '-my-1.5 -mr-1.5')} disabled={describe.isPending} aria-busy={describe.isPending || undefined}
                onClick={() => { void estimate() }}>
                <Sparkles aria-hidden /> {describe.isPending ? 'Estimating…' : 'Estimate again'}
              </button>
            )}
          </div>
          <textarea id={textId} value={text} onChange={e => { setText(e.target.value); setProblem(null) }} rows={2} maxLength={500} autoFocus={!initialText}
            placeholder="e.g. two slices of pepperoni pizza and a 0.5 L cola" className="input min-h-[3.5rem] w-full resize-y py-2" />
        </div>
        {draft && (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TonePill tone="info">{from ? KNOWN_GUESS_NOTE[from] : `AI estimate${costNote(photoCost) ? ` ${costNote(photoCost)}` : ''}`}</TonePill>
              <span className="text-meta text-fg-muted">check the numbers before you log</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="field-label">Name in the diary</span>
              <input value={draft.name} onChange={e => set('name', e.target.value)} maxLength={60} className="input w-full" />
            </label>
            <div>
              <p className="field-label mb-1">{draft.portion ? `For ${draft.portion}` : 'All of it'} (kcal, then grams)</p>
              <div className="grid grid-cols-5 gap-2">
                {MACROS.map(m => (
                  <label key={m.key} className="flex min-w-0 flex-col gap-1">
                    <span className="text-micro font-semibold text-fg-muted">{m.label}</span>
                    <DecimalInput value={draft[m.key]} onValue={v => set(m.key, v)} aria-label={m.key === 'kcal' ? 'Kcal' : `${m.label} (g)`}
                      className="input w-full px-2 text-right tabular-nums" />
                  </label>
                ))}
              </div>
            </div>
            {assumed.length > 0 && (
              <div>
                <p className="field-label mb-0.5">The AI assumed</p>
                <ul className="list-disc space-y-0.5 pl-5 text-meta text-fg-muted">
                  {assumed.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
        {problem && <p role="alert" className="text-meta text-danger">{problem}</p>}
      </form>
      {saving && draft && <QuickGuessSheet item={null} initial={draft} onClose={() => setSaving(false)} />}
    </ModalShell>
  )
}
