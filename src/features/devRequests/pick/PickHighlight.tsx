import type { Ref } from 'react'

/**
 * The box drawn around what the pointer is over while picking, with its
 * label. Positioned by usePickMode through style writes (no re-render per
 * pointer move); never a pointer target itself.
 */
export function PickHighlight({ boxRef, labelRef }: { boxRef: Ref<HTMLDivElement>; labelRef: Ref<HTMLSpanElement> }) {
  return (
    <div
      ref={boxRef}
      data-dev-request-ui=""
      aria-hidden
      style={{ display: 'none' }}
      className="pointer-events-none fixed z-float rounded-control border-2 border-accent-500 bg-accent-500/10"
    >
      <span
        ref={labelRef}
        className="absolute left-0 top-0 max-w-[20rem] -translate-y-[calc(100%+4px)] truncate rounded-control bg-accent-600 px-2 py-0.5 text-meta font-semibold text-on-accent shadow-float data-[below=true]:top-full data-[below=true]:translate-y-1"
      />
    </div>
  )
}
