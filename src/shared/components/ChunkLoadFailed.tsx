/** Shown when a lazy chunk still can't load after the one reload lazyWithReload allows. */
export function ChunkLoadFailed() {
  return (
    <div role="alert" className="grid min-h-[100dvh] place-items-center bg-canvas p-6 text-center">
      <div className="max-w-sm">
        <p className="text-base font-semibold text-ink-900">This page couldn't be loaded</p>
        <p className="mt-1.5 text-sm text-ink-600">Check your connection, then reload to get the latest version of the app.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary mt-4 min-h-[44px] px-5"
        >
          Reload
        </button>
      </div>
    </div>
  )
}
