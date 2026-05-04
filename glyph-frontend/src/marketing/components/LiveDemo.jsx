import { useEffect, useRef, useState } from "react"

const CYCLE_MS = 7000
const HOLD_MS = 3500

const FOLLOW_UP = {
    person: { name: "Sara", avatar: "S", isMe: false },
    prompt: "Nice — that's the launch covered. Speak to @Atlas for review or revisions.",
    mentionTarget: "Atlas",
    mentionColor: "text-sky-300",
    startMs: 5100,
    typeMs: 1300,
}

const THREADS = [
    {
        person: { name: "Marwan", avatar: "M", isMe: true },
        prompt: "@Aria design the launch hero — clean, dark, emerald accent.",
        mentionTarget: "Aria",
        startMs: 0,
        typeMs: 800,
        llm: {
            name: "Aria",
            model: "GPT-4o",
            color: {
                ring: "ring-emerald-500/60",
                dot: "bg-emerald-400",
                text: "text-emerald-300",
                soft: "bg-emerald-500/[0.07]",
                border: "border-emerald-500/30",
            },
            thinkFromMs: 1100,
            artifactFromMs: 2900,
            artifact: 'design',
        },
    },
    {
        person: { name: "Sara", avatar: "S", isMe: false },
        prompt: "@Nova code the hover keyframes for that button.",
        mentionTarget: "Nova",
        startMs: 500,
        typeMs: 800,
        llm: {
            name: "Nova",
            model: "Claude",
            color: {
                ring: "ring-violet-500/60",
                dot: "bg-violet-400",
                text: "text-violet-300",
                soft: "bg-violet-500/[0.07]",
                border: "border-violet-500/30",
            },
            thinkFromMs: 1600,
            artifactFromMs: 3600,
            artifact: 'code',
        },
    },
    {
        person: { name: "Jamie", avatar: "J", isMe: false },
        prompt: "@Atlas wrap it all into a launch-plan PDF.",
        mentionTarget: "Atlas",
        startMs: 1000,
        typeMs: 800,
        llm: {
            name: "Atlas",
            model: "Gemini",
            color: {
                ring: "ring-sky-500/60",
                dot: "bg-sky-400",
                text: "text-sky-300",
                soft: "bg-sky-500/[0.07]",
                border: "border-sky-500/30",
            },
            thinkFromMs: 2100,
            artifactFromMs: 4300,
            artifact: 'pdf',
        },
    },
]

function LiveDemo() {
    const sectionRef = useRef(null)
    const [inView, setInView] = useState(false)
    const [elapsed, setElapsed] = useState(0)

    useEffect(() => {
        const el = sectionRef.current
        if (!el) return
        const obs = new IntersectionObserver(
            entries => setInView(entries[0]?.isIntersecting ?? false),
            { threshold: 0.15 }
        )
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    useEffect(() => {
        if (!inView) return
        let raf
        let lastNow = performance.now()
        const tick = (now) => {
            setElapsed(prev => (prev + (now - lastNow)) % (CYCLE_MS + HOLD_MS))
            lastNow = now
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [inView])

    return (
        <section ref={sectionRef} className="mt-28">
            <style>{`
@keyframes ldFadeIn {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ld-fade-in { animation: ldFadeIn 0.45s ease-out both; }
@keyframes ldCaret {
  0%, 49% { opacity: 1 }
  50%, 100% { opacity: 0 }
}
.ld-caret { animation: ldCaret 0.85s steps(1) infinite; }
@keyframes ldSharedPulse {
  0%   { transform: translateX(-100%); opacity: 0; }
  20%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateX(400%); opacity: 0; }
}
.ld-shared-pulse { animation: ldSharedPulse 3.6s linear infinite; }
            `}</style>

            {/* Header */}
            <div className="text-center">
                <h2 className="font-[var(--font-display)] text-3xl font-semibold tracking-tight md:text-4xl">
                    One thread.{' '}
                    <span className="bg-gradient-to-r from-emerald-300 via-violet-300 to-sky-300 bg-clip-text text-transparent">
                        Parallel work.
                    </span>
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--color-fg-muted)] md:text-base">
                    Three asks, three deliverables — happening live in the same chat.
                </p>
            </div>

            {/* Mock window */}
            <div className="relative mt-12 md:mt-14">
                <div className="absolute -inset-x-8 -inset-y-4 -z-10 rounded-[32px] bg-gradient-to-br from-emerald-500/10 via-violet-500/10 to-sky-500/10 blur-2xl" />
                <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                    {/* Window chrome */}
                    <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-surface-2)] px-4 py-3">
                        <div className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                            <span className="font-medium text-[var(--color-fg-muted)]">launch-plan</span>
                            <span>· 3 humans · 3 models</span>
                        </div>
                        <div className="w-12" />
                    </div>

                    {/* Shared context strip */}
                    <div className="relative flex items-center justify-center gap-2 border-b border-[var(--color-line-soft)] bg-gradient-to-r from-emerald-500/[0.04] via-violet-500/[0.04] to-sky-500/[0.04] px-4 py-2">
                        <ShareIcon />
                        <span className="text-[11px] text-[var(--color-fg-muted)]">
                            Shared context — every message and every output is visible to all 6
                        </span>
                        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px overflow-hidden">
                            <div className="ld-shared-pulse h-full w-1/3 bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />
                        </div>
                    </div>

                    {/* Two panes */}
                    <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-2">
                        {/* Team (left) */}
                        <div className="space-y-5 border-b border-[var(--color-line-soft)] p-5 md:border-b-0 md:border-r">
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                                Team
                            </div>
                            {THREADS.map((thread, i) => (
                                <UserBubble
                                    key={i}
                                    person={thread.person}
                                    prompt={thread.prompt}
                                    mentionTarget={thread.mentionTarget}
                                    mentionColor={thread.llm.color.text}
                                    startMs={thread.startMs}
                                    typeMs={thread.typeMs}
                                    elapsed={elapsed}
                                />
                            ))}
                            <UserBubble
                                person={FOLLOW_UP.person}
                                prompt={FOLLOW_UP.prompt}
                                mentionTarget={FOLLOW_UP.mentionTarget}
                                mentionColor={FOLLOW_UP.mentionColor}
                                startMs={FOLLOW_UP.startMs}
                                typeMs={FOLLOW_UP.typeMs}
                                elapsed={elapsed}
                            />
                        </div>

                        {/* Models (right) */}
                        <div className="space-y-3 p-5">
                            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                                Models
                            </div>
                            {THREADS.map((thread, i) => (
                                <ModelCard key={i} thread={thread} elapsed={elapsed} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function UserBubble({ person, prompt, mentionTarget, mentionColor, startMs, typeMs, elapsed }) {
    const local = elapsed - startMs
    const visible = local >= 0
    const fraction = Math.min(Math.max(local / typeMs, 0), 1)
    const charsToShow = Math.floor(prompt.length * fraction)
    const text = prompt.slice(0, charsToShow)
    const isTyping = fraction > 0 && fraction < 1

    const mention = `@${mentionTarget}`
    const mentionStart = prompt.indexOf(mention)
    const mentionEnd = mentionStart + mention.length

    return (
        <div
            className={`flex items-start gap-3 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'} ${person.isMe ? 'flex-row-reverse' : ''}`}
        >
            <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${person.isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}
            >
                {person.avatar}
            </div>
            <div className={`max-w-[88%] space-y-1 ${person.isMe ? 'text-right' : ''}`}>
                <div className="text-[11px] text-[var(--color-fg-subtle)]">{person.name}</div>
                <div
                    className={`inline-block min-h-[36px] rounded-2xl border px-3.5 py-2 text-left text-sm leading-relaxed text-[var(--color-fg)] ${person.isMe ? 'bg-[var(--color-surface-3)] border-white/[0.07]' : 'bg-[var(--color-surface-2)] border-[var(--color-line-soft)]'}`}
                >
                    <PromptText text={text} mentionStart={mentionStart} mentionEnd={mentionEnd} mentionColor={mentionColor} />
                    {isTyping && <span className="ld-caret ml-0.5 inline-block h-[1em] w-[1.5px] translate-y-[2px] bg-[var(--color-fg-subtle)] align-middle" />}
                </div>
            </div>
        </div>
    )
}

function PromptText({ text, mentionStart, mentionEnd, mentionColor }) {
    if (mentionStart < 0) {
        return <span>{text}</span>
    }
    const len = text.length
    const parts = []

    if (mentionStart > 0 && len > 0) {
        parts.push(<span key="b">{text.slice(0, Math.min(len, mentionStart))}</span>)
    }
    if (len > mentionStart) {
        const mShownEnd = Math.min(len, mentionEnd)
        parts.push(
            <span key="m" className={`font-medium ${mentionColor}`}>
                {text.slice(mentionStart, mShownEnd)}
            </span>
        )
    }
    if (len > mentionEnd) {
        parts.push(<span key="a">{text.slice(mentionEnd)}</span>)
    }
    return <>{parts}</>
}

function ModelCard({ thread, elapsed }) {
    const { llm } = thread
    const isWaiting = elapsed < llm.thinkFromMs
    const isThinking = elapsed >= llm.thinkFromMs && elapsed < llm.artifactFromMs
    const isDelivered = elapsed >= llm.artifactFromMs

    return (
        <div
            className={`rounded-xl border ${llm.color.border} ${llm.color.soft} p-4 transition-opacity duration-500`}
        >
            <div className="mb-2 flex items-center gap-2">
                <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ring-2 ${llm.color.ring} bg-[var(--color-surface-3)] text-[10px] font-semibold ${llm.color.text}`}
                >
                    {llm.name[0]}
                </span>
                <span className={`text-xs font-medium ${llm.color.text}`}>{llm.name}</span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">· {llm.model}</span>
                <span
                    className={`ml-auto h-1.5 w-1.5 rounded-full ${llm.color.dot} ${isThinking ? 'animate-pulse' : ''} ${isWaiting ? 'opacity-30' : ''}`}
                />
            </div>
            <div className="text-sm leading-relaxed text-[var(--color-fg)]">
                {isWaiting && <Placeholder />}
                {isThinking && <ThinkingDots colorClass={llm.color.dot} />}
                {isDelivered && <Artifact kind={llm.artifact} />}
            </div>
        </div>
    )
}

function ThinkingDots({ colorClass }) {
    return (
        <div className="flex items-center gap-1.5 py-2">
            <span className={`h-1.5 w-1.5 rounded-full ${colorClass} lp-dot`} />
            <span className={`h-1.5 w-1.5 rounded-full ${colorClass} lp-dot`} style={{ animationDelay: '0.16s' }} />
            <span className={`h-1.5 w-1.5 rounded-full ${colorClass} lp-dot`} style={{ animationDelay: '0.32s' }} />
        </div>
    )
}

function Placeholder() {
    return <p className="text-[11px] italic text-[var(--color-fg-subtle)]">Waiting for prompt…</p>
}

function Artifact({ kind }) {
    if (kind === 'design') return <DesignArtifact />
    if (kind === 'code') return <CodeArtifact />
    if (kind === 'pdf') return <PdfArtifact />
    return null
}

function DesignArtifact() {
    return (
        <div className="ld-fade-in rounded-lg border border-emerald-500/20 bg-[var(--color-surface-2)] p-3">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300/80">Hero · v1</div>
            <div className="mt-2 rounded-md bg-gradient-to-br from-emerald-400/40 via-sky-400/30 to-violet-400/40 p-4 text-center">
                <p className="text-[10px] text-white/70">Headline</p>
                <p className="text-sm font-semibold text-white">One chat. Every model.</p>
                <button className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black">
                    Start free →
                </button>
            </div>
            <p className="mt-2 text-[10px] text-[var(--color-fg-subtle)]">Emerald · Sky · Violet · Dark canvas</p>
        </div>
    )
}

function CodeArtifact() {
    return (
        <pre className="ld-fade-in overflow-hidden rounded-lg border border-violet-500/20 bg-[#0c0c10] p-3 text-[11px] leading-relaxed text-violet-200">
{`@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(16,185,129,.6); }
  100% { box-shadow: 0 0 0 12px rgba(16,185,129,0); }
}
.btn:hover { animation: pulse 1.4s infinite; }`}
        </pre>
    )
}

function PdfArtifact() {
    return (
        <div className="ld-fade-in flex items-center gap-3 rounded-lg border border-sky-500/20 bg-[var(--color-surface-2)] p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-300">
                <PdfIcon />
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--color-fg)]">launch-plan.pdf</div>
                <div className="text-[10px] text-[var(--color-fg-subtle)]">3 pages · 142 KB</div>
            </div>
            <button className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] font-medium text-sky-300">
                Download →
            </button>
        </div>
    )
}

function PdfIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="14" x2="15" y2="14" />
            <line x1="9" y1="18" x2="13" y2="18" />
        </svg>
    )
}

function ShareIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-fg-subtle)]">
            <circle cx="6" cy="12" r="2.2" />
            <circle cx="18" cy="6" r="2.2" />
            <circle cx="18" cy="18" r="2.2" />
            <line x1="8" y1="11" x2="16" y2="7" />
            <line x1="8" y1="13" x2="16" y2="17" />
        </svg>
    )
}

export default LiveDemo
