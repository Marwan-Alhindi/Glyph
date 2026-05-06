import { useEffect, useMemo, useState } from "react"
import { supabase, apiFetch } from "../../../../services/supabase"
import { useAuth } from "../../../../contexts/AuthContext"

function InviteUser({ chatId, onClose }) {
    const { user } = useAuth()
    const [me, setMe] = useState(null) // current user's chat_participants row
    const [participants, setParticipants] = useState([])
    const [profilesById, setProfilesById] = useState({})
    const [pending, setPending] = useState([])
    const [loading, setLoading] = useState(true)

    const [email, setEmail] = useState("")
    const [sendError, setSendError] = useState("")
    const [sending, setSending] = useState(false)
    const [copiedToken, setCopiedToken] = useState(null)

    const appUrl = useMemo(() => {
        if (typeof window !== "undefined") return window.location.origin
        return ""
    }, [])

    const isOwner = me?.role === "owner"
    const canInvite = isOwner || me?.can_invite === true

    useEffect(() => {
        let cancelled = false

        async function load() {
            setLoading(true)

            const partsResult = await supabase
                .from("chat_participants")
                .select("*")
                .eq("chat_id", chatId)
                .order("joined_at", { ascending: true })
            if (cancelled) return
            if (partsResult.error) console.error("InviteUser: failed to load participants", partsResult.error)
            const parts = partsResult.data || []
            setParticipants(parts)
            setMe(parts.find(p => p.user_id === user?.id) || null)

            const userIds = parts.map(p => p.user_id)
            if (userIds.length > 0) {
                const profResult = await supabase
                    .from("profiles")
                    .select("id, first_name")
                    .in("id", userIds)
                if (cancelled) return
                if (profResult.error) console.error("InviteUser: failed to load profiles", profResult.error)
                const map = {}
                for (const p of profResult.data || []) map[p.id] = p
                setProfilesById(map)
            }

            const meRow = parts.find(p => p.user_id === user?.id)
            if (meRow && (meRow.role === "owner" || meRow.can_invite)) {
                try {
                    const res = await apiFetch(`/invitations?chat_id=${encodeURIComponent(chatId)}`)
                    if (!cancelled) setPending(res.invitations || [])
                } catch {
                    if (!cancelled) setPending([])
                }
            }

            if (!cancelled) setLoading(false)
        }

        load()
        return () => { cancelled = true }
    }, [chatId, user?.id])

    async function handleSend(e) {
        e?.preventDefault?.()
        setSendError("")
        const trimmed = email.trim()
        if (!trimmed) return
        setSending(true)
        try {
            const created = await apiFetch("/invitations", {
                method: "POST",
                body: { chat_id: chatId, email: trimmed },
            })
            setPending(prev => [created, ...prev])
            setEmail("")
        } catch (err) {
            setSendError(err.detail || err.message || "Could not send invitation.")
        } finally {
            setSending(false)
        }
    }

    async function handleRevoke(invitationId) {
        try {
            await apiFetch(`/invitations/${invitationId}`, { method: "DELETE" })
            setPending(prev => prev.filter(i => i.id !== invitationId))
        } catch (err) {
            alert(err.detail || err.message || "Could not revoke invitation.")
        }
    }

    function handleCopyLink(token) {
        const link = `${appUrl}/invite/${token}`
        navigator.clipboard.writeText(link)
        setCopiedToken(token)
        setTimeout(() => setCopiedToken(t => (t === token ? null : t)), 2000)
    }

    async function handleToggleCanInvite(participant, next) {
        const previous = participant.can_invite
        setParticipants(prev => prev.map(p => p.id === participant.id ? { ...p, can_invite: next } : p))
        try {
            await apiFetch(`/chat_participants/${participant.id}/can_invite`, {
                method: "PATCH",
                body: { can_invite: next },
            })
        } catch (err) {
            setParticipants(prev => prev.map(p => p.id === participant.id ? { ...p, can_invite: previous } : p))
            alert(err.detail || err.message || "Could not update permission.")
        }
    }

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="lp-scroll w-full max-w-lg mx-4 max-h-[88vh] overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-4">
                    <div>
                        <p className="text-base font-semibold">Invite teammates</p>
                        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
                            Send an email invite. The recipient gets a one-time link.
                        </p>
                    </div>
                    <button
                        aria-label="Close"
                        onClick={onClose}
                        className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="space-y-6 px-5 py-5">
                    {!loading && !canInvite && (
                        <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)]/50 px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                            Only the chat owner (or a member they've granted permission) can invite people.
                        </div>
                    )}

                    {canInvite && (
                        <Section title="Send invite">
                            <form onSubmit={handleSend} className="flex items-stretch gap-2">
                                <input
                                    type="email"
                                    placeholder="teammate@company.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={sending}
                                    className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-fg-subtle)] disabled:opacity-50"
                                />
                                <button
                                    type="submit"
                                    disabled={sending || !email.trim()}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-black hover:bg-[var(--color-brand)] disabled:opacity-40"
                                >
                                    {sending ? "Sending…" : "Send invite"}
                                </button>
                            </form>
                            {sendError && <p className="mt-2 text-xs text-rose-400">{sendError}</p>}
                        </Section>
                    )}

                    {canInvite && (
                        <Section title={`Pending invitations (${pending.length})`}>
                            {pending.length === 0 ? (
                                <p className="text-xs text-[var(--color-fg-subtle)]">No pending invitations.</p>
                            ) : (
                                <ul className="divide-y divide-[var(--color-line-soft)] rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)]/40">
                                    {pending.map(inv => (
                                        <li key={inv.id} className="flex items-center gap-2 px-3 py-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm text-[var(--color-fg)]">{inv.email}</div>
                                                <div className="text-[10px] text-[var(--color-fg-subtle)]">
                                                    sent {timeAgo(inv.created_at)} · expires {expiresIn(inv.expires_at)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleCopyLink(inv.token)}
                                                className="rounded-md px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                                            >
                                                {copiedToken === inv.token ? "✓ Copied" : "Copy link"}
                                            </button>
                                            <button
                                                onClick={() => handleRevoke(inv.id)}
                                                className="rounded-md px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10"
                                            >
                                                Revoke
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>
                    )}

                    {isOwner && (
                        <Section title="Members & permissions" hint="Toggle who else can send invitations.">
                            <ul className="divide-y divide-[var(--color-line-soft)] rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)]/40">
                                {participants.map(p => {
                                    const profile = profilesById[p.user_id]
                                    const name = profile?.first_name || "User"
                                    const isMe = p.user_id === user?.id
                                    return (
                                        <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[10px] font-semibold text-[var(--color-fg)]">
                                                {(name[0] || "U").toUpperCase()}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm text-[var(--color-fg)]">
                                                    {name}{isMe && <span className="text-[var(--color-fg-subtle)]"> (you)</span>}
                                                </div>
                                                <div className="text-[10px] capitalize text-[var(--color-fg-subtle)]">{p.role}</div>
                                            </div>
                                            {p.role === "owner" ? (
                                                <span className="text-[10px] text-[var(--color-fg-subtle)]">Always invites</span>
                                            ) : (
                                                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(p.can_invite)}
                                                        onChange={(e) => handleToggleCanInvite(p, e.target.checked)}
                                                        className="h-3.5 w-3.5 accent-white"
                                                    />
                                                    Can invite
                                                </label>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </Section>
                    )}
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

function Section({ title, hint, children }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">{title}</span>
                {hint && <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

function timeAgo(iso) {
    if (!iso) return ""
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seconds < 60) return "just now"
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}

function expiresIn(iso) {
    if (!iso) return "soon"
    const seconds = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
    if (seconds <= 0) return "expired"
    const days = Math.floor(seconds / 86400)
    if (days >= 1) return `in ${days}d`
    const hours = Math.floor(seconds / 3600)
    if (hours >= 1) return `in ${hours}h`
    const minutes = Math.floor(seconds / 60)
    return `in ${minutes}m`
}

function CloseIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

export default InviteUser
