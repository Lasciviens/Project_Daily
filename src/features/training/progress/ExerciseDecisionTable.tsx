import { useState } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import { statusLabel, statusVerb, confidenceLabel, composeConfidenceSentence } from '../progressCopy'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import type { ExerciseDecision } from '../progressDecisions'

// Desktop: a dense decision table. Mobile (<640px): the same rows stack as
// cards. A tap on any row expands its own drill-down detail in place
// (evidence, the two confidence facets, the RPE-absent caveat when
// relevant) rather than navigating away — "detail on demand".
//
// Two real fixes from live user feedback (2026-09-02): (1) "Not enough
// data" exercises used to sit inline in the main list, often outnumbering
// the exercises with an actual decision — they now collapse into their own
// closed section by default, reachable but never the first thing you see;
// (2) the "immediate actions" strip is capped at the 5 most important
// exercises (Increase/Watch/Plateau first — the ones that need a decision
// — then Keep), not every current-program exercise at once.

const STATUS_TONE: Record<ExerciseDecision['status'], string> = {
  increase:          'bg-green-100 text-green-700',
  keep:              'bg-accent-100 text-accent-700',
  watch:             'bg-amber-100 text-amber-700',
  plateau:           'bg-amber-100 text-amber-700',
  insufficient_data: 'bg-ink-100 text-ink-500',
}

const ACTION_PRIORITY: Record<ExerciseDecision['status'], number> = {
  increase: 0, plateau: 1, watch: 2, keep: 3, insufficient_data: 4,
}
const MAX_IMMEDIATE_ACTIONS = 5

function ConfidencePill({ level, label }: { level: 'low' | 'medium' | 'high'; label: string }) {
  const tone = level === 'high' ? 'bg-green-100 text-green-700' : level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tone}`} title={label}>{confidenceLabel(level).replace(' confidence', '')}</span>
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
        <td className="py-2.5 px-3"><ConfidencePill level={decision.trendConfidence} label="Trend confidence — is this exercise really progressing?" /></td>
        <td className="py-2.5 px-3">{decision.actionConfidence ? <ConfidencePill level={decision.actionConfidence} label="Action confidence — how sure we are about THIS recommendation specifically" /> : <span className="text-ink-300 text-xs">—</span>}</td>
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
        <ConfidencePill level={decision.trendConfidence} label="Trend confidence" />
        {decision.actionConfidence && <ConfidencePill level={decision.actionConfidence} label="Action confidence" />}
        <span className="text-[11px] text-ink-400 ml-auto">{decision.nextCheck}</span>
      </div>
      {open && <DecisionDetail decision={decision} />}
    </li>
  )
}

function ImmediateActions({ decisions, titleById }: { decisions: ExerciseDecision[]; titleById: Map<string, string> }) {
  const needsAttention = decisions
    .filter(d => d.status !== 'insufficient_data' && d.status !== 'keep')
    .sort((a, b) => ACTION_PRIORITY[a.status] - ACTION_PRIORITY[b.status])
  const shown = needsAttention.slice(0, MAX_IMMEDIATE_ACTIONS)
  if (shown.length === 0) return null

  return (
    <div className="mb-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2 flex items-center gap-1.5">
        Immediate actions
        <InfoBubble><b>Immediate actions</b>The exercises most worth your attention right now — ready to progress, or worth watching. Exercises already holding steady aren&apos;t repeated here; see the full table below.</InfoBubble>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {shown.map(d => (
          <div key={d.templateId} className="rounded-xl border border-ink-200 p-3 bg-cream-50">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold text-ink-800 truncate">{titleById.get(d.templateId) ?? 'Unknown'}</span>
              <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_TONE[d.status]}`}>
                {statusVerb(d.status)} {statusLabel(d.status)}
              </span>
            </div>
            <p className="text-xs text-ink-500">{d.nextCheck}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExerciseDecisionTable() {
  const { isLoading, needsCurrentProgram, decisions, titleById } = useProgressData()
  const [showInsufficient, setShowInsufficient] = useState(false)

  if (isLoading || needsCurrentProgram) return null
  if (decisions.length === 0) {
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-ink-500">No current-program exercises logged in this window yet.</p>
      </div>
    )
  }

  const withDecision = decisions.filter(d => d.status !== 'insufficient_data')
  const insufficient = decisions.filter(d => d.status === 'insufficient_data')

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5">
      <ImmediateActions decisions={decisions} titleById={titleById} />

      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-3">Current program · every exercise with a decision</p>
      {withDecision.length === 0 ? (
        <p className="text-sm text-ink-500 mb-2">No current-program exercise has enough sessions for a decision yet.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-ink-400 border-b-2 border-ink-200">
                  <th className="py-2 px-3">Exercise</th>
                  <th className="py-2 px-3">Decision</th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Trend <InfoBubble><b>Trend confidence</b>Is this exercise really progressing? Based only on sample size, time span and consistency — never touched by effort/RPE data.</InfoBubble></span>
                  </th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Action <InfoBubble><b>Action confidence</b>How sure we are about THIS specific recommendation. Capped lower than trend confidence when effort (RPE) wasn&apos;t logged.</InfoBubble></span>
                  </th>
                  <th className="py-2 px-3">Next check</th>
                </tr>
              </thead>
              <tbody>
                {withDecision.map(d => <DecisionRow key={d.templateId} decision={d} title={titleById.get(d.templateId) ?? 'Unknown exercise'} />)}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="sm:hidden flex flex-col gap-2">
            {withDecision.map(d => <DecisionCard key={d.templateId} decision={d} title={titleById.get(d.templateId) ?? 'Unknown exercise'} />)}
          </ul>
        </>
      )}

      {insufficient.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ink-100">
          <button
            type="button"
            onClick={() => setShowInsufficient(v => !v)}
            className="text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            {showInsufficient ? '▲ Hide' : '▼ Show'} {insufficient.length} exercise{insufficient.length === 1 ? '' : 's'} without enough data yet
          </button>
          {showInsufficient && (
            <ul className="mt-2 flex flex-col gap-1">
              {insufficient.map(d => (
                <li key={d.templateId} className="text-xs text-ink-500 flex items-center justify-between py-1.5 border-b border-ink-50 last:border-0">
                  <span>{titleById.get(d.templateId) ?? 'Unknown exercise'}</span>
                  <span className="text-ink-400">{d.comparableSessions} session{d.comparableSessions === 1 ? '' : 's'} · needs {d.nextCheck.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
