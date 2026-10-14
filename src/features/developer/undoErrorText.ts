// Why "Undo this save" (or its trial run) can't run, in plain words, by
// Postgres code — shared by the preview (undoPlanText) and the apply's error
// (undoSaveApi), so both say the same. Pure: verify-undo-plan-text loads it.
export const UNDO_ERROR_TEXT: Record<string, string> = {
  '23503': 'a row it needs was deleted since',
  '23505': 'another row has taken its place since',
  '23514': 'an old value breaks a rule of the table now',
  '23502': 'a value the table now needs is missing',
  '42501': 'some of these rows may not be changed',
  // lock_timeout (151): another save holds a row the undo writes
  '55P03': 'another save is writing these rows — try again in a moment',
  // statement_timeout only: the request ran longer than it may
  '57014': 'this save is too big to undo here',
  UD004: 'a row can\'t be written back (gone, or not yours)',
}
