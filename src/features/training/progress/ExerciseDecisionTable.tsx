import { useState } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import { statusLabel, statusVerb, confidenceLabel, composeConfidenceSentence } from '../progressCopy'
import type { ExerciseDecision } from '../progressDecisions'

// Desktop: a dense decision table. Mobile (<640px): the same rows stack as
// cards — matches this repo's mobile-first rule (a desktop table becomes
// stacked cards on narrow screens, per CLAUDE.md's Width Standard). A tap
// on any row expands its own drill-down detail in place (evidence, the two
// confidence facets, the RPE-absent caveat when relevant) rather than
// navigating away — "detail on demand", not a hidden second screen.

const STATUS_TONE: Record<ExerciseDecision['status'], string> = {
  increase:          'bg-green-100 text-green-700',
  keep:              'bg-accent-100 text-accent-700',
  watch:             'bg-amber-100 text-amber-700',
  plateau:           'bg-amber-100 text-amber-700',
  insufficient_data: 'bg-ink-100 text-ink-500',
}

function ConfidencePill({ level }: { level: 'low' | 'medium' | 'high' }) {
  const tone = level === 'high' ? 'bg-green-100 text-green-700' : level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tone}`}>{confidenceLabel(level).replace(' confidence', '')}</span>
}

function DecisionDetail({ decision }: { decision: ExerciseDecision }) {
  return (
    <div className="bg-cream-100 rounded-xl p-3 mt-2 flex flex-col gap-2">
      <p className="text-xs font-semibold text-ink-700">
        {composeConfidenceSentence(decision.trendConfidence, decision.actionConfidence, decision.rpeEvidence != null)}
      </p>
      <ul className="flex flex-col gap-1">
        {decision.evidence.map((e, i) => (
          <li key={i} className="text-xs text-ink-600 flex items-start gap-1.5">
            <span className="text-ink-300 shrink-0">—</span><span>{e}</span>
          </li>
        ))}
      </ul>
      {decision.caveat && (
        <p className="text-xs italic text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{decision.caveat}</p>
      )}
      <p className="text-[11px] text-ink-400">Expectation: {decision.expectation.label} · Next check: {decision.nextCheck}</p>
    </div>
  )
}

function DecisionRow({ decision, title }: { decision: ExerciseDecision; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="border-b border-ink-100 cursor-pointer hover:bg-cream-100" onClick={() => setOpen(v => !v)}>
        <td className="py-2.5 px-3 text-sm font-semibold text-ink-800">{title}</td>
        <td className="py-2.5 px-3">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_TONE[decision.status]}`}>
            {statusVerb(decision.status)} {statusLabel(decision.status)}
          </span>
        </td>
        <td className="py-2.5 px-3"><ConfidencePill level={decision.trendConfidence} /></td>
        <td className="py-2.5 px-3">{decision.actionConfidence ? <ConfidencePill level={decision.actionConfidence} /> : <span className="text-ink-300 text-xs">—</span>}</td>
        <td className="py-2.5 px-3 text-xs text-ink-500">{decision.nextCheck}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-3 pb-2"><DecisionDetail decision={decision} /></td>
        </tr>
      )}
    </>
  )
}

function DecisionCard({ decision, title }: { decision: ExerciseDecision; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl border border-ink-200 p-3" onClick={() => setOpen(v => !v)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{title}</span>
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${STATUS_TONE[decision.status]}`}>
          {statusVerb(decision.status)} {statusLabel(decision.status)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <ConfidencePill level={decision.trendConfidence} />
        {decision.actionConfidence && <ConfidencePill level={decision.actionConfidence} />}
        <span className="text-[11px] text-ink-400 ml-auto">{decision.nextCheck}</span>
      </div>
      {open && <DecisionDetail decision={decision} />}
    </li>
  )
}

export function ExerciseDecisionTable() {
  const { isLoading, decisions, titleById, currentProgramSelected } = useProgressData()

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />

  if (decisions.length === 0) {
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-ink-500">No current-program exercises logged in this window yet.</p>
        {!currentProgramSelected && (
          <p className="text-xs text-ink-400 mt-1">No current program is selected yet — every logged session counts for now. Pick your current routines in Training → Coach → Profile for a more precise read.</p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-3">Current program · exercise decisions</p>
      {!currentProgramSelected && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-3">
          No current program selected — every logged exercise counts for now (nothing is filtered out). Pick your current routines in Training → Coach → Profile to scope this to what you&apos;re actually training today.
        </p>
      )}

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-ink-400 border-b-2 border-ink-200">
              <th className="py-2 px-3">Exercise</th>
              <th className="py-2 px-3">Decision</th>
              <th className="py-2 px-3">Trend</th>
              <th className="py-2 px-3">Action</th>
              <th className="py-2 px-3">Next check</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map(d => <DecisionRow key={d.templateId} decision={d} title={titleById.get(d.templateId) ?? 'Unknown exercise'} />)}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <ul className="sm:hidden flex flex-col gap-2">
        {decisions.map(d => <DecisionCard key={d.templateId} decision={d} title={titleById.get(d.templateId) ?? 'Unknown exercise'} />)}
      </ul>
    </div>
  )
}
