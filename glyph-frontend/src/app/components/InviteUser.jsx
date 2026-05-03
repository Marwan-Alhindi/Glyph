import { useState, useEffect } from "react"
import { supabase } from "../../services/supabase"

function InviteUser({ chatId, onClose }) {
    const [inviteCode, setInviteCode] = useState("")
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        async function fetchCode() {
            const { data } = await supabase
                .from("chats")
                .select("invite_code")
                .eq("id", chatId)
                .single()
            if (data) setInviteCode(data.invite_code)
        }
        fetchCode()
    }, [chatId])

    function handleCopy() {
        if (!inviteCode) return
        navigator.clipboard.writeText(inviteCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md mx-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-4">
                    <div>
                        <p className="text-base font-semibold">Invite teammates</p>
                        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">Share this code so they can join the chat.</p>
                    </div>
                    <button
                        aria-label="Close"
                        onClick={onClose}
                        className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="px-5 py-5">
                    <div className="flex items-stretch gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2">
                        <code className="flex-1 truncate rounded-lg bg-[var(--color-surface-3)] px-3 py-2 font-mono text-sm tracking-[0.2em] text-[var(--color-fg)]">
                            {inviteCode || '· · · · · ·'}
                        </code>
                        <button
                            onClick={handleCopy}
                            disabled={!inviteCode}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-black hover:bg-[var(--color-brand)] disabled:opacity-40"
                        >
                            {copied ? '✓ Copied' : 'Copy'}
                        </button>
                    </div>

                    <div className="mt-5 space-y-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-2)]/40 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                            How they join
                        </p>
                        <ol className="space-y-1.5 text-xs text-[var(--color-fg-muted)]">
                            <li>1. They sign in to Glyph.</li>
                            <li>2. Click <span className="text-[var(--color-fg)]">+ Join with invite code</span> in the sidebar.</li>
                            <li>3. Paste the code above. They're in.</li>
                        </ol>
                    </div>
                </div>

                <div className="flex justify-end border-t border-[var(--color-line-soft)] px-5 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    )
}

function CloseIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

export default InviteUser
