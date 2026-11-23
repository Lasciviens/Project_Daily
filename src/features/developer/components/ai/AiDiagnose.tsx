import { Check, Stethoscope, X } from 'lucide-react'
import { Button, Card, CardHeader, cx } from '../../../../shared/ui'
import { useClaudeDiagnose } from '../../../ai/claude/hooks/useClaude'
import { diagnoseVerdict, stepSeconds } from '../../../ai/claude/ledgerRules'
import type { DiagnoseStep } from '../../../ai/claude/types'

// Developer → AI → Learn → How it works → Diagnose: the `claude` function's four checks of the road to Anthropic (✨'s request is the one it tries), then the chat's own request, one row
// each (a tick or a cross, its time, its sentence), under one plain verdict worked out from them. Two of the
// checks are real calls (a tiny answer, and ✨'s own request with a 90 s limit): they cost a fraction of a cent
// and appear in Calls as the job "Diagnose: a tiny answer" and "Fill an item from a sentence".

function StepRow({ step }: { step: DiagnoseStep }) {
  const tone = step.ok ? 'success' : 'danger'
  return (
    <li className="flex gap-2.5">
      <span data-tone={tone} className="tone-text mt-0.5 shrink-0" role="img" aria-label={step.ok ? 'Passed' : 'Failed'}>
        {step.ok ? <Check aria-hidden className="h-4 w-4" /> : <X aria-hidden className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-body font-semibold text-fg">
          <span>{step.title}</span>
          <span className="text-meta font-medium tabular-nums text-fg-muted">{stepSeconds(step.ms)}</span>
        </p>
        <p className="break-words text-meta text-fg-2">{step.detail}</p>
      </div>
    </li>
  )
}

export function AiDiagnose() {
  const diagnose = useClaudeDiagnose()
  const steps = diagnose.data
  const verdict = steps ? diagnoseVerdict(steps) : null
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader variant="label" title="Check the connection to Anthropic" />
      <p className="text-body text-fg-2">
        Is a slow or failed call the connection, the key, the shape of the request or Anthropic’s own answer time? Four checks, each timed, using ✨’s request as the example, then a fifth: the chat’s own first request (its real tools). The last three are real calls: together they cost a fraction of a cent.
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="secondary" icon={<Stethoscope />} loading={diagnose.isPending} onClick={() => diagnose.mutate()}>
          {steps ? 'Check again' : 'Check the connection'}
        </Button>
        {diagnose.isPending && <p role="status" className="text-meta text-fg-muted">Checking… this can take up to 4 minutes.</p>}
      </div>
      {!diagnose.isPending && verdict && steps && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <p data-tone={verdict.tone} className={cx('break-words text-body font-semibold', verdict.tone !== 'neutral' && 'tone-text')}>{verdict.text}</p>
          <ol aria-label="The checks" className="flex flex-col gap-3">
            {steps.map(s => <StepRow key={s.name} step={s} />)}
          </ol>
        </div>
      )}
    </Card>
  )
}
