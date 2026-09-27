import { InfoBubble } from '../../../shared/components/InfoBubble'
import { SourceNote } from './program/SourceNote'

/** The one RPE explainer — shown once per screen, next to the first place a
 *  rated set appears (workout detail, Next tab). */
export function RpeInfoBubble() {
  return (
    <InfoBubble label="About RPE">
      <b>RPE — how hard a set felt.</b> You log it per set in Hevy on a 6–10 scale: 10 = no rep left, 9 = one left,
      8 = two left (reps in reserve ≈ 10 − RPE, Hevy&apos;s own mapping). It&apos;s self-reported, and people tend to
      underestimate the reps they have left by about one. For muscle growth, most working sets should end roughly 0–3 reps
      short of failure (RPE 7–10) — closer tends to help a little, but going all the way to failure adds little.
      <span className="mt-1.5 block">
        Shown for context only — the targets never change because of RPE.
      </span>
      <span className="mt-1.5 block"><SourceNote ids={['halperin2022', 'refalo2023', 'robinson2024']} /></span>
    </InfoBubble>
  )
}
