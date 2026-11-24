import { useState } from 'react'
import { ChevronDown, MessageCircle, Play, RefreshCw } from 'lucide-react'
import type { PTAssessmentRow } from '../api/ptCoachApi'
import { usePtAssessments, useGeneratePtAssessment } from '../hooks/usePtCoach'
import { Button, Card, PageBoard, SectionLabel, Truncate } from '../../../shared/ui'
import { useUIStore } from '../../../app/store'
import { COACH_BOARD } from '../trainingBoards'
import { todayStr } from '../../../shared/utils/dateUtils'
import { ProfileSummaryCard } from './program/ProfileSummaryCard'
import { formatDate } from '../../../shared/utils/dateFormat'
import { feelingOf, PT_FEELINGS, type PtFeeling } from '../coach/coachFacts'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT — user-initiated daily assessment (NEVER auto-runs; each run costs
//  one AI request, a `coach_assessment` job of the `claude` function). Assessments are LOGGED to pt_assessments (migration 051)
//  so the coach can follow up on its own advice next time, and the history
//  is browsable below. DB is the source of truth (localStorage cache retired).
// ─────────────────────────────────────────────────────────────────────────────

// The `id` values are the English feeling words: they are sent verbatim into the
// `coach_assessment` job's allow-list and stored in pt_assessments.feeling, so changing them
// would break the job's allow-list. Rows saved before 22.11.2026 hold the Turkish words: `feelingLabel` reads both.
const FEELINGS: { id: PtFeeling; label: string }[] = [
  { id: PT_FEELINGS[0], label: '😴 Undertrained' },
  { id: PT_FEELINGS[1], label: '🙂 Normal' },
  { id: PT_FEELINGS[2], label: '😮‍💨 Tired' },
  { id: PT_FEELINGS[3], label: '🥵 Very tired' },
]
const FEELING_LABEL: Record<string, string> =
  Object.fromEntries(FEELINGS.map(f => [f.id, f.label.replace(/^\S+\s/, '')]))

/** A stored feeling as its label, whether it was saved in English or (before 22.11.2026) in Turkish. */
const feelingLabel = (stored: string): string => FEELING_LABEL[feelingOf(stored) ?? stored] ?? stored

// Minimal markdown: only **bold** (the same as Ask AI's).
function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-fg">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

const fmtDate = (d: string) => formatDate(d)

/** The saved model as a short name: "claude-haiku-5-5" → "Haiku 5.5"; an older row's name (Gemini) is shown as it was saved. */
function modelLabel(model: string | null): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model ?? '')
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : (model ?? '').replace('gemini-', 'Gemini ')
}

export function PTCoachTab() {
  const today = todayStr()
  const [feeling, setFeeling] = useState<PtFeeling>('normal')
  const [note, setNote] = useState('')
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null)
  // Fallback display if the DB log isn't available yet (migration 051 not
  // applied): the generated text still shows, it just isn't persisted.
  const [localResult, setLocalResult] = useState<{ text: string; model: string | null } | null>(null)
  const { data: history = [] } = usePtAssessments()
  const generate = useGeneratePtAssessment()
  const openCoachChat = useUIStore(s => s.openCoachChat)
  // The coach chat reads the verdicts saved at the last assessment, so the date they come from is shown by its button.
  const lastAssessed = history[0]?.date ?? null

  // Latest of today = the "current" assessment; everything else is history.
  const dbCurrent: PTAssessmentRow | undefined = history.find(a => a.date === today)
  const current = dbCurrent ?? (localResult ? {
    id: 'local', date: today, feeling, note: note || null,
    assessment: localResult.text, model: localResult.model, created_at: '',
  } satisfies PTAssessmentRow : undefined)
  const past = history.filter(a => a.id !== current?.id)

  function run() {
    generate.mutate({ feeling, note: note.trim() || undefined }, { onSuccess: setLocalResult })
  }

  return (
    // The coach beside the profile it reads and its history (trainingBoards.ts
    // → COACH_BOARD); stacked on a phone.
    <PageBoard layout={COACH_BOARD} stackGap="gap-4" sections={{
      coach: (
        <Card className="flex max-w-2xl flex-col gap-4">
          <div>
            <h3 className="text-lead font-semibold text-fg">AI coach — daily assessment</h3>
            <p className="mt-0.5 text-meta text-fg-muted">
              Reads your last workout, its sets and loads, your weekly muscle volume, sleep and activity,
              and follows up on its own previous advice. It only runs when you start it; every assessment is saved.
            </p>
          </div>

          <div>
            <p className="field-label">How do you feel today?</p>
            <div className="flex flex-wrap gap-1.5">
              {FEELINGS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={feeling === f.id}
                  onClick={() => setFeeling(f.id)}
                  className="pill-tab border border-line aria-pressed:border-transparent"
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional: pain, motivation, a goal…"
              className="input mt-2 w-full max-w-md"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={generate.isPending}
              icon={current ? <RefreshCw /> : <Play />}
              onClick={run}
            >
              {generate.isPending ? 'Assessing…' : current ? 'Re-assess' : 'Assess'}
            </Button>
            {/* Ask AI in coach mode: the same chat, with the coach's own instructions and tools (it changes nothing). */}
            <Button variant="secondary" icon={<MessageCircle />} onClick={openCoachChat} tip="Chat with the coach">Chat</Button>
            {lastAssessed && <span className="text-meta text-fg-muted">Last assessed {formatDate(lastAssessed)}</span>}
          </div>

          {current && (
            <div className="border-t border-line pt-3">
              <div className="whitespace-pre-wrap text-body leading-relaxed text-fg-2">
                {renderBold(current.assessment)}
              </div>
              {/* Which model ACTUALLY answered (the function's served model, saved with the row). */}
              <p className="mt-2 text-micro font-normal normal-case text-fg-faint">
                {modelLabel(current.model)} · feeling: {feelingLabel(current.feeling)}
                {current.note ? ` · "${current.note}"` : ''}
              </p>
            </div>
          )}
        </Card>
      ),

      history: past.length > 0 && (
          <Card className="max-w-3xl">
            <SectionLabel className="mb-2">Past assessments</SectionLabel>
            <ul className="flex flex-col gap-1">
              {past.map(a => {
                const open = openHistoryId === a.id
                return (
                  <li key={a.id} className="rounded-row border border-line">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenHistoryId(open ? null : a.id)}
                      className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left"
                    >
                      <span className="shrink-0 text-meta font-semibold tabular-nums text-fg">{fmtDate(a.date)}</span>
                      <Truncate className="flex-1 text-meta text-fg-muted">{`${feelingLabel(a.feeling)}${a.note ? ` · ${a.note}` : ''}`}</Truncate>
                      <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="whitespace-pre-wrap border-t border-line px-3 pb-3 pt-2 text-meta leading-relaxed text-fg-2">
                        {renderBold(a.assessment)}
                        {a.model && <p className="mt-1.5 text-micro font-normal text-fg-faint">{modelLabel(a.model)}</p>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
      ),
      profile: <ProfileSummaryCard />,
    }} />
  )
}
