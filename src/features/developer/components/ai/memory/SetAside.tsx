import { useState } from 'react'
import { ShieldOff } from 'lucide-react'
import { Button } from '../../../../../shared/ui'
import { DateInput } from '../../../../../shared/components/DateInput'
import { useQuarantineLearning } from '../../../../ai/claude/hooks/useLearn'
import { SET_ASIDE_LABEL, SET_ASIDE_SOURCES, type SetAsideSource } from '../../../../ai/claude/learnRules'

// "Set aside what was learned": everything from one source (a note's, or a case's: typed by you, or read text you only
// confirmed), or everything learned on or after a day. Notes wait again, cases are set aside, rules wait again. Nothing is
// deleted, and "N set aside · Undo" puts each one back.

export function SetAside() {
  const q = useQuarantineLearning()
  const [source, setSource] = useState<SetAsideSource | ''>('weekly_batch')
  const [after, setAfter] = useState('')
  return (
    <details className="card p-3">
      <summary className="flex cursor-pointer items-center gap-1.5 text-body font-medium text-fg"><ShieldOff aria-hidden className="h-4 w-4" />Set aside what was learned</summary>
      <p className="mt-1 text-meta text-fg-muted">Notes wait for you again, cases are set aside, rules wait again. Nothing is deleted, and Undo puts each one back.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-meta text-fg-2">From
          <select className="select max-w-md" value={source} onChange={e => setSource(e.target.value as SetAsideSource | '')}>
            <option value="">any source</option>
            {SET_ASIDE_SOURCES.map(s => <option key={s} value={s}>{SET_ASIDE_LABEL[s]}</option>)}
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
