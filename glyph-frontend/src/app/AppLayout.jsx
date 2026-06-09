import { useState, useEffect, useRef } from "react"
import { Outlet, useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "../contexts/AuthContext"
import { useLanguage } from "../contexts/LanguageContext"
import { supabase, apiFetch } from "../services/supabase"
import { useUsage } from "./hooks/useUsage"

function AppLayout() {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [chats, setChats] = useState([])
    const [landingInput, setLandingInput] = useState("")
    const [userMenuOpen, setUserMenuOpen] = useState(false)
    const [billingOpen, setBillingOpen] = useState(false)
    const [paymentNotice, setPaymentNotice] = useState(null)
    const [leaveChatTarget, setLeaveChatTarget] = useState(null)
    const [leavePending, setLeavePending] = useState(false)
    const [renamingChatId, setRenamingChatId] = useState(null)
    const [renameDraft, setRenameDraft] = useState("")
    const userMenuRef = useRef(null)
    const skipNextRenameBlur = useRef(false)

    const { user, logout } = useAuth()
    const { t, lang, setLang } = useLanguage()
    const usage = useUsage(user)
    const ta = t.app
    const navigate = useNavigate()
    const location = useLocation()

    const firstName = user?.user_metadata?.first_name || 'User'
    const lastName = user?.user_metadata?.last_name || ''
    const avatarLetter = firstName[0]?.toUpperCase() || 'U'

    useEffect(() => { fetchChats() }, [user])

    useEffect(() => {
        if (!user?.id) return
        let cancelled = false
        apiFetch('/invitations/claim_pending', { method: 'POST' })
            .then(({ joined_chat_ids } = {}) => {
                if (cancelled || !joined_chat_ids?.length) return
                fetchChats()
                if (location.pathname === '/app' || location.pathname === '/app/') {
                    navigate(`/app/chat/${joined_chat_ids[0]}`)
                }
            })
            .catch(() => { /* best-effort */ })
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id])

    useEffect(() => {
        function onClick(e) {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
                setUserMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [])

    // Confirm a pending Noon payment regardless of which /app page Noon's
    // checkout redirected us back to. handleUpgrade stashes the order reference
    // before redirecting; on the next load we verify it, show a result notice,
    // and clear it so it only runs once.
    useEffect(() => {
        if (!user?.id) return
        const ref = localStorage.getItem('glyph_pending_payment')
        if (!ref) return
        localStorage.removeItem('glyph_pending_payment')
        apiFetch(`/payments/verify/${encodeURIComponent(ref)}`)
            .then(({ status, plan }) => setPaymentNotice({ status, plan }))
            .catch(() => setPaymentNotice({ status: 'error' }))
    }, [user?.id])

    function sortChats(list) {
        return [...list].sort((a, b) => {
            if (a.pinned_at && !b.pinned_at) return -1
            if (!a.pinned_at && b.pinned_at) return 1
            if (a.pinned_at && b.pinned_at) {
                return new Date(b.pinned_at) - new Date(a.pinned_at)
            }
            const aTime = a.joined_at || a.created_at || 0
            const bTime = b.joined_at || b.created_at || 0
            return new Date(bTime) - new Date(aTime)
        })
    }

    async function fetchChats() {
        if (!user) return
        const { data } = await supabase
            .from("chat_participants")
            .select("chat_id, role, pinned_at, joined_at, chats(id, name, created_at)")
            .eq("user_id", user.id)
            .order("pinned_at", { ascending: false, nullsFirst: false })
            .order("joined_at", { ascending: false })
        if (data) {
            setChats(data.map(p => ({
                ...p.chats,
                role: p.role,
                pinned_at: p.pinned_at,
                joined_at: p.joined_at,
            })))
        }
    }

    async function handleCreateChat() {
        try {
            const { chat, participant } = await apiFetch('/chats', {
                method: 'POST',
                body: { name: 'New chat' },
            })
            setChats(prev => sortChats([{
                ...chat,
                role: participant?.role || 'owner',
                pinned_at: participant?.pinned_at || null,
                joined_at: participant?.joined_at || new Date().toISOString(),
            }, ...prev]))
            navigate(`/app/chat/${chat.id}`)
        } catch (err) {
            console.error('Create chat error:', err)
            alert('Failed to create chat: ' + (err.detail || err.message))
        }
    }

    async function handleStartChatWithMessage(text) {
        if (!text.trim()) return

        try {
            const { chat, participant } = await apiFetch('/chats', {
                method: 'POST',
                body: { name: text.trim().slice(0, 40) },
            })

            try {
                await apiFetch('/messages', {
                    method: 'POST',
                    body: { chat_id: chat.id, content: text.trim() },
                })
            } catch (msgErr) {
                console.error('Message insert error:', msgErr)
            }

            setChats(prev => sortChats([{
                ...chat,
                role: participant?.role || 'owner',
                pinned_at: participant?.pinned_at || null,
                joined_at: participant?.joined_at || new Date().toISOString(),
            }, ...prev]))
            setLandingInput('')
            navigate(`/app/chat/${chat.id}`)
        } catch (err) {
            console.error('Create chat error:', err)
            alert('Failed to create chat: ' + (err.detail || err.message))
        }
    }

    async function handleLogout() {
        await logout()
        navigate('/login')
    }

    function handleLeaveChat(chat, e) {
        e?.stopPropagation()
        setLeaveChatTarget(chat)
    }

    async function handleTogglePin(chat, e) {
        e?.stopPropagation()
        const wantPinned = !chat.pinned_at
        const optimisticPinnedAt = wantPinned ? new Date().toISOString() : null
        const prev = chat.pinned_at
        setChats(list => sortChats(list.map(c => c.id === chat.id ? { ...c, pinned_at: optimisticPinnedAt } : c)))
        try {
            const { pinned_at } = await apiFetch(`/chats/${chat.id}/pin`, {
                method: 'PATCH',
                body: { pinned: wantPinned },
            })
            setChats(list => sortChats(list.map(c => c.id === chat.id ? { ...c, pinned_at } : c)))
        } catch (err) {
            setChats(list => sortChats(list.map(c => c.id === chat.id ? { ...c, pinned_at: prev } : c)))
            alert('Failed to update pin: ' + (err.detail || err.message))
        }
    }

    function handleRenameStart(chat, e) {
        e?.stopPropagation()
        setRenameDraft(chat.name || "")
        setRenamingChatId(chat.id)
    }

    async function handleRenameCommit(chat) {
        const newName = renameDraft.trim()
        setRenamingChatId(null)
        if (!newName || newName === chat.name) return

        try {
            await apiFetch(`/chats/${chat.id}`, {
                method: 'PATCH',
                body: { name: newName },
            })
            setChats(prev => prev.map(c => c.id === chat.id ? { ...c, name: newName } : c))
        } catch (err) {
            alert('Failed to rename chat: ' + (err.detail || err.message))
        }
    }

    function handleRenameCancel() {
        skipNextRenameBlur.current = true
        setRenamingChatId(null)
    }

    async function confirmLeaveChat() {
        const chat = leaveChatTarget
        if (!chat) return
        setLeavePending(true)

        try {
            await apiFetch(`/chats/${chat.id}/leave`, { method: 'POST' })
        } catch (err) {
            console.error('Leave chat error:', err)
            alert('Failed to leave chat: ' + (err.detail || err.message))
            setLeavePending(false)
            return
        }

        setChats(prev => prev.filter(c => c.id !== chat.id))

        if (location.pathname === `/app/chat/${chat.id}`) {
            navigate('/app')
        }

        setLeaveChatTarget(null)
        setLeavePending(false)
    }

    const isInChat = location.pathname.includes('/app/chat/')

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-[var(--color-canvas)] text-[var(--color-fg)]">
            {/* Billing Modal */}
            {billingOpen && (
                <BillingModal
                    currentPlan={usage?.plan || 'free'}
                    onClose={() => setBillingOpen(false)}
                />
            )}

            {/* Payment result notice (after returning from Noon checkout) */}
            {paymentNotice && (
                <PaymentNoticeModal
                    notice={paymentNotice}
                    onClose={() => {
                        const wasPaid = paymentNotice.status === 'paid'
                        setPaymentNotice(null)
                        // Reload so the plan badge / limits reflect the upgrade immediately.
                        if (wasPaid) window.location.reload()
                    }}
                />
            )}

            {/* Leave Chat Modal */}
            {leaveChatTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-sm mx-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6 shadow-2xl">
                        <div className="mb-3 flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
                                <LeaveIcon />
                            </span>
                            <div className="min-w-0">
                                <p className="text-base font-semibold text-[var(--color-fg)]">{ta.leaveChat.title}</p>
                                <p className="truncate text-xs text-[var(--color-fg-muted)]">"{leaveChatTarget.name}"</p>
                            </div>
                        </div>
                        <p className="mb-5 text-sm text-[var(--color-fg-muted)]">
                            {ta.leaveChat.desc}
                        </p>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={() => !leavePending && setLeaveChatTarget(null)}
                                disabled={leavePending}
                                className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-40"
                            >
                                {ta.leaveChat.cancel}
                            </button>
                            <button
                                onClick={confirmLeaveChat}
                                disabled={leavePending}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:opacity-40"
                            >
                                {leavePending ? ta.leaveChat.leaving : ta.leaveChat.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Desktop layout */}
            <div className="hidden h-full md:flex">
                {/* Sidebar */}
                <aside
                    className={`flex h-full shrink-0 flex-col border-e border-[var(--color-line-soft)] bg-[var(--color-surface-1)] transition-[width] duration-200 ${
                        sidebarCollapsed ? 'w-14' : 'w-64'
                    }`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-3.5 border-b border-[var(--color-line-soft)]">
                        {!sidebarCollapsed && (
                            <button onClick={() => navigate('/app')} className="flex items-center gap-2 px-1">
                                <img src="/logo-white.png" width={22} height={22} alt="" />
                                <span className="text-sm font-semibold tracking-tight">Glyph</span>
                            </button>
                        )}
                        <button
                            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                        >
                            <SidebarIcon collapsed={lang === 'ar' ? !sidebarCollapsed : sidebarCollapsed} />
                        </button>
                    </div>

                    {/* Top actions */}
                    <div className="space-y-1.5 px-3 pt-3">
                        <button
                            onClick={handleCreateChat}
                            className={`flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-3)] ${
                                sidebarCollapsed ? 'justify-center' : ''
                            }`}
                            title={ta.newChat}
                        >
                            <PlusIcon />
                            {!sidebarCollapsed && <span>{ta.newChat}</span>}
                        </button>
                    </div>

                    {/* Conversations */}
                    {!sidebarCollapsed && (() => {
                        const pinnedChats = chats.filter(c => c.pinned_at)
                        const unpinnedChats = chats.filter(c => !c.pinned_at)

                        const renderRow = (chat) => {
                            const isActive = location.pathname === `/app/chat/${chat.id}`
                            const isEditing = renamingChatId === chat.id
                            return (
                                <div
                                    key={chat.id}
                                    onClick={isEditing ? undefined : () => navigate(`/app/chat/${chat.id}`)}
                                    className={`group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                                        isEditing ? '' : 'cursor-pointer'
                                    } ${
                                        isActive
                                            ? 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
                                            : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]'
                                    }`}
                                >
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-[var(--color-line)] group-hover:bg-[var(--color-fg-subtle)]'}`} />
                                    {isEditing ? (
                                        <input
                                            autoFocus
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault()
                                                    handleRenameCommit(chat)
                                                } else if (e.key === 'Escape') {
                                                    e.preventDefault()
                                                    handleRenameCancel()
                                                }
                                            }}
                                            onBlur={() => {
                                                if (skipNextRenameBlur.current) {
                                                    skipNextRenameBlur.current = false
                                                    return
                                                }
                                                handleRenameCommit(chat)
                                            }}
                                            className="min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-fg-subtle)]"
                                        />
                                    ) : (
                                        <>
                                            <span className="flex-1 truncate">{chat.name || ta.untitled}</span>
                                            <button
                                                onClick={(e) => handleTogglePin(chat, e)}
                                                className={`rounded p-0.5 hover:bg-[var(--color-surface-3)] ${
                                                    chat.pinned_at
                                                        ? 'text-amber-400 opacity-100'
                                                        : 'text-[var(--color-fg-subtle)] opacity-0 hover:text-[var(--color-fg)] group-hover:opacity-100'
                                                }`}
                                                title={chat.pinned_at ? ta.unpinChat : ta.pinChat}
                                            >
                                                <PinIcon size={12} filled={!!chat.pinned_at} />
                                            </button>
                                            <button
                                                onClick={(e) => handleRenameStart(chat, e)}
                                                className="rounded p-0.5 text-[var(--color-fg-subtle)] opacity-0 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)] group-hover:opacity-100"
                                                title={ta.renameChat}
                                            >
                                                <PencilIcon size={12} />
                                            </button>
                                            <button
                                                onClick={(e) => handleLeaveChat(chat, e)}
                                                className="rounded p-0.5 text-[var(--color-fg-subtle)] opacity-0 hover:bg-[var(--color-surface-3)] hover:text-rose-400 group-hover:opacity-100"
                                                title={ta.leaveChatBtn}
                                            >
                                                <CloseIcon size={12} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            )
                        }

                        return (
                            <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
                                <div className="lp-scroll min-h-0 flex-1 overflow-y-auto pe-1">
                                    {pinnedChats.length > 0 && (
                                        <div className="mb-3">
                                            <div className="mb-2 flex items-center justify-between px-1">
                                                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                                                    {ta.pinned}
                                                </span>
                                                <span className="text-[10px] text-[var(--color-fg-subtle)]">{pinnedChats.length}</span>
                                            </div>
                                            <div className="space-y-0.5">
                                                {pinnedChats.map(renderRow)}
                                            </div>
                                        </div>
                                    )}

                                    <div className="mb-2 flex items-center justify-between px-1">
                                        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                                            {ta.conversations}
                                        </span>
                                        <span className="text-[10px] text-[var(--color-fg-subtle)]">{unpinnedChats.length}</span>
                                    </div>
                                    <div className="space-y-0.5">
                                        {chats.length === 0 && (
                                            <p className="px-2 py-3 text-xs text-[var(--color-fg-subtle)]">
                                                {ta.noChats}
                                            </p>
                                        )}
                                        {unpinnedChats.map(renderRow)}
                                    </div>
                                </div>
                            </div>
                        )
                    })()}

                    {/* User + lang toggle */}
                    <div className="relative mt-auto border-t border-[var(--color-line-soft)] p-2" ref={userMenuRef}>
                        {/* Usage bar */}
                        {!sidebarCollapsed && usage && (
                            <div className="mb-2 px-1">
                                <div className="mb-1 flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)] capitalize">
                                        {usage.plan}
                                    </span>
                                    <span className="text-[10px] text-[var(--color-fg-subtle)]">
                                        {formatTokens(usage.tokens_used)} / {formatTokens(usage.tokens_limit)}
                                    </span>
                                </div>
                                <div className="h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            usage.tokens_used / usage.tokens_limit > 0.9
                                                ? "bg-rose-400"
                                                : usage.tokens_used / usage.tokens_limit > 0.7
                                                ? "bg-amber-400"
                                                : "bg-emerald-400"
                                        }`}
                                        style={{ width: `${Math.min(100, (usage.tokens_used / usage.tokens_limit) * 100)}%` }}
                                    />
                                </div>
                            </div>
                        )}
                        {/* Language toggle row */}
                        {!sidebarCollapsed && (
                            <button
                                onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                                className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                            >
                                <GlobeIcon />
                                <span>{lang === 'en' ? 'العربية' : 'English'}</span>
                            </button>
                        )}
                        {sidebarCollapsed && (
                            <button
                                onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                                className="mb-1 flex w-full items-center justify-center rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                                title={lang === 'en' ? 'العربية' : 'English'}
                            >
                                <GlobeIcon />
                            </button>
                        )}

                        <button
                            onClick={() => setUserMenuOpen(!userMenuOpen)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-surface-2)] ${
                                sidebarCollapsed ? 'justify-center' : ''
                            }`}
                        >
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-400 text-xs font-semibold text-black">
                                {avatarLetter}
                            </div>
                            {!sidebarCollapsed && (
                                <>
                                    <div className="flex-1 truncate text-start">
                                        <div className="truncate text-sm font-medium">{firstName} {lastName}</div>
                                        <div className="truncate text-[10px] text-[var(--color-fg-subtle)]">{user?.email}</div>
                                    </div>
                                    <ChevronUpIcon />
                                </>
                            )}
                        </button>

                        {userMenuOpen && (
                            <div className="absolute bottom-full start-2 end-2 mb-2 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
                                <button
                                    onClick={() => { setUserMenuOpen(false); setBillingOpen(true) }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                >
                                    <BillingIcon /> {ta.planBilling}
                                </button>
                                <div className="h-px bg-[var(--color-line)]" />
                                <button
                                    onClick={handleLogout}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                >
                                    <LogoutIcon /> {ta.logout}
                                </button>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Main */}
                <main className="relative flex-1 overflow-hidden">
                    {isInChat ? (
                        <Outlet context={{ sidebarCollapsed }} />
                    ) : (
                        <EmptyLanding
                            firstName={firstName}
                            value={landingInput}
                            setValue={setLandingInput}
                            onSubmit={() => handleStartChatWithMessage(landingInput)}
                            onCreate={handleCreateChat}
                            ta={ta}
                            arrow={t.arrow}
                        />
                    )}
                </main>
            </div>

            {/* Mobile fallback */}
            <div className="flex h-full flex-col md:hidden">
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-3">
                    <button onClick={() => navigate('/app')} className="flex items-center gap-2">
                        <img src="/logo-white.png" width={22} height={22} alt="" />
                        <span className="text-sm font-semibold">Glyph</span>
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                            className="rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-xs text-[var(--color-fg-muted)]"
                        >
                            {ta.langLabel}
                        </button>
                        <button onClick={handleCreateChat} className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs">
                            {ta.newChat}
                        </button>
                    </div>
                </div>

                {isInChat ? (
                    <Outlet context={{ sidebarCollapsed: true }} />
                ) : (
                    <div className="flex-1 overflow-y-auto p-4">
                        <h2 className="text-lg font-semibold tracking-tight">{ta.mobileGreeting(firstName)}</h2>
                        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{ta.mobileSubtitle}</p>
                        <div className="mt-4 space-y-1">
                            {chats.map(chat => (
                                <button
                                    key={chat.id}
                                    onClick={() => navigate(`/app/chat/${chat.id}`)}
                                    className="flex w-full items-center justify-between rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-3 py-2 text-start text-sm"
                                >
                                    <span className="truncate">{chat.name}</span>
                                    <span className="text-xs text-[var(--color-fg-subtle)]">{t.arrow}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function EmptyLanding({ firstName, value, setValue, onSubmit, onCreate, ta, arrow }) {
    return (
        <div className="lp-spotlight relative flex h-full items-center justify-center overflow-y-auto px-6 py-10">
            <div className="w-full max-w-2xl">
                <div className="text-center">
                    <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        {ta.workspace}
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                        {ta.greeting(firstName)}
                    </h1>
                    <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-fg-muted)]">
                        {ta.greetingSubtitle}
                    </p>
                </div>

                {/* Prompt box */}
                <div className="mt-8">
                    <div className="group relative rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-1 shadow-2xl transition-colors focus-within:border-[var(--color-fg-subtle)]">
                        <textarea
                            rows={2}
                            placeholder={ta.inputPlaceholder}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    onSubmit()
                                }
                            }}
                            className="block w-full resize-none bg-transparent px-4 py-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none"
                        />
                        <div className="flex items-center justify-between border-t border-[var(--color-line-soft)] px-2 py-1.5">
                            <div className="flex items-center gap-1 text-xs text-[var(--color-fg-subtle)] px-1">
                                <span>{ta.tip}</span>
                                <span>{ta.tipText}</span>
                            </div>
                            <button
                                onClick={onSubmit}
                                disabled={!value.trim()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-[var(--color-brand)] disabled:opacity-40"
                            >
                                {ta.startChat} <span>{arrow}</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Quick actions */}
                <div className="mt-6">
                    <ActionCard onClick={onCreate} title={ta.newEmptyChat} desc={ta.newEmptyChatDesc} />
                </div>
            </div>
        </div>
    )
}

function ActionCard({ onClick, title, desc }) {
    return (
        <button
            onClick={onClick}
            className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-1)] p-4 text-start transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"
        >
            <div className="text-sm font-medium text-[var(--color-fg)]">{title}</div>
            <div className="mt-1 text-xs text-[var(--color-fg-muted)]">{desc}</div>
        </button>
    )
}

/* Inline icons */
function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}
function CloseIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}
function SidebarIcon({ collapsed }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="3" x2="9" y2="21" />
        </svg>
    )
}
function ChevronUpIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
        </svg>
    )
}
function LogoutIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
    )
}
function PinIcon({ size = 14, filled = false }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
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
function LeaveIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
    )
}
function GlobeIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    )
}

function formatTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return String(n)
}

const PLANS = [
    {
        id: 'free',
        name: 'Free',
        price: '$0',
        period: '/forever',
        tokens: '200K tokens / month',
        features: ['3 chats', '1 teammate'],
    },
    {
        id: 'pro',
        name: 'Pro',
        // SAR is the charged amount — keep in sync with backend payments/plans.py
        // PLAN_PRICES. USD is approximate (SAR pegged at ~3.75/USD), display-only.
        price: 'SAR 49',
        priceUsd: '$13',
        period: '/month',
        tokens: '3M tokens / month',
        features: ['Unlimited chats', '3 teammates'],
    },
    {
        id: 'max',
        name: 'Max',
        price: 'SAR 199',
        priceUsd: '$53',
        period: '/month',
        tokens: '15M tokens / month',
        features: ['Unlimited teammates'],
    },
]

function PaymentNoticeModal({ notice, onClose }) {
    const paid = notice.status === 'paid'
    const title = paid
        ? `You're on ${notice.plan} 🎉`
        : notice.status === 'error'
        ? "We couldn't confirm your payment"
        : 'Payment not completed'
    const body = paid
        ? 'Your subscription is active and your new limits are live.'
        : notice.status === 'error'
        ? 'If you were charged, it will be applied automatically shortly. Otherwise you can try again.'
        : "The payment didn't go through — you weren't charged."

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6 text-center shadow-2xl">
                <div className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full ${paid ? 'bg-emerald-400/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                    {paid ? '✓' : '!'}
                </div>
                <p className="text-base font-semibold text-[var(--color-fg)]">{title}</p>
                <p className="mt-1.5 text-sm text-[var(--color-fg-muted)]">{body}</p>
                <button
                    onClick={onClose}
                    className="mt-5 w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)]"
                >
                    {paid ? 'Continue' : 'Close'}
                </button>
            </div>
        </div>
    )
}

function BillingModal({ currentPlan, onClose }) {
    const [pendingPlan, setPendingPlan] = useState(null)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")

    async function handleUpgrade(planId) {
        if (planId === currentPlan || planId === 'free' || pendingPlan) return
        setError("")
        setPendingPlan(planId)
        try {
            // Start a Noon Hosted Checkout and hand the browser to Noon's page.
            const { reference, checkout_url } = await apiFetch('/payments/checkout', {
                method: 'POST',
                body: { plan: planId },
            })
            // Stash the reference so AppLayout self-verifies on return no matter
            // which /app page Noon redirects us back to.
            localStorage.setItem('glyph_pending_payment', reference)
            window.location.href = checkout_url
        } catch (err) {
            setError(err.detail || err.message || "Could not start checkout.")
            setPendingPlan(null)
        }
    }

    async function handleCancel() {
        if (pendingPlan) return
        const ok = window.confirm(
            "Cancel your subscription? You'll keep your current plan until the end of the billing period, then move to Free."
        )
        if (!ok) return
        setError("")
        setPendingPlan('cancel')
        try {
            const res = await apiFetch('/payments/cancel', { method: 'POST' })
            const until = res.access_until ? new Date(res.access_until).toLocaleDateString() : 'the period end'
            setNotice(`Subscription canceled. You keep ${currentPlan} access until ${until}, then move to Free.`)
        } catch (err) {
            setError(err.detail || err.message || "Could not cancel.")
        } finally {
            setPendingPlan(null)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-6 py-4">
                    <div>
                        <p className="text-base font-semibold text-[var(--color-fg)]">Plan & Billing</p>
                        <p className="text-xs text-[var(--color-fg-muted)] mt-0.5">
                            You're on the <span className="capitalize font-medium text-[var(--color-fg)]">{currentPlan}</span> plan
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    >
                        <CloseIcon size={16} />
                    </button>
                </div>

                {/* Plan cards */}
                <div className="grid grid-cols-3 gap-4 p-6">
                    {PLANS.map(plan => {
                        const isCurrent = plan.id === currentPlan
                        const isDowngrade = PLANS.findIndex(p => p.id === plan.id) < PLANS.findIndex(p => p.id === currentPlan)
                        return (
                            <div
                                key={plan.id}
                                className={`flex flex-col rounded-xl border p-4 ${
                                    isCurrent
                                        ? 'border-emerald-400/50 bg-emerald-400/5'
                                        : 'border-[var(--color-line)] bg-[var(--color-surface-2)]'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-[var(--color-fg)]">{plan.name}</span>
                                    {isCurrent && (
                                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                            Current
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 flex items-baseline gap-1">
                                    <span className="text-2xl font-semibold text-[var(--color-fg)]">{plan.price}</span>
                                    <span className="text-xs text-[var(--color-fg-subtle)]">{plan.period}</span>
                                </div>
                                {plan.priceUsd && (
                                    <p className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                                        ≈ {plan.priceUsd}{plan.period}
                                    </p>
                                )}
                                <p className="mt-2 text-xs font-medium text-emerald-400">{plan.tokens}</p>
                                <ul className="mt-3 flex-1 space-y-1.5">
                                    {plan.features.map((f, i) => (
                                        <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-fg-muted)]">
                                            <span className="mt-0.5 text-emerald-400">✓</span>
                                            <span>{f}</span>
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => isDowngrade ? handleCancel() : handleUpgrade(plan.id)}
                                    disabled={isCurrent || !!pendingPlan}
                                    className={`mt-4 w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                                        isCurrent
                                            ? 'cursor-default bg-[var(--color-surface-3)] text-[var(--color-fg-subtle)]'
                                            : isDowngrade
                                            ? 'border border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]'
                                            : 'bg-white text-black hover:bg-[var(--color-brand)] disabled:opacity-60'
                                    }`}
                                >
                                    {isCurrent
                                        ? 'Current plan'
                                        : isDowngrade
                                        ? (pendingPlan === 'cancel' ? 'Canceling…' : 'Cancel plan')
                                        : pendingPlan === plan.id
                                        ? 'Redirecting…'
                                        : 'Upgrade'}
                                </button>
                            </div>
                        )
                    })}
                </div>

                {error ? (
                    <p className="border-t border-[var(--color-line-soft)] px-6 py-3 text-center text-xs text-red-400">
                        {error}
                    </p>
                ) : notice ? (
                    <p className="border-t border-[var(--color-line-soft)] px-6 py-3 text-center text-xs text-emerald-400">
                        {notice}
                    </p>
                ) : (
                    <p className="border-t border-[var(--color-line-soft)] px-6 py-3 text-center text-xs text-[var(--color-fg-subtle)]">
                        Secure checkout by noon payments. You can cancel anytime.
                    </p>
                )}
            </div>
        </div>
    )
}

function BillingIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
    )
}

export default AppLayout
