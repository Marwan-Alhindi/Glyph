import { useEffect, useMemo, useRef, useState } from "react"
import { API_BASE } from "../../services/supabase"
import { useAuth } from "../../contexts/AuthContext"

function countOpenTasks(markdown) {
    if (!markdown) return 0
    const matches = markdown.match(/^\s*- \[ \]/gm)
    return matches ? matches.length : 0
}

function formatDateLabel(dateKey) {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || ""
    const [y, m, d] = dateKey.split("-").map(n => parseInt(n, 10))
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

function Agent({ chatId, notes }) {
    const { session } = useAuth()
    const [phase, setPhase] = useState("idle") // idle | thinking | running | done | error
    const [summary, setSummary] = useState("")
    const [plan, setPlan] = useState([]) // [{date, task, depends_on, rationale, _status}]
    const [error, setError] = useState(null)
    const cancelRef = useRef(false)

    const days = useMemo(() => {
        return Object.entries(notes)
            .filter(([, md]) => countOpenTasks(md) > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, markdown]) => ({ date, markdown }))
    }, [notes])

    const totalOpenTasks = useMemo(
        () => days.reduce((sum, d) => sum + countOpenTasks(d.markdown), 0),
        [days]
    )

    const doneCount = plan.filter(p => p._status === "done").length

    useEffect(() => () => { cancelRef.current = true }, [])

    async function run() {
        if (!chatId || !days.length) return
        cancelRef.current = false
        setPhase("thinking")
        setSummary("")
        setPlan([])
        setError(null)

        try {
            const res = await fetch(`${API_BASE}/planAgent`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ chat_id: chatId }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || res.statusText)
            }
            const data = await res.json()
            if (cancelRef.current) return

            const initialPlan = (data.plan || []).map(p => ({ ...p, _status: "queued" }))
            setSummary(data.summary || "")
            setPlan(initialPlan)

            if (initialPlan.length === 0) {
                setPhase("done")
                return
            }

            setPhase("running")

            for (let i = 0; i < initialPlan.length; i++) {
                if (cancelRef.current) return
                await sleep(550)
                if (cancelRef.current) return
                setPlan(prev => prev.map((p, idx) => idx === i ? { ...p, _status: "working" } : p))
                await sleep(900)
                if (cancelRef.current) return
                setPlan(prev => prev.map((p, idx) => idx === i ? { ...p, _status: "done" } : p))
            }
            if (!cancelRef.current) setPhase("done")
        } catch (e) {
            if (cancelRef.current) return
            setError(String(e?.message || e))
            setPhase("error")
        }
    }

    function reset() {
        cancelRef.current = true
        setPhase("idle")
        setPlan([])
        setSummary("")
        setError(null)
    }

    return (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        Agent
                    </span>
                    <span className="text-[11px] text-[var(--color-fg-subtle)]">·</span>
                    <span className="truncate text-[11px] text-[var(--color-fg-muted)]">
                        {phase === "running" ? `Working — ${doneCount}/${plan.length}` :
                         phase === "thinking" ? "Reasoning over your week…" :
                         phase === "done" && plan.length > 0 ? `Done — ${doneCount}/${plan.length}` :
                         phase === "done" ? "No open tasks" :
                         phase === "error" ? "Error" :
                         `${totalOpenTasks} open ${totalOpenTasks === 1 ? "task" : "tasks"} across ${days.length} ${days.length === 1 ? "day" : "days"}`}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {phase === "idle" && (
                        <button
                            onClick={run}
                            disabled={totalOpenTasks === 0}
                            className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <SparkIcon /> Run
                        </button>
                    )}
                    {(phase === "done" || phase === "error") && (
                        <button
                            onClick={reset}
                            className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-[11px] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
                        >
                            Reset
                        </button>
                    )}
                </div>
            </div>

            <div className="lp-scroll flex-1 overflow-y-auto px-4 py-4">
                {phase === "idle" && (
                    <Idle totalOpenTasks={totalOpenTasks} days={days} onRun={run} />
                )}

                {phase === "thinking" && <Thinking />}

                {phase === "error" && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {error || "Something went wrong."}
                    </div>
                )}

                {(phase === "running" || phase === "done") && (
                    <PlanList summary={summary} plan={plan} />
                )}
            </div>
        </section>
    )
}

function Idle({ totalOpenTasks, days, onRun }) {
    if (totalOpenTasks === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]">
                    <SparkIcon size={18} />
                </span>
                <p className="mt-3 text-sm text-[var(--color-fg-muted)]">Nothing to plan yet</p>
                <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                    Add tasks in your daily notes — use <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px]">- [ ]</span> for an open task.
                </p>
            </div>
        )
    }
    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">Will read</div>
                <ul className="mt-2 space-y-1">
                    {days.map(d => (
                        <li key={d.date} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--color-fg)]">{formatDateLabel(d.date)}</span>
                            <span className="text-[var(--color-fg-subtle)]">
                                {countOpenTasks(d.markdown)} open
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
            <button
                onClick={onRun}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)]"
            >
                <SparkIcon /> Plan and run
            </button>
            <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
                The agent reads every day's tasks, infers dependencies, and orders them so that ready tasks run first — even across days.
            </p>
        </div>
    )
}

function Thinking() {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 lp-dot" />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 lp-dot" style={{ animationDelay: "0.16s" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 lp-dot" style={{ animationDelay: "0.32s" }} />
                <span className="ml-1">Reading your week and finding what's ready…</span>
            </div>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
        </div>
    )
}

function SkeletonRow() {
    return (
        <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-3">
            <div className="h-3 w-2/3 rounded bg-[var(--color-surface-3)]" />
            <div className="mt-2 h-2 w-1/2 rounded bg-[var(--color-surface-3)]/60" />
        </div>
    )
}

function PlanList({ summary, plan }) {
    if (plan.length === 0) {
        return (
            <p className="text-sm text-[var(--color-fg-muted)]">No open tasks were found across your days.</p>
        )
    }
    return (
        <div className="space-y-3">
            {summary && (
                <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--color-fg-muted)]">
                    {summary}
                </div>
            )}
            <ol className="space-y-2">
                {plan.map((p, i) => (
                    <PlanItem key={i} index={i} entry={p} />
                ))}
            </ol>
        </div>
    )
}

function PlanItem({ index, entry }) {
    const status = entry._status || "queued"
    const isDone = status === "done"
    const isWorking = status === "working"

    return (
        <li
            className={[
                "rounded-lg border px-3 py-2 transition-colors",
                isWorking
                    ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                    : isDone
                        ? "border-[var(--color-line-soft)] bg-[var(--color-surface-2)]"
                        : "border-[var(--color-line-soft)] bg-[var(--color-surface-1)]",
            ].join(" ")}
        >
            <div className="flex items-start gap-2.5">
                <StatusBadge status={status} index={index} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className={`text-sm leading-snug ${isDone ? "line-through text-[var(--color-fg-muted)]" : "text-[var(--color-fg)]"}`}>
                            {entry.task}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                            {formatDateLabel(entry.date)}
                        </span>
                    </div>
                    {entry.rationale && (
                        <div className="mt-1 text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
                            {entry.rationale}
                        </div>
                    )}
                    {Array.isArray(entry.depends_on) && entry.depends_on.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-[var(--color-fg-subtle)]">needs:</span>
                            {entry.depends_on.map((d, j) => (
                                <span key={j} className="rounded-sm border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-px text-[10px] text-[var(--color-fg-muted)]">
                                    {d}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </li>
    )
}

function StatusBadge({ status, index }) {
    if (status === "done") {
        return (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
                <CheckIcon />
            </span>
        )
    }
    if (status === "working") {
        return (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/[0.08]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            </span>
        )
    }
    return (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[10px] text-[var(--color-fg-subtle)]">
            {index + 1}
        </span>
    )
}

function SparkIcon({ size = 13 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
            <path d="M5 5l2.8 2.8" />
            <path d="M16.2 16.2L19 19" />
            <path d="M5 19l2.8-2.8" />
            <path d="M16.2 7.8L19 5" />
        </svg>
    )
}

function CheckIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export default Agent
