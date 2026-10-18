import { useMotion } from '../../../shared/hooks/useMotion'

/**
 * On a phone the project is one long column: a strip of chips jumps to the
 * plan and to each block. Buttons, not "#id" links — the address's hash is
 * the app's route (HashRouter).
 */
export function SectionChips({ sections }: { sections: Array<{ id: string; label: string }> }) {
  const motion = useMotion()
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'start' })
  return (
    <nav aria-label="Project sections" className="scroll-x -mx-4 flex gap-1.5 px-4">
      {sections.map(s => (
        <button key={s.id} type="button" onClick={() => go(s.id)} className="chip shrink-0">{s.label}</button>
      ))}
    </nav>
  )
}
