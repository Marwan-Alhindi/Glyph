import { useMemo, useState } from "react"

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]
const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

export function toDateKey(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

function Calendar({ selectedKey, onSelect, hasNote }) {
    const today = useMemo(() => new Date(), [])
    const [viewYear, setViewYear] = useState(() => {
        if (selectedKey) return parseInt(selectedKey.slice(0, 4), 10)
        return today.getFullYear()
    })
    const [viewMonth, setViewMonth] = useState(() => {
        if (selectedKey) return parseInt(selectedKey.slice(5, 7), 10) - 1
        return today.getMonth()
    })

    const todayKey = toDateKey(today)

    const days = useMemo(() => {
        const firstOfMonth = new Date(viewYear, viewMonth, 1)
        const startWeekday = firstOfMonth.getDay()
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
        const cells = []
        for (let i = 0; i < startWeekday; i++) cells.push(null)
        for (let d = 1; d <= daysInMonth; d++) {
            cells.push(new Date(viewYear, viewMonth, d))
        }
        while (cells.length % 7 !== 0) cells.push(null)
        return cells
    }, [viewYear, viewMonth])

    function shiftMonth(delta) {
        const next = new Date(viewYear, viewMonth + delta, 1)
        setViewYear(next.getFullYear())
        setViewMonth(next.getMonth())
    }

    function goToToday() {
        setViewYear(today.getFullYear())
        setViewMonth(today.getMonth())
        onSelect(todayKey)
    }

    return (
        <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    Calendar
                </span>
                <button
                    onClick={goToToday}
                    className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                >
                    Today
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 lp-scroll">
                <div className="mb-3 flex items-center justify-between">
                    <button
                        onClick={() => shiftMonth(-1)}
                        className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                        aria-label="Previous month"
                    >
                        <ChevronIcon dir="left" />
                    </button>
                    <div className="text-sm font-semibold text-[var(--color-fg)]">
                        {MONTHS[viewMonth]} {viewYear}
                    </div>
                    <button
                        onClick={() => shiftMonth(1)}
                        className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                        aria-label="Next month"
                    >
                        <ChevronIcon dir="right" />
                    </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                    {WEEKDAYS.map((d, i) => (
                        <div key={i} className="py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
                            {d}
                        </div>
                    ))}
                    {days.map((date, i) => {
                        if (!date) return <div key={`empty-${i}`} />
                        const key = toDateKey(date)
                        const isToday = key === todayKey
                        const isSelected = key === selectedKey
                        const noted = hasNote?.(key)
                        return (
                            <button
                                key={key}
                                onClick={() => onSelect(key)}
                                className={`relative aspect-square rounded-md text-xs transition-colors ${
                                    isSelected
                                        ? "bg-[var(--color-fg)] text-[var(--color-canvas)] font-semibold"
                                        : isToday
                                            ? "border border-[var(--color-fg-subtle)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
                                            : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                                }`}
                            >
                                {date.getDate()}
                                {noted && !isSelected && (
                                    <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />
                                )}
                            </button>
                        )
                    })}
                </div>

                <div className="mt-4 flex items-center justify-center gap-3 text-[10px] text-[var(--color-fg-subtle)]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        has note
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm border border-[var(--color-fg-subtle)]" />
                        today
                    </span>
                </div>
            </div>
        </section>
    )
}

function ChevronIcon({ dir }) {
    const points = dir === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={points} />
        </svg>
    )
}

export default Calendar
