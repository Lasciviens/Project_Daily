import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { logError } from '../utils/logError'
import { Button } from '../ui/Button'

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
      <div role="alert" data-tone="danger" className="max-w-xl rounded-card border border-danger/30 bg-danger-soft p-4">
        <p className="flex items-center gap-2 text-ui font-semibold text-danger">
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
          {this.props.label ? `${this.props.label} — something broke here` : 'Something broke here'}
        </p>
        <p className="mt-1 break-words text-meta text-fg-2">{error.message}</p>
        <Button size="sm" icon={<RotateCcw />} onClick={() => this.setState({ error: null })} className="mt-3">
          Try again
        </Button>
      </div>
    )
  }
}
