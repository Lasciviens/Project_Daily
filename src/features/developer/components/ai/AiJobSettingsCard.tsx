import { useState, type ReactNode } from 'react'
import { Button, Card, Switch, cx } from '../../../../shared/ui'
import { useSaveAiJobSettings } from '../../../ai/claude/hooks/useClaude'
import { formatCount, formatUsd, modelNameOf, readIntInput, readUsdInput } from '../../../ai/claude/ledgerRules'
import type { AiJobSettings, Describe, DescribeJob } from '../../../ai/claude/types'
import { Term } from './aiBits'

// One job's settings (Developer → AI → Settings): on or off, and five values that are each "Default" until the
// owner picks one — stored as null, so a changed default in the function reaches the job by itself. The choices
// and limits are the function's own (`describe`); it checks every stored value again before it uses one.

/** A labelled control. Not a <label>: the label holds an ⓘ button, which a <label> would take as its control. */

function Field({ label, error, className, children }: { label: ReactNode; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <span className="field-label">{label}</span>
      {children}
      {error && <span role="alert" data-tone="danger" className="tone-text mt-1 text-meta">{error}</span>}
    </div>
  )
}

export function AiJobSettingsCard({ job, stored, about }: { job: DescribeJob; stored: AiJobSettings; about: Describe }) {
  const save = useSaveAiJobSettings()
  const [enabled, setEnabled] = useState(stored.enabled)
  const [model, setModel] = useState(stored.model ?? '')
  const [effort, setEffort] = useState(stored.effort ?? '')
  const [thinking, setThinking] = useState<string>(stored.thinking ?? '')
  const [longest, setLongest] = useState(stored.max_output_tokens == null ? '' : String(stored.max_output_tokens))
  const [budget, setBudget] = useState(stored.monthly_budget_usd == null ? '' : stored.monthly_budget_usd.toFixed(2))

  const { maxOutputTokens, monthlyBudgetMaxUsd } = about.limits
  const longestValue = readIntInput(longest, maxOutputTokens.min, maxOutputTokens.max)
  const budgetValue = readUsdInput(budget, monthlyBudgetMaxUsd)
  const valid = longestValue !== undefined && budgetValue !== undefined
  const next: AiJobSettings = {
    job: job.name, enabled, model: model || null, effort: effort || null,
    thinking: thinking === 'off' ? 'off' : thinking === 'adaptive' ? 'adaptive' : null,
    max_output_tokens: longestValue ?? null, monthly_budget_usd: budgetValue ?? null,
  }
  const dirty = next.enabled !== stored.enabled || next.model !== stored.model || next.effort !== stored.effort || next.thinking !== stored.thinking
    || next.max_output_tokens !== stored.max_output_tokens || next.monthly_budget_usd !== stored.monthly_budget_usd
  const changed = model !== '' || effort !== '' || thinking !== '' || longest.trim() !== '' || budget.trim() !== ''

  function backToDefaults() {
    setModel(''); setEffort(''); setThinking(''); setLongest(''); setBudget('')
  }

  return (
    <Card className="flex max-w-[40rem] flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lead font-semibold text-fg">{job.title}</p>
          <p className="text-meta text-fg-muted"><span className="font-mono">{job.name}</span>{job.version && <> · <span className="whitespace-nowrap">instructions version {job.version}</span></>}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-fg-2">
          {enabled ? 'On' : 'Off'}
          <Switch on={enabled} onChange={setEnabled} label={`${job.title}: switched on`} />
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-2.5">
        <Field className="min-w-[13rem] flex-[2]" label={<Term term="Model">Model</Term>}>
          <select value={model} onChange={e => setModel(e.target.value)} aria-label={`${job.title}: model`} className="select">
            <option value="">Default ({modelNameOf(about.models, job.defaults.model)})</option>
            {about.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            {model !== '' && !about.models.some(m => m.id === model) && <option value={model}>{model} (not offered — the default is used)</option>}
          </select>
        </Field>
        <Field className="min-w-[8rem] flex-1" label={<Term term="Effort">Effort</Term>}>
          <select value={effort} onChange={e => setEffort(e.target.value)} aria-label={`${job.title}: effort`} className="select">
            <option value="">Default ({job.defaults.effort})</option>
            {about.efforts.map(e => <option key={e} value={e}>{e}</option>)}
            {effort !== '' && !about.efforts.includes(effort) && <option value={effort}>{effort} (not offered — the default is used)</option>}
          </select>
        </Field>
        <Field className="min-w-[8rem] flex-1" label={<Term term="Thinking">Thinking</Term>}>
          <select value={thinking} onChange={e => setThinking(e.target.value)} aria-label={`${job.title}: thinking`} className="select">
            <option value="">Default (adaptive)</option>
            <option value="adaptive">Adaptive</option>
            <option value="off">Off (cheaper, faster)</option>
          </select>
        </Field>
        <Field
          className="min-w-[8rem] flex-1" label={<Term term="Longest answer">Longest answer</Term>}
          error={longestValue === undefined ? `${formatCount(maxOutputTokens.min)}–${formatCount(maxOutputTokens.max)} tokens` : undefined}
        >
          <input value={longest} onChange={e => setLongest(e.target.value)} inputMode="numeric" placeholder={`Default (${formatCount(job.defaults.maxOutputTokens)})`}
            aria-label={`${job.title}: longest answer in tokens`} aria-invalid={longestValue === undefined || undefined} className="input max-w-[12rem] tabular-nums" />
        </Field>
        <Field
          className="min-w-[8rem] flex-1" label={<Term term="Budget">Own budget / month</Term>}
          error={budgetValue === undefined ? `${formatUsd(0)}–${formatUsd(monthlyBudgetMaxUsd)}, in dollars` : undefined}
        >
          <input value={budget} onChange={e => setBudget(e.target.value)} inputMode="decimal" placeholder="Default (none)"
            aria-label={`${job.title}: own monthly budget in dollars`} aria-invalid={budgetValue === undefined || undefined} className="input max-w-[12rem] tabular-nums" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {changed && <Button size="sm" variant="ghost" onClick={backToDefaults}>Back to defaults</Button>}
        <Button size="sm" disabled={!dirty || !valid} loading={save.isPending} onClick={() => save.mutate({ input: next, title: job.title })}>Save</Button>
      </div>
    </Card>
  )
}
