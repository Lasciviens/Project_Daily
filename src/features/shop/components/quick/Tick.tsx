/** The 44px tick that leads every quick-list row — the Shop's and Daily's Shopping card alike. */
export function Tick({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={hint}
      className="group grid h-11 w-11 shrink-0 place-items-center rounded-control">
      <span className="h-5 w-5 rounded-[6px] border-2 border-line-strong transition-colors group-hover:border-success" />
    </button>
  )
}
