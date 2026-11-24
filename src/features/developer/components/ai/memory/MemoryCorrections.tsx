import { Undo2, X } from 'lucide-react'
import { Button, Truncate } from '../../../../../shared/ui'
import { useLearnCorrections, useSetLearnState } from '../../../../ai/claude/hooks/useLearn'
import { CORRECTION_KIND_LABEL, fieldWords, jobWords, LEARN_WIRED, type AiCorrection } from '../../../../ai/claude/learnRules'
import { Group, ReadState, StatePill } from './memoryBits'
import { day, useValueWords } from './memoryDay'

// Fixes: each AI-filled field the owner saved, as the function worked it out from ITS OWN copy of the answer (the browser
// sends only what it saved). Ignore takes a fix out of the count toward a rule; Count again puts it back (both with Undo).

function Row({ c, onState, busy, words }: { c: AiCorrection; onState: (state: 'counted' | 'ignored') => void; busy: boolean; words: (field: string, value: string | null) => string }) {
  const tone = c.kind === 'kept' ? 'success' : c.kind === 'edited' ? 'accent' : 'neutral'
  const ai = words(c.field, c.ai_value)
  const you = c.saved_value === null ? '(left out)' : words(c.field, c.saved_value)
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-body text-fg"><span className="font-medium">{fieldWords(c.field)}</span> <span className="text-fg-muted">· {jobWords(c.job)}</span></p>
        <StatePill tone={tone}>{CORRECTION_KIND_LABEL[c.kind]}</StatePill>
      </div>
      {(c.ai_value !== null || c.saved_value !== null) && (
        <Truncate as="p" lines={2} className="text-meta text-fg-2">{`AI: ${ai}${c.kind === 'kept' ? '' : ` → you: ${you}`}`}</Truncate>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-meta text-fg-muted">{day(c.created_at)}{c.source === 'suggestion' ? ' · a dismissed suggestion' : c.source === 'chat_proposal' ? ' · Ask AI' : ''}{c.state === 'ignored' ? ' · ignored' : ''}</span>
        {c.kind === 'edited' && c.state === 'counted' && <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => onState('ignored')} className="ml-auto">Ignore</Button>}
        {c.state === 'ignored' && <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => onState('counted')} className="ml-auto">Count again</Button>}
      </div>
    </li>
  )
}

export function MemoryCorrections() {
  const q = useLearnCorrections()
  const set = useSetLearnState()
  const words = useValueWords()
  const list = q.data ?? []
  const changed = list.filter(c => c.kind !== 'kept')
  const kept = list.filter(c => c.kind === 'kept')
  const share = list.length ? Math.round((kept.length / list.length) * 100) : 0
  const change = (c: AiCorrection, state: 'counted' | 'ignored') => set.mutate({ table: 'ai_corrections', id: c.id, state, said: state === 'ignored' ? 'Fix ignored' : 'Fix counted again' })
  const row = (c: AiCorrection) => <Row key={c.id} c={c} busy={set.isPending} words={words} onState={s => change(c, s)} />
  return (
    <>
      {list.length > 0 && <p className="text-meta tabular-nums text-fg-2">{list.length} fields reviewed · {share} % kept as the AI wrote them</p>}
      <ReadState query={q} what="the fixes" count={list.length} empty={`No fixes yet. They come when you save what an AI filled: ${LEARN_WIRED}`} />
      <Group title="Changed or left out" count={changed.length}>{changed.map(row)}</Group>
      {kept.length > 0 && (
        <details>
          <summary className="cursor-pointer px-1 text-meta font-medium text-fg-2">Kept as written · {kept.length}</summary>
          <ul className="card mt-1.5 divide-y divide-line overflow-hidden">{kept.slice(0, 100).map(row)}</ul>
        </details>
      )}
    </>
  )
}
