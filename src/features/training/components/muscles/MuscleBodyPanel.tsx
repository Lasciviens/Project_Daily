import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { SegmentedControl } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { BANDS_META } from '../../muscleMap'
import { useBandColors } from '../muscleBandColors'
import { FLAG_META } from './muscleVolumeModel'

/** The body diagram, its front/back switch and the colour legend. */
export function MuscleBodyPanel({ side, onSideChange, bodyData, selectedCount, onClear, onToggle, isLoading, hasFlags }: {
  side: 'front' | 'back'
  onSideChange: (s: 'front' | 'back') => void
  bodyData: ExtendedBodyPart[]
  selectedCount: number
  onClear: () => void
  onToggle: (slug: Slug | null | undefined) => void
  isLoading: boolean
  hasFlags: boolean
}) {
  const bandColors = useBandColors()
  return (
    <div className="w-full @3xl:w-[360px] @5xl:w-[420px] shrink-0 flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <SegmentedControl<'front' | 'back'>
          value={side}
          onChange={onSideChange}
          options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]}
        />
        {selectedCount > 0 && (
          <button type="button" onClick={onClear} className="btn-ghost btn-sm text-meta">
            Clear ({selectedCount})
          </button>
        )}
      </div>

      {/* An always-dark stage in both themes, so the band colours read the same. */}
      <div className="relative flex w-full justify-center rounded-card bg-scrim p-3 sm:p-5">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-scrim/60">
            <span className="flex items-center gap-2 text-meta text-white/80">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
              Loading your volume…
            </span>
          </div>
        )}
        {/* The body SVG is ~1:2.5, so a full-width 340px box renders ~850px
            tall — taller than a phone viewport. Capped narrower below sm. */}
        <div className="w-full max-w-[220px] sm:max-w-[340px] [&>svg]:w-full [&>svg]:h-auto">
          <Body data={bodyData} side={side} gender="male" scale={1} defaultFill={bandColors.untrained} border="rgb(255 255 255 / 0.12)" onBodyPartPress={(part) => onToggle(part.slug)} />
        </div>
      </div>

      <div className="card w-full max-w-[340px] p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-meta font-semibold text-fg-2">Are you training each muscle the right amount?</span>
          <InfoBubble>
            <p className="mb-1 font-semibold text-fg">How the colours work</p>
            <p className="mb-1.5">Colour = how many <strong>hard working sets per week</strong> each muscle got, vs typical volume landmarks. <strong>Green means the growth sweet spot — that's the goal, not "the most".</strong> Blue/teal = too little to grow it; amber/red = more than the body usually turns into muscle, so extra mostly adds fatigue.</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Primary muscle of an exercise = 1 set; a secondary (helper) = half a set (a convention, not a measured value).</li>
              <li>Warm-up sets don't count.</li>
              <li>Shows <strong>volume</strong>, not effort/recovery — assumes your sets were reasonably hard.</li>
              <li>Landmarks are population averages (±); guidance, not personalised.</li>
              {hasFlags && <li>A violet muscle is <strong>flagged</strong> by an active avoid/limit limitation — not "good" or "bad". Open that muscle's card for which limitation and why. (Monitor-only limitations don't flag anything.)</li>}
            </ul>
          </InfoBubble>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {BANDS_META.map(b => (
            <div key={b.idx} className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: bandColors.bands[b.idx] }} />
              <span className="text-micro font-normal text-fg-muted">{b.label}</span>
            </div>
          ))}
          {hasFlags && (['avoid', 'limit'] as const).map(w => (
            <div key={w} className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: bandColors.flag[w] }} />
              <span className="text-micro font-normal text-fg-muted">{FLAG_META[w].label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-center text-meta text-fg-muted">
        {selectedCount > 0 ? 'Tap muscles to add/remove · Clear to reset' : 'Tap a muscle to inspect (multi-select)'}
      </p>
    </div>
  )
}
