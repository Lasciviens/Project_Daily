import { useState } from 'react'
import { Check, History, ShieldOff, Undo2, X } from 'lucide-react'
import { Button } from '../../../../../shared/ui'
import { DateInput } from '../../../../../shared/components/DateInput'
import { useLearnLessons, useQuarantineLearning, useRollbackLesson, useSetLearnState } from '../../../../ai/claude/hooks/useLearn'
import { jobWords, latestLessons, LESSON_SOURCE_LABEL, LESSON_SOURCES, LESSON_STATE_LABEL, type AiLesson, type LessonSource, type LessonState } from '../../../../ai/claude/learnRules'
import { Group, ReadState, StatePill } from './memoryBits'
import { day } from './memoryDay'

// Notes (lessons): short facts and preferences with their source and trust. Only a plain fact from the owner's own words turns
// on by itself; anything that reads as an instruction waits for the owner's tap (the database refuses the function). A note
// reaches a call only as data, labelled with where it came from, never in the instructions. Versions are kept: Roll back puts
// the previous one on. "Set aside" re-quarantines everything from one source, or everything after a day.

const TRUST_LABEL = { high: 'trusted', medium: 'derived', low: 'outside' } as const

function Row({ l, versions, onState, onRollback, busy }: { l: AiLesson; versions: number; onState: (state: LessonState) => void; onRollback: () => void; busy: boolean }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-body text-fg">{l.text}</p>
        <StatePill tone={l.state === 'active' ? 'success' : l.state === 'pending' ? 'accent' : 'neutral'}>{LESSON_STATE_LABEL[l.state]}</StatePill>
      </div>
      <p className="text-meta text-fg-muted">
        {l.kind} · {l.scope === 'chat' ? 'Ask AI' : jobWords(l.scope)} · from {LESSON_SOURCE_LABEL[l.source_kind]} ({TRUST_LABEL[l.trust]}){versions > 1 ? ` · version ${l.version} of ${versions}` : ''} · {day(l.created_at)}
        {l.state === 'active' && l.approved_at ? ` · turned on ${day(l.approved_at)}` : l.state === 'active' ? ' · on by itself (your own words)' : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {l.state === 'pending' && <Button size="sm" icon={<Check />} disabled={busy} onClick={() => onState('active')}>Turn on</Button>}
        {l.state !== 'retired' && <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => onState('retired')}>{l.state === 'pending' ? 'Dismiss' : 'Retire'}</Button>}
        {l.state === 'retired' && <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => onState('pending')}>Bring back</Button>}
        {versions > 1 && l.state === 'active' && <Button size="sm" variant="ghost" icon={<History />} disabled={busy} onClick={onRollback}>Roll back</Button>}
      </div>
    </li>
  )
}

function Quarantine() {
  const q = useQuarantineLearning()
  const [source, setSource] = useState<LessonSource | ''>('weekly_batch')
  const [after, setAfter] = useState('')
  return (
    <details className="card p-3">
      <summary className="flex cursor-pointer items-center gap-1.5 text-body font-medium text-fg"><ShieldOff aria-hidden className="h-4 w-4" />Set aside what was learned</summary>
      <p className="mt-1 text-meta text-fg-muted">Notes go back to waiting, cases are set aside, rules wait again. Nothing is deleted: turn any of them on again from its card.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-meta text-fg-2">From
          <select className="select max-w-md" value={source} onChange={e => setSource(e.target.value as LessonSource | '')}>
            <option value="">any source</option>
            {LESSON_SOURCES.map(s => <option key={s} value={s}>{LESSON_SOURCE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-meta text-fg-2">Learned on or after
          <DateInput value={after} onChange={setAfter} />
        </label>
        <Button size="sm" variant="danger" loading={q.isPending} disabled={!source && !after}
          onClick={() => q.mutate({ source: source || null, after: after ? new Date(`${after}T00:00:00`).toISOString() : null })}>Set aside</Button>
      </div>
    </details>
  )
}

export function MemoryLessons() {
  const q = useLearnLessons()
  const set = useSetLearnState()
  const rollback = useRollbackLesson()
  const cards = latestLessons(q.data ?? [])
  const said: Record<LessonState, string> = { active: 'Note turned on', pending: 'Note waiting again', retired: 'Note retired' }
  const row = ({ lesson: l, versions }: { lesson: AiLesson; versions: number }) => (
    <Row key={l.id} l={l} versions={versions} busy={set.isPending || rollback.isPending}
      onState={state => set.mutate({ table: 'ai_lessons', id: l.id, state, said: said[state] })} onRollback={() => rollback.mutate(l.lesson_key)} />
  )
  const by = (s: LessonState) => cards.filter(c => c.lesson.state === s)
  return (
    <>
      <ReadState query={q} what="the notes" count={cards.length} empty="No notes yet. The weekly self-test proposes notes from your fixes, and they wait here for you." />
      <Group title="Waiting for you" count={by('pending').length}>{by('pending').map(row)}</Group>
      <Group title="On" count={by('active').length}>{by('active').map(row)}</Group>
      <Group title="Retired" count={by('retired').length}>{by('retired').map(row)}</Group>
      <Quarantine />
    </>
  )
}
