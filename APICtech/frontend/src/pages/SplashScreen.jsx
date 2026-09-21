import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function SplashScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/login')
    }, 2200)

    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <div className="app-shell relative flex min-h-screen items-center justify-center overflow-hidden">
      <div className="absolute left-1/2 top-1/2 h-136 w-136 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#F97360]/25" />
      <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#e36e4b]/15" />
      <div className="relative text-center">

        <div className="mx-auto mb-6 flex h-36 w-36 items-center justify-center rounded-full shadow-xl">
          <img
            src="/apictech-logo.png"
            alt="Honey Chain Logo"
            className="h-full w-full rounded-3xl object-cover shadow-[0_0_0_8px_rgba(247,84,59,0.12)]"
          />
        </div>

        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#199995]">Intelligent apiary operations</p>
        <h1 className="mt-3 text-5xl font-black tracking-tight text-[#14272e]">
          Honey Chain Keeper
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          Smart Beekeeping & Honey Traceability
        </p>

        <div className="mx-auto mt-8 h-1.5 w-40 overflow-hidden rounded-full bg-[#c0dfdd]">
          <div className="h-full w-full animate-pulse rounded-full bg-[#0F766E]" />
        </div>

        <p className="mt-3 text-xs text-gray-400">
          Connecting every drop to its source
        </p>

      </div>
    </div>
  )
}