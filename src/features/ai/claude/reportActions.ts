import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { ClaudeJobError } from './claudeApi'
import { reportCheckMessage, reportMakeMessage } from './reportRules'

// The weekly report's two actions of the `claude` function (Developer → AI → Learn → Batches). The reads are in
// reportApi.ts.

async function ask(action: 'report_make' | 'report_check'): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action } })
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status
    if (status === 401 || status === 403) throw new ClaudeJobError('error', 'Session error — refresh the page and sign in again.')
    const body = await parseFunctionErrorBody(error)
    throw new ClaudeJobError('error', (typeof body?.message === 'string' && body.message.trim().slice(0, 300)) || 'The AI function didn’t answer — try again in a moment.')
  }
  return data
}

/** "Make this week's report now": queues the batch. Throws the function's own sentence when nothing was queued. */
export async function makeReportNow(): Promise<string> {
  const said = reportMakeMessage(await ask('report_make'))
  if (!said.ok) throw new Error(said.message)
  return said.message
}

/** "Check now": reads back a queued report whose batch has ended. Throws the function's own sentence when it could not run. */
export async function checkReportsNow(): Promise<string> {
  const answer = await ask('report_check')
  const said = reportCheckMessage(answer)
  if (!said.ok) throw new Error(said.message)
  return said.message
}
