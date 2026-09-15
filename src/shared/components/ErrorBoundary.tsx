import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError } from '../utils/logError'

// A render-time throw anywhere below this boundary used to take the WHOLE app
// to a blank white page — React unmounts the entire tree when nothing catches.
// That is exactly what a reverse-engineered payload can cause: one field whose
// real shape differs from the declared type (an array where a string was
// expected, a missing nested object) turns into a TypeError DURING render,
// which no try/catch around a fetch can ever see.
//
// Deliberately NOT a global app-level wrapper only: wrap the surfaces whose
// data shape is not contractually guaranteed (the PSN/Steam tabs above all),
// so a failure there stays inside its own card instead of blanking the page.

interface Props {
  children: ReactNode
  /** Shown above the error text, e.g. "PlayStation". */
  label?: string
  /** `logError` context so a real user's crash reaches app_error_logs. */
  action?: string
}

interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(`${this.props.action ?? 'render_error'}: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 dark:bg-red-500/10 dark:border-red-500/30">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">
          {this.props.label ? `${this.props.label} — something broke here` : 'Something broke here'}
        </p>
        <p className="text-xs text-red-600/90 dark:text-red-400/80 mt-1 break-words">{error.message}</p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-3 min-h-[44px] px-3 text-sm rounded-lg border border-red-300 bg-cream-50 text-red-700 hover:border-red-400 transition-colors dark:bg-transparent dark:text-red-400"
        >
          Try again
        </button>
      </div>
    )
  }
}
