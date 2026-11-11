// ─────────────────────────────────────────────────────────────────────────────
//  ✨ on the item screen (step 4 of docs/features/item-screen-plan.md): the
//  button beside the title, and under the title either its field ("Describe
//  it…" · Fill · ×) or, after a fill, the review line (what was filled ·
//  Cancel · Use these). The logic is useItemFill's.
// ─────────────────────────────────────────────────────────────────────────────

import { useLayoutEffect, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button, IconButton, cx, Truncate } from '../../ui'
import { useMotion } from '../../hooks/useMotion'
import { FILL_TEXT_MAX } from '../../../features/items/itemFill'
import { LINE } from './ItemRows'
import { fillWords } from './itemFillForm'
import type { ItemFillState } from './useItemFill'

/** ✨ beside the title: opens the field (or closes it); quiet while a fill waits to be kept. */
export function FillButton({ fill }: { fill: ItemFillState }) {
  const asking = fill.step === 'asking'
  return (
    <IconButton label={asking ? 'Close the sentence field' : 'Fill the fields from a sentence'} aria-expanded={asking}
      disabled={fill.reviewing || fill.busy} onClick={asking ? fill.close : fill.ask}
      className={cx('-my-1 shrink-0', (asking || fill.reviewing) && 'text-accent-600')}>
      <Sparkles aria-hidden />
    </IconButton>
  )
}

/** Under the title: the sentence field while asking, the review line while a fill waits; nothing otherwise. */
export function FillPanel({ fill, editing }: { fill: ItemFillState; editing: boolean }) {
  const motion = useMotion()
  if (fill.step === 'asking') return <FillField fill={fill} className={motion ? 'motion-pop-in' : undefined} />
  if (fill.step !== 'review') return null
  const said = `Filled ${fillWords(fill.fields)}${editing ? ' · not saved yet' : ''}`
  return (
    <div role="status" className={cx(LINE, 'flex items-center gap-2 px-3.5 py-1.5', motion && 'motion-pop-in')}>
      <span data-tone="accent" className="tone-text inline-flex shrink-0"><Sparkles aria-hidden className="h-4 w-4" /></span>
      <Truncate className="min-w-0 flex-1 text-meta text-fg-muted">{said}</Truncate>
      <Button size="sm" variant="ghost" onClick={fill.cancel}>Cancel</Button>
      <Button size="sm" onClick={fill.accept}>Use these</Button>
    </div>
  )
}

function FillField({ fill, className }: { fill: ItemFillState; className?: string }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  // Grows with a long sentence, as the title does.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [text])
  const send = () => { if (text.trim()) fill.submit(text) }
  return (
    <div className={cx(LINE, 'flex items-start gap-2 px-3.5 py-1.5', className)}>
      <textarea
        ref={ref} rows={1} value={text} autoFocus maxLength={FILL_TEXT_MAX} placeholder="Describe it…"
        aria-label="Describe the item in a sentence — day, time, place, reminders"
        onChange={e => setText(e.target.value.replace(/\s*\n+\s*/g, ' '))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
        autoComplete="off" enterKeyHint="go"
        className="input-bare min-w-0 flex-1 resize-none overflow-hidden border-b-0 py-1.5 text-lead"
      />
      <Button size="sm" onClick={send} loading={fill.busy} disabled={!text.trim()}>{fill.busy ? 'Filling…' : 'Fill'}</Button>
      <IconButton label="Close the sentence field" onClick={fill.close} disabled={fill.busy} className="shrink-0"><X aria-hidden /></IconButton>
    </div>
  )
}
