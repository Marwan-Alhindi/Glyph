import { useMemo } from "react"

function UserContext({ profile, isMe, messages, onClose }) {
    const userMessages = useMemo(
        () => messages.filter(m => m.sender_type === 'user' && m.sender_user_id === profile.id),
        [messages, profile.id]
    )

    const initial = (profile.first_name?.[0] || 'U').toUpperCase()
    const role = profile.role || 'member'

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="lp-scroll w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-surface-2)]/40 px-5 py-4">
                    <div className="flex items-center gap-3">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                            isMe
                                ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black'
                                : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
                        }`}>
                            {initial}
                        </span>
                        <div>
                            <p className="text-sm font-semibold text-[var(--color-fg)]">
                                {profile.first_name || 'User'}
                                {isMe && <span className="text-[var(--color-fg-subtle)] font-normal"> · you</span>}
                            </p>
                            <p className="text-[11px] capitalize text-[var(--color-fg-muted)]">{role}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="space-y-5 px-5 py-5">
                    <Section label={`Messages in this chat (${userMessages.length})`}>
                        <div className="lp-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
                            {userMessages.length === 0 ? (
                                <p className="text-xs text-[var(--color-fg-subtle)]">No messages yet.</p>
                            ) : (
                                userMessages.map(msg => (
                                    <div key={msg.id} className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-3 text-sm">
                                        <p className="line-clamp-3 text-[var(--color-fg)]">{msg.content}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </Section>
                </div>

                <div className="flex justify-end border-t border-[var(--color-line-soft)] px-5 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

function Section({ label, hint, children }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    {label}
                </span>
                {hint && <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>}
            </div>
            {children}
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

export default UserContext
