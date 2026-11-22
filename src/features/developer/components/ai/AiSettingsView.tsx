import { useState, type ReactNode } from 'react'
import { Button, Card, PageBoard, SectionLabel, Skeleton, Switch } from '../../../../shared/ui'
import { useRememberedCount } from '../../../../shared/hooks/useLayoutMemory'
import { useAiJobSettings, useAiSettings, useClaudeDescribe, useSaveAiSettings } from '../../../ai/claude/hooks/useClaude'
import { formatUsd, jobSettingsOf, readIntInput, readSettings, readUsdInput } from '../../../ai/claude/ledgerRules'
import type { AiSettings, Describe } from '../../../ai/claude/types'
import { AI_SETTINGS_BOARD, type AiSettingsSection } from '../../developerBoards'
import { AiJobSettingsCard } from './AiJobSettingsCard'
import { ReadFailed, Term } from './aiBits'

// Developer → AI → Settings: the master switch, the total monthly budget, the text log, and each job's own settings. Every choice
// and limit comes from the function (`describe`), never a list of the app's own; what is saved here is input to
// the function, which checks it again against the same lists and limits. Each card has one Save, and says its result.

function GeneralForm({ stored, about }: { stored: AiSettings; about: Describe }) {
  const save = useSaveAiSettings()
  const [aiEnabled, setAiEnabled] = useState(stored.ai_enabled)
  const [budget, setBudget] = useState(stored.monthly_budget_usd.toFixed(2))
  const [logText, setLogText] = useState(stored.log_text)
  const [days, setDays] = useState(String(stored.log_days))

  const { monthlyBudgetMaxUsd, logDays, callsPerMinute, callsPerDay } = about.limits
  const budgetValue = readUsdInput(budget, monthlyBudgetMaxUsd)
  const daysValue = readIntInput(days, logDays.min, logDays.max)
  const valid = typeof budgetValue === 'number' && typeof daysValue === 'number'
  const dirty = aiEnabled !== stored.ai_enabled || budgetValue !== stored.monthly_budget_usd || logText !== stored.log_text || daysValue !== stored.log_days

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>All AI</SectionLabel>
          <span className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-fg-2">
            {aiEnabled ? 'On' : 'Off'}
            <Switch on={aiEnabled} onChange={setAiEnabled} label="All AI: switched on" />
          </span>
        </div>
        <p data-tone={aiEnabled ? undefined : 'warn'} className={aiEnabled ? 'text-meta text-fg-muted' : 'tone-text text-meta font-medium'}>
          {aiEnabled
            ? 'The master switch. Off stops every AI job at once, the Kobo’s and the phone’s too; each is logged as “Switched off” and nothing is sent.'
            : 'Off: every AI job is stopped, the Kobo’s and the phone’s too. Save to apply it.'}
        </p>
      </div>
      <div className="border-t border-line pt-3">
        <SectionLabel><Term term="Budget">Monthly budget</Term></SectionLabel>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-body text-fg-muted">$</span>
          <input value={budget} onChange={e => setBudget(e.target.value)} inputMode="decimal" aria-label="Monthly budget in dollars"
            aria-invalid={!(typeof budgetValue === 'number') || undefined} className="input w-28 tabular-nums" />
          <span className="text-meta text-fg-muted">per month, every job together</span>
        </div>
        {typeof budgetValue !== 'number' && (
          <p role="alert" data-tone="danger" className="tone-text mt-1 text-meta">An amount from {formatUsd(0)} to {formatUsd(monthlyBudgetMaxUsd)}</p>
        )}
        <p className="mt-1.5 text-meta text-fg-muted">
          When this month’s cost reaches it, every AI call stops until next month. The most it can be is {formatUsd(monthlyBudgetMaxUsd)}: that
          ceiling is in the function’s code, with {callsPerMinute} calls a minute and {callsPerDay} a day.
        </p>
      </div>
      <div className="border-t border-line pt-3">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Keep the text of calls</SectionLabel>
          <span className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-fg-2">
            {logText ? 'On' : 'Off'}
            <Switch on={logText} onChange={setLogText} label="Keep the text of calls" />
          </span>
        </div>
        <p className="text-meta text-fg-muted">What was sent and what came back, shown under Calls. Only you can read it.</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-body text-fg-2">Keep it for</span>
          <input value={days} onChange={e => setDays(e.target.value)} inputMode="numeric" aria-label="Days the text is kept"
            aria-invalid={!(typeof daysValue === 'number') || undefined} className="input w-20 tabular-nums" />
          <span className="text-body text-fg-2">days</span>
        </div>
        {typeof daysValue !== 'number' && (
          <p role="alert" data-tone="danger" className="tone-text mt-1 text-meta">{logDays.min}–{logDays.max} days</p>
        )}
        <p className="mt-1.5 text-meta text-fg-muted">Text already saved stays until its days have passed.</p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || !valid} loading={save.isPending}
          onClick={() => { if (typeof budgetValue === 'number' && typeof daysValue === 'number') save.mutate({ monthly_budget_usd: budgetValue, log_text: logText, log_days: daysValue, ai_enabled: aiEnabled }) }}>
          Save
        </Button>
      </div>
    </Card>
  )
}

export function AiSettingsView() {
  const about = useClaudeDescribe()
  const settings = useAiSettings()
  const jobSettings = useAiJobSettings()
  const jobs = about.data?.jobs ?? []
  const jobsRoom = useRememberedCount('ai:settingsJobs', jobs.length, !about.isLoading && !about.isError, 1)

  // The choices and limits come from the function: without its answer there is nothing to choose from.
  if (about.isError) {
    return <ReadFailed what="the function’s models and limits" error={about.error} onRetry={() => { void about.refetch() }} retrying={about.isFetching} />
  }

  const stored = about.data && settings.isSuccess ? readSettings(settings.data, about.data.defaults) : null
  const sections: Record<AiSettingsSection, ReactNode> = {
    general: settings.isError
      ? <ReadFailed what="your AI settings" error={settings.error} onRetry={() => { void settings.refetch() }} retrying={settings.isFetching} />
      : !about.data || !stored
        ? <Skeleton rounded="rounded-card" className="h-[26rem] w-full" />
        : <GeneralForm key={`${stored.monthly_budget_usd}|${stored.log_text}|${stored.log_days}|${stored.ai_enabled}`} stored={stored} about={about.data} />,
    jobs: jobSettings.isError
      ? <ReadFailed what="the jobs’ settings" error={jobSettings.error} onRetry={() => { void jobSettings.refetch() }} retrying={jobSettings.isFetching} />
      : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] items-start gap-3">
          {!about.data || !jobSettings.isSuccess
            ? Array.from({ length: jobsRoom }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-[15rem] w-full max-w-[40rem]" />)
            : about.data.jobs.map(job => {
              const own = jobSettingsOf(jobSettings.data, job.name)
              return <AiJobSettingsCard key={`${job.name}|${JSON.stringify(own)}`} job={job} stored={own} about={about.data} />
            })}
        </div>
      ),
  }

  return <PageBoard sections={sections} layout={AI_SETTINGS_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
