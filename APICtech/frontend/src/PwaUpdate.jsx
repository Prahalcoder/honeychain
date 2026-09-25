import { useRegisterSW } from 'virtual:pwa-register/react'

// Installed as an app, there is no browser reload button to fall back on: this is the only way a keeper on
// an old cached version finds out a new one is ready and gets it, with one tap and no lost work in a form.
export default function PwaUpdate() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[200] flex items-center justify-center gap-3 bg-[#0F766E] px-4 py-3 text-sm font-semibold text-white shadow-[0_-6px_20px_rgba(0,0,0,0.15)]">
      <span>A newer version of Honey Chain Keeper is ready.</span>
      <button onClick={() => updateServiceWorker(true)} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">Reload now</button>
    </div>
  )
}
