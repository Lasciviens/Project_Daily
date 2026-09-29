// Which Apple Health workouts Health shows. Strength sessions ("Traditional
// Strength Training", "Functional Strength Training" — Apple's own names, as
// Health Auto Export sends them) belong to Training, where the Hevy session
// logged with them lives; Health lists only the rest (walks, rides, runs…)
// under Activity. Their popup (`health-workout`) still opens from Training.
// Import-free so a verify script can require it.

export function isStrengthWorkout(name: string | null | undefined): boolean {
  return /strength/i.test(name ?? '')
}
