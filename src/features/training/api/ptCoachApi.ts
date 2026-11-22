import { supabase } from '../../../integrations/supabase/client'
import { currentUserId } from '../../../shared/utils/requireUser'
import { runClaudeJob } from '../../ai/claude/claudeApi'
import { todayStr } from '../../../shared/utils/dateUtils'
import { gatherCoachData } from '../coach/coachData'
import { fitLines, fitRequestBytes, formatPtSnapshot } from '../coach/coachFormat'
import { feelingOf, formatPtVerdicts, ptVerdicts, type PtFeeling } from '../coach/coachFacts'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT coach — daily assessment. AI last: all data is gathered and pre-aggregated here into ONE compact text
//  snapshot, and the decisions the assessment rules make from it (rest day, deload cue, the one lift to focus on)
//  are worked out by code too (coach/coachFacts.ts). One call to the `coach_assessment` job of the `claude`
//  function then explains them: no tool loop, no database access for the model. The snapshot comes from the
//  shared coach context (coach/coachData.ts + coach/coachFormat.ts), the same data Ask-AI Coach mode reads.
// ─────────────────────────────────────────────────────────────────────────────

/** What the function takes at most (job-coach.ts COACH_LIMITS): longer text is cut at a whole line, never mid-line. */
const SNAPSHOT_MAX = 8000
const PREVIOUS_MAX = 2000
const NOTE_MAX = 300
/** The function's request limit is 16 KB (`requestMaxBytes`); the wrapper (action, job name) takes a hundred bytes more. */
const REQUEST_BYTES_MAX = 15 * 1024

export async function buildTrainingSnapshot(): Promise<string> {
  return fitLines(formatPtSnapshot(await gatherCoachData()), SNAPSHOT_MAX)
}

export interface PTAssessmentInput {
  feeling:  PtFeeling     // "undertrained" | "normal" | "tired" | "very tired"
  note?:    string        // free text
}

export interface PTAssessmentRow {
  id:         string
  date:       string
  feeling:    string
  note:       string | null
  assessment: string
  model:      string | null
  created_at: string
}

// Assessment history — the coach's own log. Newest first.
export async function fetchAssessments(limit = 14): Promise<PTAssessmentRow[]> {
  const { data, error } = await supabase
    .from('pt_assessments')
    .select('id, date, feeling, note, assessment, model, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/** `saveProblem` is why the log row was not written (the assessment itself is still shown), or null when it was saved. */
export interface PTAssessmentResult { text: string; model: string | null; saveProblem: string | null }

export async function generatePTAssessment(input: PTAssessmentInput): Promise<PTAssessmentResult> {
  const data = await gatherCoachData()
  const snapshot = fitLines(formatPtSnapshot(data), SNAPSHOT_MAX)
  const verdicts = formatPtVerdicts(ptVerdicts(data, input.feeling))

  // The coach's continuity: hand it its own last assessment so it can follow
  // up on whether the advice was applied (the job's previous-assessment sentence).
  let previous: string | undefined
  try {
    const [prev] = await fetchAssessments(1)
    if (prev) previous = `(${prev.date}, owner felt: ${feelingOf(prev.feeling) ?? prev.feeling})\n${prev.assessment}`.slice(0, PREVIOUS_MAX)
  } catch { /* history is optional (table may not exist pre-migration) */ }

  // The function takes 16 KB for a whole request, counted in bytes: a snapshot of 8000 characters with accents is
  // more than that, so the text is cut by bytes here (the snapshot's last lines first, then the previous assessment).
  const sent = fitRequestBytes({
    feeling: input.feeling,
    ...(input.note ? { note: input.note.slice(0, NOTE_MAX) } : {}),
    snapshot, verdicts, ...(previous ? { previous } : {}),
  }, REQUEST_BYTES_MAX)
  const { result, call } = await runClaudeJob<{ text?: unknown }>('coach_assessment', sent)
  const text = typeof result?.text === 'string' ? result.text.trim() : ''
  if (!text) throw new Error("The coach didn't send an assessment — try again")
  // The model that really answered, as the function says it (not the one asked for).
  const model = call?.served_model ?? call?.model ?? null

  // Persist the log. A failed save never eats the reply, but it is reported, never silent.
  let saveProblem: string | null = null
  try {
    const userId = await currentUserId()
    if (!userId) throw new Error('not signed in')
    const { error } = await supabase.from('pt_assessments').insert({
      user_id:    userId,
      date:       todayStr(),
      feeling:    input.feeling,
      note:       input.note ?? null,
      snapshot:   `${verdicts}\n\n${snapshot}`,
      assessment: text,
      model,
    })
    if (error) throw error
  } catch (e) {
    saveProblem = e instanceof Error && e.message ? e.message : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : 'unknown error'
  }

  return { text, model, saveProblem }
}
