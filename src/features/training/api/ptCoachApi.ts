import { supabase } from '../../../integrations/supabase/client'
import { invokeAI, type Message } from '../../ai/api/aiApi'
import { todayStr } from '../../../shared/utils/dateUtils'
import { gatherCoachData } from '../coach/coachData'
import { formatPtSnapshot, PT_SYSTEM_PROMPT } from '../coach/coachFormat'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT coach — daily assessment. Token-minimal BY CONSTRUCTION: all data is
//  gathered and pre-aggregated client-side into ONE compact text snapshot,
//  then a single one-shot Gemini call — no tool loop. The snapshot comes from
//  the shared coach context (coach/coachData.ts + coach/coachFormat.ts), the
//  same data Ask-AI Coach mode reads: the current program, the progress
//  engine's per-exercise decisions (identical to the Progress tab) and the
//  athlete's limitations. The snapshot line formats and PT_SYSTEM_PROMPT live
//  side by side in coachFormat.ts — they are one contract.
// ─────────────────────────────────────────────────────────────────────────────

export async function buildTrainingSnapshot(): Promise<string> {
  return formatPtSnapshot(await gatherCoachData())
}

export interface PTAssessmentInput {
  feeling:  string        // "az çalıştım" | "normal" | "yorgunum" | "çok yorgunum"
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

export interface PTAssessmentResult { text: string; model: string | null }

export async function generatePTAssessment(input: PTAssessmentInput): Promise<PTAssessmentResult> {
  const snapshot = await buildTrainingSnapshot()

  // The coach's continuity: hand it its own last assessment so it can follow
  // up on whether the advice was applied (prompt's FOLLOW-UP rule).
  let prevSection = ''
  try {
    const [prev] = await fetchAssessments(1)
    if (prev) prevSection = `\n\nPREVIOUS ASSESSMENT (${prev.date}, his: ${prev.feeling}):\n${prev.assessment}`
  } catch { /* history is optional (table may not exist pre-migration) */ }

  const messages: Message[] = [{
    role: 'user',
    content: `Bugünkü değerlendirmeni yap. Nasıl hissediyorum: ${input.feeling}${input.note ? ` — "${input.note}"` : ''}`,
  }]
  const res = await invokeAI(messages, `${PT_SYSTEM_PROMPT}\n\n---\nVERİ ÖZETİ (${todayStr()}):\n${snapshot}${prevSection}`)

  // Persist the log — best-effort (an insert failure must not eat the reply).
  try {
    const user = (await supabase.auth.getUser()).data.user
    if (user) {
      await supabase.from('pt_assessments').insert({
        user_id:    user.id,
        date:       todayStr(),
        feeling:    input.feeling,
        note:       input.note ?? null,
        snapshot,
        assessment: res.text,
        model:      res.model ?? null,
      })
    }
  } catch { /* logged assessment is a bonus, not a gate */ }

  return { text: res.text, model: res.model ?? null }
}
