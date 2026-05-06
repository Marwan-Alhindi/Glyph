import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

function formatHumanDate(dateKey) {
    if (!dateKey) return ""
    const [y, m, d] = dateKey.split("-").map(n => parseInt(n, 10))
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    })
}

function DailyNote({ dateKey, value, onChange }) {
    const [mode, setMode] = useState("write") // "write" | "preview"
    const [draft, setDraft] = useState(value ?? "")
    const debounceRef = useRef(null)
    const lastDateRef = useRef(dateKey)

    // Reset draft when the selected day changes (flushing pending change first)
    useEffect(() => {
        if (lastDateRef.current !== dateKey) {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
                debounceRef.current = null
            }
            setDraft(value ?? "")
            lastDateRef.current = dateKey
        }
    }, [dateKey, value])

    // Sync down if the persisted value changes externally for the same day
    useEffect(() => {
        if (lastDateRef.current === dateKey && (value ?? "") !== draft && debounceRef.current === null) {
            setDraft(value ?? "")
        }
    }, [value, dateKey, draft])

    function handleChange(e) {
        const next = e.target.value
        setDraft(next)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            onChange(dateKey, next)
            debounceRef.current = null
        }, 300)
    }

    function handleBlur() {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current)
            debounceRef.current = null
        }
        onChange(dateKey, draft)
    }

    const taskCount = useMemo(() => {
        const matches = draft.match(/^\s*- \[[ xX]\]/gm)
        return matches ? matches.length : 0
    }, [draft])

    const doneCount = useMemo(() => {
        const matches = draft.match(/^\s*- \[[xX]\]/gm)
        return matches ? matches.length : 0
    }, [draft])

    const placeholder = `# ${formatHumanDate(dateKey)}

## Tasks
- [ ] Add a task
- [ ] Another one

## Notes
Write anything — it's just markdown.`

    return (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        Daily note
                    </span>
                    <span className="text-[11px] text-[var(--color-fg-muted)]">·</span>
                    <span className="truncate text-[11px] text-[var(--color-fg-muted)]">
                        {formatHumanDate(dateKey)}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {taskCount > 0 && (
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                            {doneCount}/{taskCount} done
                        </span>
                    )}
                    <div className="flex items-center gap-0.5 rounded-md border border-[var(--color-line)] p-0.5">
                        <ModeBtn active={mode === "write"} onClick={() => setMode("write")}>Write</ModeBtn>
                        <ModeBtn active={mode === "preview"} onClick={() => setMode("preview")}>Preview</ModeBtn>
                    </div>
                </div>
            </div>

            {mode === "write" ? (
                <textarea
                    value={draft}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder={placeholder}
                    spellCheck="false"
                    className="lp-scroll min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none"
                />
            ) : (
                <div className="lp-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {draft.trim() === "" ? (
                        <p className="text-sm text-[var(--color-fg-subtle)]">Nothing here yet — switch to Write to start.</p>
                    ) : (
                        <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
                        </div>
                    )}
                </div>
            )}
        </section>
    )
}

function ModeBtn({ children, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                active
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]"
            }`}
        >
            {children}
        </button>
    )
}

export default DailyNote
