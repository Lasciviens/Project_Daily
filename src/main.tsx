import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import './index.css'
import { Providers } from './app/providers'
import { installIosViewportFix } from './app/iosViewportFix'
import { installServiceWorker } from './app/serviceWorkerUpdate'
import { captureTraktCallback } from './features/media/trakt/traktCallback'

// A new version installs in the background and takes over at a quiet moment
// (the app in the background or left alone), never in the middle of work.
installServiceWorker()
installIosViewportFix()
// Before the router reads the address: Trakt returns to the root with ?code=.
captureTraktCallback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
)

