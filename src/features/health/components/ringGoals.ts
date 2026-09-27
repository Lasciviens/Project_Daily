// Activity ring goals. Health Auto Export doesn't send Apple's activity
// summary, so the user's real Move/Exercise/Stand goals aren't in the data;
// these placeholders are labelled as such wherever they're used.
export interface RingGoals { move: number; exercise: number; stand: number }
export const DEFAULT_RING_GOALS: RingGoals = { move: 500, exercise: 30, stand: 12 }
