import { Outlet, NavLink } from 'react-router-dom'
import { signOut } from '../security/supabaseClient'
import { ToDoDrawer } from '../features/todo/components/ToDoDrawer'
import { useUIStore } from './store'

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-cream-100">
      <Nav />
      <main className="flex-1">
        <Outlet />
      </main>
      <ToDoDrawer />
    </div>
  )
}

function Nav() {
  const { isToDoOpen, toggleToDo } = useUIStore()

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 ${
      isActive
        ? 'bg-amber-500 text-white'
        : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-ink-200">
      <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center text-white text-sm font-bold">
            L
          </div>
          <span className="font-semibold text-ink-900 text-sm">Lasci's Board</span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          <NavLink to="/daily" className={linkClass}>Daily</NavLink>
          <NavLink to="/media" className={linkClass}>Media</NavLink>
          <NavLink to="/work"  className={linkClass}>Work</NavLink>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          <button
            disabled
            title="Coming in Phase 5"
            className="px-3 py-1.5 text-xs font-medium text-ink-300 rounded-lg cursor-not-allowed"
          >
            ✦ Ask AI
          </button>
          <button
            onClick={toggleToDo}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
              isToDoOpen
                ? 'bg-amber-50 text-amber-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            ☑ To-Do
          </button>
          <button
            onClick={() => signOut()}
            className="px-3 py-1.5 text-xs font-medium text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors duration-150"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
