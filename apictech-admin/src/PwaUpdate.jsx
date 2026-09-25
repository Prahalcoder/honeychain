import { useRegisterSW } from 'virtual:pwa-register/react'

// Installed as an app, there is no browser reload button to fall back on: this is the only way an officer on
// an old cached version finds out a new one is ready and gets it, with one tap.
export default function PwaUpdate() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null

  return (
    <div className="pwa-update-banner">
      <span>A newer version of Honey Chain Admin is ready.</span>
      <button onClick={() => updateServiceWorker(true)}>Reload now</button>
    </div>
  )
}
