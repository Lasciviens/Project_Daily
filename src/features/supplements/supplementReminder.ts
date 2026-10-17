// ─────────────────────────────────────────────────────────────────────────────
//  A supplement reminder's push (migration 160) and the link it opens. The part
//  between the markers is copied verbatim into supabase/functions/push-send
//  (Deno can't import it; scripts/verify-supplement-doses.cjs compares the two)
//  — change it here and paste it there.
//
//  One notification per job run, whatever is due: one dose names itself and
//  opens its dose sheet; several are listed and open the day's doses. The tag
//  makes the newest replace the last, so an hourly reminder never piles up,
//  and `renotify` asks the device to sound and show it again instead of
//  swapping it in silently (public/push-sw.js passes both on; whether iOS
//  honours renotify is unconfirmed — docs/features/supplements.md).
//  iOS shows no buttons on a web push: Take / Skip / Snooze are in the sheet
//  the tap opens (docs/iphone-web-integration.md).
// ─────────────────────────────────────────────────────────────────────────────

// <supplement-reminders>
export interface ReminderDose {
  schedule_id: string
  title:       string
  dose_label:  string
  dose_date:   string
  dose_time:   string
}

/** The address a reminder opens: Food · Today with the dose sheet (one dose, or `due` = the day's open doses). */
export function doseLink(date: string, scheduleId?: string | null, time?: string | null): string {
  const q = new URLSearchParams({ dose: scheduleId || 'due', day: date })
  if (scheduleId && time) q.set('at', time.slice(0, 5))
  return `#/recipes?${q.toString()}`
}

/** The push for the doses due now, or null when none is. */
export function supplementReminder(doses: readonly ReminderDose[]): { title: string; body: string; url: string; tag: string; renotify: true } | null {
  if (doses.length === 0) return null
  const at = (d: ReminderDose) => String(d.dose_time).slice(0, 5)
  const what = (d: ReminderDose) => `${d.title} ${d.dose_label}`
  if (doses.length === 1) {
    const d = doses[0]
    return {
      title: `💊 ${what(d)} not taken yet (${at(d)})`,
      body: 'Tap to take it, skip it or snooze it.',
      url: doseLink(d.dose_date, d.schedule_id, at(d)),
      tag: 'supplement-reminder',
      renotify: true,
    }
  }
  return {
    title: `💊 ${doses.length} supplements not taken yet`,
    body: doses.map(d => `${what(d)} (${at(d)})`).join(' · '),
    url: doseLink(doses[0].dose_date),
    tag: 'supplement-reminder',
    renotify: true,
  }
}
// </supplement-reminders>

export interface DoseLinkTarget {
  date:       string
  /** null: every open dose of the day. */
  scheduleId: string | null
  time:       string | null
}

/** Reads a reminder's address (`?dose=…&day=…&at=…`); null when it is not one. */
export function parseDoseLink(params: URLSearchParams): DoseLinkTarget | null {
  const dose = params.get('dose')
  const day = params.get('day') ?? ''
  if (!dose || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const at = params.get('at')
  return {
    date: day,
    scheduleId: dose === 'due' ? null : dose,
    time: at && /^\d{2}:\d{2}$/.test(at) ? at : null,
  }
}
