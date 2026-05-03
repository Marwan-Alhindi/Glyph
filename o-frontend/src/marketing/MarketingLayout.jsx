import { Outlet } from 'react-router-dom'
import Navigation from './components/Navigation'
import { useState } from 'react'

function MarketingLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--color-canvas)] text-[var(--color-fg)]">
      {/* Ambient gradient mesh */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
             style={{ background: 'radial-gradient(closest-side, rgba(255,216,77,0.18), transparent)' }} />
        <div className="absolute top-[40%] -left-40 h-[520px] w-[520px] rounded-full opacity-30 blur-3xl"
             style={{ background: 'radial-gradient(closest-side, rgba(139,92,246,0.20), transparent)' }} />
        <div className="absolute top-[60%] -right-40 h-[520px] w-[520px] rounded-full opacity-30 blur-3xl"
             style={{ background: 'radial-gradient(closest-side, rgba(14,165,233,0.18), transparent)' }} />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse at top, #000 30%, transparent 75%)',
          }}
        />
      </div>

      <Navigation mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      <main className="relative">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--color-line-soft)] mt-24">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-10 text-sm text-[var(--color-fg-subtle)] md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <img src="/logo-white.png" width={20} height={20} alt="" />
            <span className="font-medium tracking-wide text-[var(--color-fg-muted)]">O</span>
            <span>· Collaborative LLMs</span>
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-[var(--color-fg)]">Privacy</a>
            <a href="#" className="hover:text-[var(--color-fg)]">Terms</a>
            <a href="#" className="hover:text-[var(--color-fg)]">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default MarketingLayout
