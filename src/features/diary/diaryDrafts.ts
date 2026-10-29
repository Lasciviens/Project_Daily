// Words typed in the Diary and not saved yet, one per day, on this device: they
// survive a mode switch, iOS reloading the app and the midnight move to the
// next day. Cleared when that day's save of the same words succeeds. Like the
// app's other drafts they outlive a sign-out (src/security/accountState.ts: an
// expired session lands there too, and nothing typed is ever lost).

export const DIARY_DRAFT_PREFIX = 'lasci.diaryDraft.'

export function readDiaryDraft(day: string): string | null {
  try { return localStorage.getItem(DIARY_DRAFT_PREFIX + day) } catch { return null }
}

export function writeDiaryDraft(day: string, text: string): void {
  try { localStorage.setItem(DIARY_DRAFT_PREFIX + day, text) } catch { /* the box still holds it */ }
}

/** Only when the words saved are still the words waiting: text typed during the save stays. */
export function clearDiaryDraftIf(day: string, saved: string): void {
  try { if (localStorage.getItem(DIARY_DRAFT_PREFIX + day) === saved) localStorage.removeItem(DIARY_DRAFT_PREFIX + day) } catch { /* */ }
}
