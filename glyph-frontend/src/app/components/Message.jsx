import { useMemo, useState } from "react"
import { getLLMColor } from "../utils/llmColors"

const COLLAPSE_THRESHOLD = 320

function Message({ text, isMe = false, invitedLLMs = [] }) {
    const [expanded, setExpanded] = useState(false)
    const isLong = (text || '').length > COLLAPSE_THRESHOLD

    // Build mention map (lowercase name -> color helper)
    const mentionMap = useMemo(() => {
        const m = {}
        for (const llm of invitedLLMs) {
            m[llm.display_name.toLowerCase()] = getLLMColor(llm.display_number)
        }
        return m
    }, [invitedLLMs])

    // Split text into segments, color @mentions
    const segments = useMemo(() => {
        if (!text) return []
        const parts = []
        const regex = /(@\S+)/g
        let last = 0
        let match
        while ((match = regex.exec(text)) !== null) {
            if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
            const handle = match[0].slice(1).toLowerCase()
            parts.push({
                type: 'mention',
                value: match[0],
                color: mentionMap[handle] || null,
            })
            last = match.index + match[0].length
        }
        if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
        return parts
    }, [text, mentionMap])

    return (
        <div
            className={`whitespace-pre-wrap break-words rounded-2xl border px-3.5 py-2 text-sm leading-relaxed text-[var(--color-fg)] ${
                isMe
                    ? 'bg-[var(--color-surface-3)] border-white/[0.07]'
                    : 'bg-[var(--color-surface-2)] border-[var(--color-line-soft)]'
            }`}
        >
            {(!expanded && isLong ? renderSegments(segments, COLLAPSE_THRESHOLD) : renderSegments(segments, Infinity))}
            {!expanded && isLong && <span className="text-[var(--color-fg-subtle)]">… </span>}
            {isLong && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="ml-1 text-xs text-[var(--color-fg-muted)] underline-offset-2 hover:underline"
                >
                    {expanded ? 'show less' : 'show more'}
                </button>
            )}
        </div>
    )
}

function renderSegments(segments, maxChars) {
    let used = 0
    const out = []
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        if (used >= maxChars) break
        const remaining = maxChars - used
        const value = seg.value.length > remaining ? seg.value.slice(0, remaining) : seg.value
        used += value.length

        if (seg.type === 'mention') {
            const color = seg.color
            if (color) {
                out.push(
                    <span
                        key={i}
                        className={`mx-0.5 inline-flex items-center rounded px-1 font-medium ${color.softBg} ${color.text}`}
                    >
                        {value}
                    </span>
                )
            } else {
                out.push(
                    <span key={i} className="font-medium text-[var(--color-fg)]">
                        {value}
                    </span>
                )
            }
        } else {
            out.push(<span key={i}>{value}</span>)
        }
    }
    return out
}

export default Message
