import { useMemo, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardHeader, MetaLine, PageBoard, SectionLabel, Skeleton, Truncate, cx } from '../../../../shared/ui'
import { useRememberedCount } from '../../../../shared/hooks/useLayoutMemory'
import { formatDateRange } from '../../../../shared/utils/dateFormat'
import { useAiJobSettings, useAiSettings, useAiUsageMonth, useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import {
  avgCostUsd, avgDurationMs, budgetProgress, cacheEffect, cacheHitPercent, daysBetween, formatCount, formatDuration, formatTokens, formatUsd,
  jobSettingsOf, jobTitleOf, modelNameOf, num, totalsByDay, totalsByJob, totalsByModel, usageTotals,
} from '../../../ai/claude/ledgerRules'
import { AI_OVERVIEW_BOARD, type AiOverviewSection, type AiView } from '../../developerBoards'
import { AiCostChart } from './AiCostChart'
import { ReadFailed, Term } from './aiBits'

// Developer → AI → Overview: this Oslo month's cost against the budget, the calls and tokens behind it, what
// the cache saved, the cost per job and a bar per day. Each card shows as its own reads land, in the room it
// keeps (THEME.md §5); with no call yet it reads as an empty month, never as a failure.

/** A number's place while its read is on its way: the line it will take. */
const Wait = ({ className }: { className: string }) => <Skeleton rounded="rounded-md" className={className} />

/** One number with its eyebrow label and a line of context (the StatTile look, with room kept while loading). */
function Figure({ label, value, hint, loading, tone, wrap }: { label: ReactNode; value: string; hint: string; loading: boolean; tone?: 'danger'; wrap?: boolean }) {
  return (
    <div className="card flex min-w-0 flex-col p-4">
      <span className="section-label">{label}</span>
      <span className="mt-1.5 flex h-[30px] items-center">
        {loading ? <Wait className="h-6 w-14" /> : <span data-tone={tone} className={cx('text-kpi font-bold tabular-nums tracking-tight', tone ? 'tone-text' : 'text-fg')}>{value}</span>}
      </span>
      <span className={cx('mt-0.5 flex items-center', wrap && !loading ? 'min-h-4' : 'h-4')}>
        {loading ? <Wait className="h-2.5 w-20" /> : wrap ? <span className="min-w-0 text-meta text-fg-muted">{hint}</span> : <Truncate className="min-w-0 text-meta text-fg-muted">{hint}</Truncate>}
      </span>
    </div>
  )
}

export function AiOverview({ onOpen }: { onOpen: (view: AiView) => void }) {
  const usage = useAiUsageMonth()
  const about = useClaudeDescribe()
  const settings = useAiSettings()
  const jobSettings = useAiJobSettings()
  const { month } = usage

  const rows = usage.data
  const totals = useMemo(() => usageTotals(rows ?? []), [rows])
  const days = useMemo(() => totalsByDay(rows ?? [], daysBetween(month.firstDay, month.today)), [rows, month.firstDay, month.today])
  const cache = useMemo(() => (about.data ? cacheEffect(rows ?? [], about.data.prices) : null), [rows, about.data])

  // The budget is the stored row's, or — with no row yet — the function's own default.
  const budgetKnown = settings.isSuccess && (settings.data != null || about.isSuccess)
  const budget = settings.data != null ? num(settings.data.monthly_budget_usd) : about.data?.defaults.monthlyBudgetUsd ?? 0
  const progress = budgetProgress(totals.cost_usd, budget)
  const budgetFailed = settings.isError || (settings.isSuccess && settings.data == null && about.isError)

  // Every job the function has, with this month's numbers; a job it no longer lists keeps its row by its name.
  const jobRows = useMemo(() => {
    const used = totalsByJob(rows ?? [])
    const listed = (about.data?.jobs ?? []).filter(j => !used.some(u => u.job === j.name)).map(j => ({ ...usageTotals([]), job: j.name }))
    return [...used, ...listed].map(r => {
      const own = jobSettingsOf(jobSettings.data ?? [], r.job)
      return {
        ...r, title: jobTitleOf(about.data?.jobs, r.job), off: !own.enabled, budget: own.monthly_budget_usd, thinkingOff: own.thinking === 'off',
        models: totalsByModel(rows ?? [], r.job),
      }
    })
  }, [rows, about.data, jobSettings.data])
  // A job with no call this month and no switch turned off is not worth a row of its own: one line counts them.
  const shownRows = jobRows.filter(r => r.calls > 0 || r.off)
  const quietJobs = jobRows.length - shownRows.length
  const masterOff = settings.isSuccess && settings.data != null && settings.data.ai_enabled === false
  const jobsLoading = usage.isLoading || about.isLoading || jobSettings.isLoading
  const jobsRoom = useRememberedCount('ai:jobs', shownRows.length + (quietJobs > 0 ? 1 : 0), !jobsLoading && !usage.isError && !about.isError && !jobSettings.isError, 1)

  const sections: Record<AiOverviewSection, ReactNode> = {
    budget: (
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel>This month</SectionLabel>
          <span className="text-meta tabular-nums text-fg-muted">{formatDateRange(month.firstDay, month.lastDay)}</span>
        </div>
        {usage.isError
          ? <ReadFailed className="mt-2" what="this month’s usage" error={usage.error} onRetry={() => { void usage.refetch() }} retrying={usage.isFetching} />
          : (
            <>
              <p className="mt-1.5 flex h-[30px] items-baseline gap-1.5">
                {usage.isLoading
                  ? <Wait className="h-6 w-24 self-center" />
                  : <span className="text-kpi font-bold tabular-nums tracking-tight text-fg">{formatUsd(totals.cost_usd)}</span>}
                {budgetKnown && <span className="text-meta tabular-nums text-fg-muted">of {formatUsd(budget)} budget</span>}
              </p>
              <div
                role="progressbar" aria-label="Share of the monthly budget used" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={usage.isLoading || !budgetKnown ? undefined : Math.min(100, progress.percent)}
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
              >
                {!usage.isLoading && budgetKnown && totals.cost_usd > 0 && (
                  <div data-tone={progress.tone} className="tone-solid h-full min-w-1 rounded-full" style={{ width: `${progress.share * 100}%` }} />
                )}
              </div>
              {masterOff && (
                <p data-tone="warn" className="tone-text mt-2 text-meta font-medium">All AI is switched off — every job is stopped until you switch it on in Settings.</p>
              )}
              {!usage.isLoading && totals.held_calls > 0 && (
                <p className="mt-2 text-meta text-fg-muted">
                  <Term term="Reserved (held at worst case)">
                    <span className="tabular-nums font-medium text-fg-2">{formatUsd(totals.held_cost_usd)}</span>
                  </Term>{' '}
                  of this is held at worst case for {formatCount(totals.held_calls)} {totals.held_calls === 1 ? 'call' : 'calls'} whose real bill is unknown.
                </p>
              )}
              <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                {budgetFailed
                  ? <ReadFailed what="the budget" error={settings.error ?? about.error} onRetry={() => { void settings.refetch(); void about.refetch() }} retrying={settings.isFetching || about.isFetching} />
                  : usage.isLoading || !budgetKnown
                    ? <Wait className="h-2.5 w-32" />
                    : (
                      <p data-tone={progress.state === 'ok' ? undefined : progress.tone} className={cx('text-meta tabular-nums', progress.state === 'ok' ? 'text-fg-muted' : 'tone-text font-medium')}>
                        {progress.state === 'over'
                          ? 'Budget reached — AI calls are stopped until next month or a higher budget'
                          : `${progress.percent}% used · ${formatUsd(progress.left)} left${progress.state === 'near' ? ' — close to the budget' : ''}`}
                      </p>
                    )}
                <button type="button" onClick={() => onOpen('settings')} className="inline-flex shrink-0 items-center gap-0.5 text-meta font-semibold text-accent-600">
                  Change budget <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
      </Card>
    ),
    stats: usage.isError ? null : (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Figure
            label="Calls" loading={usage.isLoading} value={formatCount(totals.calls)}
            hint={totals.calls === 0 ? 'No calls yet this month' : totals.failed === 0 ? 'All answered' : `${formatCount(totals.failed)} not answered`}
          />
          <Figure
            label={<Term term="Cache">Cache saved</Term>} loading={usage.isLoading || about.isLoading}
            wrap value={cache ? `${cache.net < 0 ? '−' : ''}${formatUsd(Math.abs(cache.net))}` : '—'}
            hint={!cache ? 'Prices not loaded' : cache.net < 0 ? 'Written to the cache, not read back yet — pays off on the next call' : cache.readTokens > 0 ? `${formatTokens(cache.readTokens)} tokens read from it` : 'Nothing read from it yet'}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Figure
            label="Average time" loading={usage.isLoading}
            value={avgDurationMs(totals) === null ? '—' : formatDuration(avgDurationMs(totals))}
            hint={avgDurationMs(totals) === null ? 'No call has run yet' : `Slowest ${formatDuration(totals.max_duration_ms)}`}
          />
          <Figure
            label={<Term term="Cache">Cache hit</Term>} loading={usage.isLoading}
            value={cacheHitPercent(totals) === null ? '—' : `${cacheHitPercent(totals)}%`}
            hint={cacheHitPercent(totals) === null ? 'Nothing sent yet' : 'of the prompt cached'}
          />
        </div>
        <Card>
          <Term term="Token"><SectionLabel>Tokens</SectionLabel></Term>
          <ul className="mt-2 grid grid-cols-5 gap-2">
            {([['Input', totals.input_tokens], ['Cached', totals.cache_read_tokens], ['Written', totals.cache_write_tokens], ['Output', totals.output_tokens], ['Thinking', totals.thinking_tokens]] as const).map(([label, n]) => (
              <li key={label} className="min-w-0">
                <span className="block text-meta text-fg-muted">{label}</span>
                <span className="flex h-[22px] items-center">
                  {usage.isLoading ? <Wait className="h-4 w-10" /> : <span className="text-lead font-semibold tabular-nums text-fg">{formatTokens(n)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    ),
    jobs: usage.isError ? null : (
      <Card>
        <CardHeader variant="label" title="Cost per job" />
        {jobsLoading
          ? <div className="flex flex-col gap-2">{Array.from({ length: jobsRoom }).map((_, i) => <Wait key={i} className="h-9 w-full" />)}</div>
          : jobRows.length === 0
            ? <p className="text-body text-fg-muted">No calls yet this month</p>
            : (
              <>
              <ul className="-my-1.5 divide-y divide-line">
                {shownRows.map(r => {
                  const own = r.budget == null ? null : budgetProgress(r.cost_usd, r.budget)
                  return (
                    <li key={r.job} className="flex items-center gap-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <Truncate className="block text-body font-medium text-fg">{r.title}</Truncate>
                        <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
                          `${formatCount(r.calls)} ${r.calls === 1 ? 'call' : 'calls'}`,
                          r.failed > 0 && `${formatCount(r.failed)} not answered`,
                          r.off && 'Switched off',
                          r.thinkingOff && 'Thinking off',
                        ]} />
                        {r.calls > 0 && (
                          <>
                            <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
                              avgDurationMs(r) !== null && `avg ${formatDuration(avgDurationMs(r))}`,
                              r.max_duration_ms > 0 && `slowest ${formatDuration(r.max_duration_ms)}`,
                              avgCostUsd(r) !== null && `${formatUsd(avgCostUsd(r), { fine: true })} a call`,
                              r.held_calls > 0 && `${formatUsd(r.held_cost_usd)} held`,
                            ]} />
                            <MetaLine className="text-meta tabular-nums text-fg-muted" items={[
                              cacheHitPercent(r) !== null && `cache ${cacheHitPercent(r)}%`,
                              r.thinking_tokens > 0 && `${formatTokens(r.thinking_tokens)} thinking`,
                              ...r.models.filter(m => m.model !== 'none').map(m => `${modelNameOf(about.data?.models, m.model).replace(/^Claude /, '')} ×${formatCount(m.calls)}`),
                            ]} />
                          </>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-body font-semibold tabular-nums text-fg">{formatUsd(r.cost_usd)}</p>
                        {own && (
                          <p data-tone={own.state === 'ok' ? undefined : own.tone} className={cx('text-meta tabular-nums', own.state === 'ok' ? 'text-fg-muted' : 'tone-text font-medium')}>
                            of {formatUsd(r.budget)}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {quietJobs > 0 && (
                <p className={cx('text-meta text-fg-muted', shownRows.length > 0 && 'mt-2 border-t border-line pt-2')}>
                  {formatCount(quietJobs)} {quietJobs === 1 ? 'job' : 'jobs'} with no calls this month
                </p>
              )}
              </>
            )}
        {about.isError && !jobsLoading && (
          <ReadFailed className="mt-2" what="the jobs’ names" error={about.error} onRetry={() => { void about.refetch() }} retrying={about.isFetching} />
        )}
      </Card>
    ),
    chart: usage.isError ? null : (
      <Card>
        <CardHeader variant="label" title="Cost per day" />
        <div className="h-40">
          {usage.isLoading
            ? <Skeleton rounded="rounded-row" className="h-full w-full" />
            : totals.calls === 0
              ? <p className="grid h-full place-items-center rounded-row border border-dashed border-line text-body text-fg-muted">No calls yet this month</p>
              : <AiCostChart days={days} />}
        </div>
      </Card>
    ),
  }

  return <PageBoard sections={sections} layout={AI_OVERVIEW_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
