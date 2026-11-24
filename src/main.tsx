import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import './index.css'
import { Providers } from './app/providers'
import { installIosViewportFix } from './app/iosViewportFix'
import { installServiceWorker } from './app/serviceWorkerUpdate'
import { captureTraktCallback } from './features/media/trakt/traktCallback'
import { preloadOpenedPage } from './app/pages'
import { storedSessionUserId } from './security/storedSession'
import { keptAnswersRenderError } from './shared/query/persist'

// A new version installs in the background and takes over at a quiet moment
// (the app in the background or left alone), never in the middle of work.
installServiceWorker()
installIosViewportFix()
// Before the router reads the address: Trakt returns to the root with ?code=.
captureTraktCallback()
// The opened page's code loads beside the shell's, not after the shell has drawn (signed in only).
if (storedSessionUserId()) preloadOpenedPage(window.location.hash)

// A short button's description on a long press (touch has no hover): one listener, loaded in idle time — the first
// download carries none of it.
const tips = () => { void import('./app/longPressTips').then(m => m.installLongPressTips()) }
if ('requestIdleCallback' in window) window.requestIdleCallback(tips); else setTimeout(tips, 1500)

// A render error while answers kept from an earlier start are on screen may be an answer an update reshaped:
// they are dropped and read fresh (shared/query/persist.ts). The error itself is reported as before.
createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => { keptAnswersRenderError('uncaught'); reportError(error) },
  onCaughtError: (error) => { keptAnswersRenderError('caught'); console.error(error) },
}).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
)

