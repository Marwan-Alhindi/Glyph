import { useNavigate } from 'react-router-dom'
import LiveDemo from './LiveDemo'
import PlannerDemo from './PlannerDemo'
import TryItDemo from './TryItDemo'
import Pricing from './Pricing'
import { useLanguage } from '../../contexts/LanguageContext'

function Hero() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const h = t.hero

  return (
    <section className="mx-auto max-w-6xl px-6 pt-20 pb-24 md:pt-28 md:pb-32">
      {/* Badge */}
      <div className="flex justify-center">
        <a
          href="#features"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)]/50 px-3 py-1 text-xs text-[var(--color-fg-muted)] backdrop-blur-md hover:border-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-brand)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />
          </span>
          {h.badge}
          <span>{t.arrow}</span>
        </a>
      </div>

      {/* Headline */}
      <h1 className="mt-6 text-center font-[var(--font-display)] text-4xl font-semibold tracking-tight text-[var(--color-fg)] md:text-6xl">
        {h.headline1}{' '}
        <span className="bg-gradient-to-r from-emerald-300 via-sky-300 to-violet-300 bg-clip-text text-transparent">
          {h.headline2}
        </span>
        <br className="hidden md:block" />
        <span className="text-[var(--color-fg-muted)]">{h.headline3}</span>
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-center text-base leading-relaxed text-[var(--color-fg-muted)] md:text-lg">
        {h.subheading}
      </p>

      {/* CTAs */}
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          onClick={() => navigate('/getstarted')}
          className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-all hover:bg-[var(--color-brand)] sm:w-auto"
        >
          {h.ctaPrimary}
          <span className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180">{t.arrow}</span>
        </button>
        <button
          onClick={() => navigate('/login')}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)]/40 px-6 py-3 text-sm text-[var(--color-fg)] backdrop-blur-md hover:border-[var(--color-fg-subtle)] sm:w-auto"
        >
          {h.ctaSecondary}
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--color-fg-subtle)]">
        {h.freeBadge}
      </p>

      {/* Mock chat preview */}
      <div className="relative mt-16 md:mt-20">
        <div className="absolute -inset-x-8 -inset-y-4 -z-10 rounded-[32px] bg-gradient-to-br from-emerald-500/10 via-violet-500/10 to-sky-500/10 blur-2xl" />
        <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
          {/* fake window chrome */}
          <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-surface-2)] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
              <span className="font-medium text-[var(--color-fg-muted)]">{h.mockChat.title}</span>
              <span>{h.mockChat.subtitle}</span>
            </div>
            <div className="w-12" />
          </div>

          {/* two-pane preview */}
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Left: team chat */}
            <div className="space-y-4 border-b border-[var(--color-line-soft)] p-5 md:border-b-0 md:border-e">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                {h.mockChat.team}
              </div>
              <Bubble who="Marwan" tone="me">
                <MentionText text={t.demo.hero.msgMarwan} />
              </Bubble>
              <Bubble who="Sara" tone="them">
                {t.demo.hero.msgSara}
              </Bubble>
              <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-fg-subtle)]">
                {h.mockChat.typeTip}
              </div>
            </div>

            {/* Right: LLM workspace */}
            <div className="space-y-4 p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                {h.mockChat.models}
              </div>
              <ModelCard
                colorRing="ring-emerald-500/60"
                colorDot="bg-emerald-400"
                colorText="text-emerald-300"
                name="Aria"
              >
                {t.demo.hero.ariaIntro}
                <ul className="mt-2 list-disc space-y-1 ps-5 text-[var(--color-fg-muted)]">
                  {t.demo.hero.ariaLines.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </ModelCard>
              <ModelCard
                colorRing="ring-violet-500/60"
                colorDot="bg-violet-400"
                colorText="text-violet-300"
                name="Nova"
              >
                {t.demo.hero.novaMsg}
              </ModelCard>
            </div>
          </div>
        </div>
      </div>

      {/* Feature trio */}
      <section id="features" className="mt-24 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-3">
        <Feature
          title={h.features.f1title}
          desc={h.features.f1desc}
        />
        <Feature
          title={h.features.f2title}
          desc={h.features.f2desc}
        />
        <Feature
          title={h.features.f3title}
          desc={h.features.f3desc}
        />
      </section>

      {/* Live demo (animated) */}
      <LiveDemo />

      {/* Planner demo (animated) */}
      <PlannerDemo />

      {/* Interactive playground */}
      <TryItDemo />

      {/* Pricing */}
      <Pricing />

      {/* CTA strip */}
      <div className="mt-24">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-10 text-center">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-violet-500/10" />
          <h2 className="relative text-2xl font-semibold tracking-tight md:text-3xl">
            {h.ctaStrip.headline}
          </h2>
          <p className="relative mt-2 text-sm text-[var(--color-fg-muted)]">
            {h.ctaStrip.desc}
          </p>
          <div className="relative mt-6 flex justify-center">
            <button
              onClick={() => navigate('/getstarted')}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-all hover:bg-[var(--color-brand)]"
            >
              {h.ctaStrip.button}
              <span className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180">{t.arrow}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function Bubble({ who, tone, children }) {
  const isMe = tone === 'me'
  return (
    <div className={`flex items-start gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}>
        {who[0]}
      </div>
      <div className="max-w-[80%] space-y-1">
        <div className={`text-[11px] text-[var(--color-fg-subtle)] ${isMe ? 'text-end' : ''}`}>{who}</div>
        <div className={`rounded-2xl border px-3.5 py-2 text-sm leading-relaxed text-[var(--color-fg)] ${isMe ? 'bg-[var(--color-surface-3)] border-white/[0.07]' : 'bg-[var(--color-surface-2)] border-[var(--color-line-soft)]'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

function ModelCard({ name, colorRing, colorDot, colorText, children }) {
  return (
    <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ring-2 ${colorRing} bg-[var(--color-surface-3)] text-[10px] font-semibold ${colorText}`}>
          {name[0]}
        </span>
        <span className={`text-xs font-medium ${colorText}`}>{name}</span>
        <span className={`ms-auto h-1.5 w-1.5 rounded-full ${colorDot}`} />
      </div>
      <div className="text-sm leading-relaxed text-[var(--color-fg)]">{children}</div>
    </div>
  )
}

const MENTION_COLORS = { Aria: 'text-emerald-300', Nova: 'text-violet-300', Atlas: 'text-sky-300' }

function MentionText({ text }) {
  const parts = text.split(/(@\w+)/g)
  return (
    <>
      {parts.map((p, i) => {
        const name = p.startsWith('@') ? p.slice(1) : null
        const color = name && MENTION_COLORS[name]
        return color ? <span key={i} className={color}>{p}</span> : <span key={i}>{p}</span>
      })}
    </>
  )
}

function Feature({ title, desc }) {
  return (
    <div className="bg-[var(--color-surface-1)] p-8">
      <h3 className="text-base font-medium tracking-tight text-[var(--color-fg)]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-fg-muted)]">{desc}</p>
    </div>
  )
}

export default Hero
