import { useState } from 'react'
import { ChevronDown, Play, RefreshCw, Settings2 } from 'lucide-react'
import type { PTAssessmentRow } from '../api/ptCoachApi'
import { usePtAssessments, useGeneratePtAssessment } from '../hooks/usePtCoach'
import { Button, Card, IconButton, SectionLabel } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useAthleteProfile, useAthleteLimitations } from '../hooks/useAthleteProfile'
import { AthleteProfileSheet } from './AthleteProfileSheet'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT — user-initiated daily assessment (NEVER auto-runs; each run costs
//  one AI request). Assessments are LOGGED to pt_assessments (migration 051)
//  so the coach can follow up on its own advice next time, and the history
//  is browsable below. DB is the source of truth (localStorage cache retired).
// ─────────────────────────────────────────────────────────────────────────────

// The `id` values stay Turkish deliberately: they are sent verbatim into the
// Turkish PT prompt and stored in pt_assessments.feeling, so changing them
// would break both the prompt contract and every archived assessment.
const FEELINGS = [
  { id: 'az çalıştım',  label: '😴 Undertrained' },
  { id: 'normal',       label: '🙂 Normal' },
  { id: 'yorgunum',     label: '😮‍💨 Tired' },
  { id: 'çok yorgunum', label: '🥵 Very tired' },
]
const FEELING_LABEL: Record<string, string> =
  Object.fromEntries(FEELINGS.map(f => [f.id, f.label.replace(/^\S+\s/, '')]))

// Minimal markdown: only **bold** (matches AIPanel's renderer).
function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-fg">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function PTCoachTab() {
  const today = todayStr()
  const [feeling, setFeeling] = useState('normal')
  const [note, setNote] = useState('')
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null)
  // Fallback display if the DB log isn't available yet (migration 051 not
  // applied): the generated text still shows, it just isn't persisted.
  const [localResult, setLocalResult] = useState<{ text: string; model: string | null } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const { data: athleteProfile } = useAthleteProfile()
  const { data: activeLimitations = [] } = useAthleteLimitations(true)
  const { data: history = [] } = usePtAssessments()
  const generate = useGeneratePtAssessment()

  // Latest of today = the "current" assessment; everything else is history.
  const dbCurrent: PTAssessmentRow | undefined = history.find(a => a.date === today)
  const current = dbCurrent ?? (localResult ? {
    id: 'local', date: today, feeling, note: note || null,
    assessment: localResult.text, model: localResult.model, created_at: '',
  } satisfies PTAssessmentRow : undefined)
  const past = history.filter(a => a.id !== current?.id)

  // Compact profile readout for the coach snapshot (see AthleteProfileSheet
  // for the actual form) — an unset profile invites setup instead of a blank.
  const profileParts = [athleteProfile?.goal?.replace('_', ' '), athleteProfile?.experience_level, athleteProfile?.equipment_access]
    .filter((p): p is string => !!p)
  const profileSummary = profileParts.length > 0
    ? `${profileParts.join(' · ')}${activeLimitations.length > 0 ? ` · ${activeLimitations.length} limitation${activeLimitations.length === 1 ? '' : 's'}` : ''}`
    : 'Set up your training profile'

  function run() {
    generate.mutate({ feeling, note: note.trim() || undefined }, { onSuccess: setLocalResult })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="card flex items-center justify-between gap-2 py-1 pl-4 pr-1">
        <span className="truncate text-meta capitalize text-fg-muted">{profileSummary}</span>
        <IconButton label="Training profile settings" onClick={() => setProfileOpen(true)} className="shrink-0">
          <Settings2 />
        </IconButton>
      </div>

      <AthleteProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />

      <Card className="flex flex-col gap-4">
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

        <Button
          variant="primary"
          className="self-start"
          loading={generate.isPending}
          icon={current ? <RefreshCw /> : <Play />}
          onClick={run}
        >
          {generate.isPending ? 'Assessing…' : current ? 'Re-assess' : 'Assess'}
        </Button>

        {current && (
          <div className="border-t border-line pt-3">
            <div className="whitespace-pre-wrap text-body leading-relaxed text-fg-2">
              {renderBold(current.assessment)}
            </div>
            {/* Which model ACTUALLY answered — the fallback chain may have
                landed somewhere other than the default. */}
            <p className="mt-2 text-micro font-normal normal-case text-fg-faint">
              {current.model ? current.model.replace('gemini-', '') : ''} · feeling: {FEELING_LABEL[current.feeling] ?? current.feeling}
              {current.note ? ` · "${current.note}"` : ''}
            </p>
          </div>
        )}
      </Card>

      {past.length > 0 && (
        <Card>
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
                    <span className="flex-1 truncate text-meta text-fg-muted">{FEELING_LABEL[a.feeling] ?? a.feeling}{a.note ? ` · ${a.note}` : ''}</span>
                    <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="whitespace-pre-wrap border-t border-line px-3 pb-3 pt-2 text-meta leading-relaxed text-fg-2">
                      {renderBold(a.assessment)}
                      {a.model && <p className="mt-1.5 text-micro font-normal text-fg-faint">{a.model.replace('gemini-', '')}</p>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
