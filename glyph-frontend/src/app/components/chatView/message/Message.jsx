import { useEffect, useMemo, useRef, useState } from "react"
import { getLLMColor, getPersonColor } from "../../../utils/llmColors"
import { findMentions } from "../../../utils/mentions"

const COLLAPSE_THRESHOLD = 320

function Message({
    text,
    attachments = [],
    isMe = false,
    invitedLLMs = [],
    profilesById = {},
    deletedAt = null,
    editedAt = null,
    canEdit = false,
    onEdit = null,
    onDelete = null,
}) {
    const [expanded, setExpanded] = useState(false)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(text || "")
    const [saving, setSaving] = useState(false)
    const inputRef = useRef(null)

    const isDeleted = !!deletedAt
    const isEdited = !!editedAt
    const isLong = (text || '').length > COLLAPSE_THRESHOLD

    useEffect(() => { if (!editing) setDraft(text || "") }, [text, editing])

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus()
            const v = inputRef.current.value
            inputRef.current.setSelectionRange(v.length, v.length)
        }
    }, [editing])

    // Split text into segments, colour @mentions for known LLMs and people.
    const segments = useMemo(() => {
        if (!text) return []
        const llmMentionables = (invitedLLMs || []).map(l => ({
            id: l.id,
            display_name: l.display_name,
            kind: 'llm',
            llm: l,
        }))
        const personMentionables = Object.values(profilesById || {})
            .filter(p => p.first_name)
            .map(p => ({
                id: p.id,
                display_name: p.first_name,
                kind: 'person',
                profile: p,
            }))
        const mentions = findMentions(text, [...personMentionables, ...llmMentionables])
        const parts = []
        let cursor = 0
        for (const m of mentions) {
            if (m.start > cursor) parts.push({ type: 'text', value: text.slice(cursor, m.start) })
            parts.push({
                type: 'mention',
                value: m.raw,
                kind: m.kind,
                color: m.kind === 'llm'
                    ? getLLMColor(m.target.llm.display_number)
                    : getPersonColor(m.target.profile?.id || m.target.id || m.target.display_name),
            })
            cursor = m.end
        }
        if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) })
        return parts
    }, [text, invitedLLMs, profilesById])

    if (isDeleted) {
        return (
            <div
                className={`whitespace-pre-wrap break-words rounded-2xl border px-3.5 py-2 text-sm italic leading-relaxed text-[var(--color-fg-subtle)] ${
                    isMe
                        ? 'bg-[var(--color-surface-3)]/60 border-white/[0.05]'
                        : 'bg-[var(--color-surface-2)]/60 border-[var(--color-line-soft)]'
                }`}
            >
                This message was deleted
            </div>
        )
    }

    if (editing) {
        const commit = async () => {
            const next = draft.trim()
            if (!next || next === text) { setEditing(false); return }
            setSaving(true)
            const ok = await onEdit?.(next)
            setSaving(false)
            if (ok !== false) setEditing(false)
        }
        return (
            <div
                className={`rounded-2xl border px-3.5 py-2 text-sm leading-relaxed ${
                    isMe
                        ? 'bg-[var(--color-surface-3)] border-white/[0.07]'
                        : 'bg-[var(--color-surface-2)] border-[var(--color-line-soft)]'
                }`}
            >
                <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            commit()
                        } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditing(false)
                            setDraft(text || "")
                        }
                    }}
                    rows={Math.min(8, Math.max(1, draft.split('\n').length))}
                    disabled={saving}
                    className="block w-full resize-none bg-transparent text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px]">
                    <span className="mr-auto text-[var(--color-fg-subtle)]">⏎ to save · esc to cancel</span>
                    <button
                        onClick={() => { setEditing(false); setDraft(text || "") }}
                        disabled={saving}
                        className="rounded px-2 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-50"
                    >Cancel</button>
                    <button
                        onClick={commit}
                        disabled={saving || !draft.trim()}
                        className="rounded bg-white px-2 py-0.5 font-medium text-black hover:bg-[var(--color-brand)] disabled:opacity-50"
                    >{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </div>
        )
    }

    const imageAttachments = (attachments || []).filter(a => (a.mime_type || '').startsWith('image/'))
    const fileAttachments = (attachments || []).filter(a => !(a.mime_type || '').startsWith('image/'))

    return (
        <div className="group/msg relative">
            {imageAttachments.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {imageAttachments.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                            <img
                                src={a.url}
                                alt={a.filename || 'image'}
                                className="max-h-48 max-w-xs rounded-xl border border-[var(--color-line-soft)] object-cover hover:opacity-90 transition-opacity"
                            />
                        </a>
                    ))}
                </div>
            )}
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
                {fileAttachments.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1">
                        {fileAttachments.map((a, i) => (
                            <a
                                key={i}
                                href={a.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors w-fit"
                            >
                                <FileAttachIcon />
                                <span className="max-w-[200px] truncate">{a.filename}</span>
                                {a.size > 0 && <span className="ml-auto pl-2 opacity-60">{formatFileSize(a.size)}</span>}
                            </a>
                        ))}
                    </div>
                )}
                {isEdited && (
                    <span className="ml-1.5 text-[10px] text-[var(--color-fg-subtle)]" title={`Edited ${new Date(editedAt).toLocaleString()}`}>
                        (edited)
                    </span>
                )}
            </div>

            {canEdit && (
                <div className={`absolute -top-2 ${isMe ? 'left-1' : 'right-1'} flex gap-0.5 rounded-md border border-[var(--color-line-soft)] bg-[var(--color-surface-1)] p-0.5 opacity-0 shadow transition-opacity group-hover/msg:opacity-100`}>
                    <button
                        onClick={() => setEditing(true)}
                        className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                        title="Edit message"
                    >
                        <PencilIcon size={11} />
                    </button>
                    <button
                        onClick={() => onDelete?.()}
                        className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-rose-400"
                        title="Delete message"
                    >
                        <TrashIcon size={11} />
                    </button>
                </div>
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
            if (seg.kind === 'llm' && color) {
                out.push(
                    <span
                        key={i}
                        className={`mx-0.5 inline-flex items-center rounded px-1 font-medium ${color.softBg} ${color.text}`}
                    >
                        {value}
                    </span>
                )
            } else if (seg.kind === 'person' && color) {
                out.push(
                    <span
                        key={i}
                        className={`mx-0.5 inline-flex items-center rounded border px-1 font-medium ${color.softBorder} ${color.softBg} ${color.text}`}
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

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileAttachIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    )
}

function PencilIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
    )
}
function TrashIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

export default Message
