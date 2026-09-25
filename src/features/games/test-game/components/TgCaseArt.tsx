import { platformInfo, type TgGame } from '../testGameModel'

// A drawn game case for a game with no usable box art. It keeps a real case's
// anatomy — the brand band across the top (the "PlayStation 2" strip on a PS2
// case), a dark body, the title on the front, a little gloss — so a missing
// cover reads as a plain case on the shelf, never as a broken image.
//
// The colours are the object's own, not the page's: a game case is dark in
// daylight too, so the body does not follow the theme. Text sizes are in
// container units, so the same case reads at 40px in a list and 150px on a shelf.

export function TgCaseArt({ game, className = '' }: { game: TgGame; className?: string }) {
  const info = platformInfo(game.platformKey)
  return (
    <div
      aria-hidden
      className={`relative aspect-[0.7] h-full max-w-full select-none overflow-hidden rounded-[4px] ${className}`}
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${info.brand} 32%, #141821) 0%, #0c0e13 58%, #07080b 100%)`,
      }}
    >
      <div className="@container absolute inset-0 flex flex-col">
        <div className="flex h-[13%] shrink-0 items-center px-[8%]" style={{ background: info.brand }}>
          <span className="truncate text-[length:max(5px,7cqw)] font-bold uppercase leading-none tracking-[0.12em] text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]">
            {info.name}
          </span>
        </div>
        <div className="h-px shrink-0 bg-white/15" />
        <div className="flex min-h-0 flex-1 items-center justify-center px-[10%] pb-[10%]">
          <span className="line-clamp-3 break-words text-center text-[length:max(6px,11cqw)] font-semibold leading-[1.15] text-white/90 [text-wrap:balance]">
            {game.title}
          </span>
        </div>
      </div>
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0.05)_30%,transparent_48%)]" />
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[4%] bg-[linear-gradient(90deg,rgba(255,255,255,0.16),transparent)]" />
    </div>
  )
}
