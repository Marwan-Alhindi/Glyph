import { useState, useEffect, useRef, useMemo } from "react"
import Message from "./Message"
import AIMessage from "./AIMessage"
import InviteLLM from "./InviteLLM"
import LLMContext from "./LLMContext"
import InviteUser from "./InviteUser"
import { supabase, API_BASE } from "../../services/supabase"
import { useAuth } from "../../contexts/AuthContext"
import { getLLMColor, getLLMInitials, modelTypeLabel } from "../utils/llmColors"

function Chat({ chatId }) {
    const [chatName, setChatName] = useState("Chat")
    const [messages, setMessages] = useState([])
    const [invitedLLMs, setInvitedLLMs] = useState([])
    const [inputText, setInputText] = useState("")
    const [InviteLLMpop, setInviteLLMpop] = useState(false)
    const [showMentionDropdown, setShowMentionDropdown] = useState(false)
    const [mentionFilter, setMentionFilter] = useState("")
    const [contextLLM, setContextLLM] = useState(null)
    const [showInviteUser, setShowInviteUser] = useState(false)
    const [profilesById, setProfilesById] = useState({})
    const [loading, setLoading] = useState(true)
    const [pendingLLMs, setPendingLLMs] = useState({}) // { llmId: true }
    const [mobileTab, setMobileTab] = useState("team") // "team" | "models"

    const { user, session } = useAuth()
    const teamScrollRef = useRef(null)
    const modelsScrollRef = useRef(null)
    const inputRef = useRef(null)

    // Load chat metadata + messages + LLMs + profiles
    useEffect(() => {
        if (!chatId) return
        setLoading(true)

        async function loadData() {
            const { data: chatRow } = await supabase
                .from("chats")
                .select("name")
                .eq("id", chatId)
                .single()
            if (chatRow) setChatName(chatRow.name || "Chat")

            const { data: msgs } = await supabase
                .from("messages")
                .select("*, invited_llms(id, display_name, display_number, model_type)")
                .eq("chat_id", chatId)
                .order("created_at", { ascending: true })
            if (msgs) setMessages(msgs)

            const { data: llms } = await supabase
                .from("invited_llms")
                .select("*, llm_connections!llm_id(*)")
                .eq("chat_id", chatId)
                .order("created_at", { ascending: true })
            if (llms) setInvitedLLMs(llms)

            const { data: participants } = await supabase
                .from("chat_participants")
                .select("user_id")
                .eq("chat_id", chatId)
            if (participants?.length) {
                const { data: profiles } = await supabase
                    .from("profiles")
                    .select("id, first_name")
                    .in("id", participants.map(p => p.user_id))
                if (profiles) setProfilesById(Object.fromEntries(profiles.map(p => [p.id, p])))
            }

            setLoading(false)
        }
        loadData()
    }, [chatId])

    // Realtime subscription
    useEffect(() => {
        if (!chatId) return

        // Unique channel name per mount — avoids strict-mode double-mount
        // hitting "cannot add postgres_changes after subscribe()".
        const channelName = `chat-${chatId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const channel = supabase
            .channel(channelName)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
                async (payload) => {
                    const { data: fullMsg } = await supabase
                        .from("messages")
                        .select("*, invited_llms(id, display_name, display_number, model_type)")
                        .eq("id", payload.new.id)
                        .single()

                    if (fullMsg) {
                        setMessages(prev => prev.some(m => m.id === fullMsg.id) ? prev : [...prev, fullMsg])

                        // Clear pending state for this LLM
                        if (fullMsg.sender_type === 'llm' && fullMsg.sender_llm_id) {
                            setPendingLLMs(prev => {
                                const next = { ...prev }
                                delete next[fullMsg.sender_llm_id]
                                return next
                            })
                        }

                        // Lazy load profile
                        if (fullMsg.sender_type === 'user' && fullMsg.sender_user_id) {
                            setProfilesById(prev => {
                                if (prev[fullMsg.sender_user_id]) return prev
                                supabase
                                    .from("profiles")
                                    .select("id, first_name")
                                    .eq("id", fullMsg.sender_user_id)
                                    .single()
                                    .then(({ data }) => {
                                        if (data) setProfilesById(p => ({ ...p, [data.id]: data }))
                                    })
                                return prev
                            })
                        }
                    }
                }
            )
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'invited_llms', filter: `chat_id=eq.${chatId}` },
                async (payload) => {
                    const { data: fullLlm } = await supabase
                        .from("invited_llms")
                        .select("*, llm_connections!llm_id(*)")
                        .eq("id", payload.new.id)
                        .single()
                    if (fullLlm) {
                        setInvitedLLMs(prev => prev.some(l => l.id === fullLlm.id) ? prev : [...prev, fullLlm])
                    }
                }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [chatId])

    // Auto-scroll each pane independently
    useEffect(() => {
        if (teamScrollRef.current) {
            teamScrollRef.current.scrollTo({ top: teamScrollRef.current.scrollHeight, behavior: 'smooth' })
        }
        if (modelsScrollRef.current) {
            modelsScrollRef.current.scrollTo({ top: modelsScrollRef.current.scrollHeight, behavior: 'smooth' })
        }
    }, [messages])

    async function handleInviteLLM(name, modelType, instructions, connections) {
        const maxNum = invitedLLMs.reduce((max, l) => Math.max(max, l.display_number || 0), 0)
        const displayNumber = maxNum + 1

        const { data: newLlm, error: llmError } = await supabase
            .from("invited_llms")
            .insert({
                chat_id: chatId,
                display_name: name,
                model_type: modelType,
                model_instruct: instructions,
                display_number: displayNumber,
                invited_by: user.id
            })
            .select()
            .single()

        if (llmError) {
            console.error("Error inviting LLM:", llmError)
            alert("Failed to invite LLM: " + llmError.message)
            return
        }

        const connRows = connections.map(c => c === "user"
            ? { llm_id: newLlm.id, target_type: "user", target_llm_id: null }
            : { llm_id: newLlm.id, target_type: "llm", target_llm_id: c }
        )

        if (connRows.length > 0) {
            const { error: connError } = await supabase.from("llm_connections").insert(connRows)
            if (connError) {
                console.error("Connection insert error:", connError)
                alert("Failed to create connections: " + connError.message)
            }
        }

        const fullLlm = { ...newLlm, llm_connections: connRows.map((c, i) => ({ id: `temp-${i}`, ...c })) }
        setInvitedLLMs(prev => prev.some(l => l.id === fullLlm.id) ? prev : [...prev, fullLlm])
        setInviteLLMpop(false)

        try {
            const res = await fetch(`${API_BASE}/inviteLLM`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
                body: JSON.stringify({ chat_id: chatId, llm_id: newLlm.id })
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error("Backend invite error:", err)
                alert("Backend error: " + (err.detail || res.statusText))
            }
        } catch (err) {
            console.error("Invite fetch error:", err)
            alert(`Could not reach backend at ${API_BASE}: ${err.message}`)
        }
    }

    function handleInputChange(e) {
        const value = e.target.value
        setInputText(value)
        const lastAtIndex = value.lastIndexOf('@')
        if (lastAtIndex !== -1) {
            const afterAt = value.slice(lastAtIndex + 1)
            if (!afterAt.includes(' ')) {
                setMentionFilter(afterAt)
                setShowMentionDropdown(true)
            } else {
                setShowMentionDropdown(false)
            }
        } else {
            setShowMentionDropdown(false)
        }
    }

    function handleSelectMention(llm) {
        const lastAtIndex = inputText.lastIndexOf('@')
        const newText = inputText.slice(0, lastAtIndex) + `@${llm.display_name} `
        setInputText(newText)
        setShowMentionDropdown(false)
        inputRef.current?.focus()
    }

    function clearMentionFragment() {
        const lastAtIndex = inputText.lastIndexOf('@')
        if (lastAtIndex !== -1) setInputText(inputText.slice(0, lastAtIndex))
        setShowMentionDropdown(false)
    }

    async function handleSendMessage() {
        if (!inputText.trim()) return
        const text = inputText
        setInputText("")
        setShowMentionDropdown(false)

        const { data: newMsg, error: msgError } = await supabase
            .from("messages")
            .insert({
                chat_id: chatId,
                sender_type: "user",
                sender_user_id: user.id,
                content: text
            })
            .select("*, invited_llms(id, display_name, display_number, model_type)")
            .single()

        if (msgError) {
            console.error("Message insert error:", msgError)
            alert("Failed to send message: " + msgError.message)
            setInputText(text)
            return
        }

        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])

        const mentionRegex = /@(\S+)/g
        const mentions = []
        let match
        while ((match = mentionRegex.exec(text)) !== null) mentions.push(match[1])

        let targetLLMs = []
        if (mentions.length > 0) {
            const firstMentioned = invitedLLMs.find(llm => llm.display_name === mentions[0])
            if (firstMentioned) targetLLMs = [firstMentioned]
        }

        for (const llm of targetLLMs) {
            setPendingLLMs(prev => ({ ...prev, [llm.id]: true }))
            try {
                const res = await fetch(`${API_BASE}/askLLM`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
                    body: JSON.stringify({ chat_id: chatId, llm_id: llm.id })
                })
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    console.error("Backend ask error:", err)
                    alert("LLM error: " + (err.detail || res.statusText))
                    setPendingLLMs(prev => { const n = { ...prev }; delete n[llm.id]; return n })
                }
                // On mobile, surface the response side
                setMobileTab("models")
            } catch (err) {
                console.error("Ask fetch error:", err)
                alert(`Could not reach backend at ${API_BASE}: ${err.message}`)
                setPendingLLMs(prev => { const n = { ...prev }; delete n[llm.id]; return n })
            }
        }
    }

    function openContext(llmId) {
        const llm = invitedLLMs.find(l => l.id === llmId)
        if (llm) setContextLLM(llm)
    }

    const filteredLLMs = invitedLLMs.filter(llm =>
        llm.display_name.toLowerCase().startsWith(mentionFilter.toLowerCase())
    )

    // Split messages into team (user + system) and models (llm)
    const { teamMessages, modelMessages } = useMemo(() => {
        const team = []
        const model = []
        for (const msg of messages) {
            if (msg.sender_type === 'llm') model.push(msg)
            else team.push(msg)
        }
        return { teamMessages: team, modelMessages: model }
    }, [messages])

    const userCount = useMemo(() => Object.keys(profilesById).length || 1, [profilesById])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-[var(--color-canvas)]">
                <div className="flex items-center gap-3 text-sm text-[var(--color-fg-muted)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" style={{ animationDelay: '0.16s' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" style={{ animationDelay: '0.32s' }} />
                    <span className="ml-2">Loading conversation…</span>
                </div>
            </div>
        )
    }

    /* ---------- Mention dropdown (rendered above input) ---------- */
    const mentionDropdown = showMentionDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
            {filteredLLMs.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--color-fg-subtle)]">No matches — invite a model below</div>
            )}
            {filteredLLMs.map(llm => {
                const c = getLLMColor(llm.display_number)
                return (
                    <button
                        key={llm.id}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-3)]"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectMention(llm)}
                    >
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${c.avatarBg} text-[10px] font-semibold ${c.avatarText}`}>
                            {getLLMInitials(llm.display_name)}
                        </span>
                        <span className="text-[var(--color-fg)]">@{llm.display_name}</span>
                        <span className="text-xs text-[var(--color-fg-subtle)]">· {modelTypeLabel(llm.model_type)}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">#{llm.display_number}</span>
                    </button>
                )
            })}
            <div className="border-t border-[var(--color-line-soft)]">
                <button
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { clearMentionFragment(); setInviteLLMpop(true) }}
                >
                    <span className="text-base leading-none">+</span> Invite a new model
                </button>
                <button
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { clearMentionFragment(); setShowInviteUser(true) }}
                >
                    <span className="text-base leading-none">+</span> Invite a teammate
                </button>
            </div>
        </div>
    )

    /* ---------- Input ---------- */
    const inputBar = (
        <div className="border-t border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-4 py-3">
            <div className="relative">
                {mentionDropdown}
                <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 transition-colors focus-within:border-[var(--color-fg-subtle)]">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        placeholder="Message your team — type @ to mention a model"
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSendMessage()
                            }
                        }}
                        className="block max-h-40 w-full resize-none bg-transparent py-1.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none"
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputText.trim()}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-black transition-all hover:bg-[var(--color-brand)] disabled:opacity-40"
                        aria-label="Send"
                    >
                        <SendIcon />
                    </button>
                </div>
            </div>
        </div>
    )

    /* ---------- Top bar ---------- */
    const topBar = (
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--color-fg)]">{chatName}</div>
                    <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                        <span>{userCount} {userCount === 1 ? 'person' : 'people'}</span>
                        <span>·</span>
                        <span>{invitedLLMs.length} {invitedLLMs.length === 1 ? 'model' : 'models'}</span>
                    </div>
                </div>
                {invitedLLMs.length > 0 && (
                    <div className="ml-3 hidden items-center -space-x-1.5 md:flex">
                        {invitedLLMs.slice(0, 5).map(llm => {
                            const c = getLLMColor(llm.display_number)
                            return (
                                <button
                                    key={llm.id}
                                    onClick={() => openContext(llm.id)}
                                    title={`${llm.display_name} · ${modelTypeLabel(llm.model_type)}`}
                                    className={`flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-[var(--color-surface-1)] ${c.avatarBg} ${c.avatarText} text-[10px] font-semibold hover:z-10 hover:scale-110 transition-transform`}
                                >
                                    {getLLMInitials(llm.display_name)}
                                </button>
                            )
                        })}
                        {invitedLLMs.length > 5 && (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-[var(--color-surface-1)] bg-[var(--color-surface-3)] text-[10px] text-[var(--color-fg-muted)]">
                                +{invitedLLMs.length - 5}
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-1">
                <IconBtn label="Invite model" onClick={() => setInviteLLMpop(true)}><BotIcon /></IconBtn>
                <IconBtn label="Invite teammate" onClick={() => setShowInviteUser(true)}><UserPlusIcon /></IconBtn>
            </div>
        </div>
    )

    /* ---------- Team pane (left) ---------- */
    const teamPane = (
        <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    Team chat
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                    {teamMessages.filter(m => m.sender_type === 'user').length} messages
                </span>
            </div>
            <div ref={teamScrollRef} className="lp-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {teamMessages.length === 0 ? (
                    <EmptyTeam />
                ) : (
                    teamMessages.map(msg => {
                        if (msg.kind === 'leave') {
                            return (
                                <div key={msg.id} className="flex items-center justify-center py-2">
                                    <span className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-3 py-1 text-[11px] text-[var(--color-fg-subtle)]">
                                        {msg.content}
                                    </span>
                                </div>
                            )
                        }
                        const isMe = msg.sender_user_id === user?.id
                        const profile = profilesById[msg.sender_user_id]
                        const displayName = isMe ? 'You' : (profile?.first_name || 'User')
                        const avatarLetter = (displayName[0] || 'U').toUpperCase()
                        return (
                            <div key={msg.id} className={`flex items-start gap-3 lp-fade-in ${isMe ? 'flex-row-reverse' : ''}`}>
                                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}>
                                    {avatarLetter}
                                </div>
                                <div className={`min-w-0 max-w-[88%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                                    <span className={`mb-1 text-[11px] text-[var(--color-fg-subtle)] ${isMe ? 'text-right' : ''}`}>{displayName}</span>
                                    <Message text={msg.content} isMe={isMe} invitedLLMs={invitedLLMs} />
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
            {inputBar}
        </section>
    )

    /* ---------- Models pane (right) ---------- */
    const modelsPane = (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    Workspace
                </span>
                <button
                    onClick={() => setInviteLLMpop(true)}
                    className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                >
                    + Invite model
                </button>
            </div>

            <div ref={modelsScrollRef} className="lp-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {modelMessages.length === 0 && Object.keys(pendingLLMs).length === 0 ? (
                    <EmptyModels onInvite={() => setInviteLLMpop(true)} hasModels={invitedLLMs.length > 0} />
                ) : (
                    <>
                        {modelMessages.map(msg => {
                            const llmInfo = msg.invited_llms
                            const c = getLLMColor(llmInfo?.display_number)
                            const isJoinMessage = msg.kind === 'join'

                            if (isJoinMessage) {
                                return (
                                    <div key={msg.id} className="flex items-center justify-center py-1 lp-fade-in">
                                        <span className={`rounded-full border ${c.softBorder} ${c.softBg} px-3 py-1 text-[11px] ${c.text}`}>
                                            {llmInfo?.display_name} joined the workspace
                                        </span>
                                    </div>
                                )
                            }

                            return (
                                <article
                                    key={msg.id}
                                    className={`overflow-hidden rounded-2xl border ${c.softBorder} bg-[var(--color-surface-2)] lp-fade-in`}
                                >
                                    <header className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2.5">
                                        <button
                                            onClick={() => openContext(msg.sender_llm_id)}
                                            className="flex items-center gap-2.5"
                                        >
                                            <span className={`flex h-7 w-7 items-center justify-center rounded-full ${c.avatarBg} text-[10px] font-semibold ${c.avatarText}`}>
                                                {getLLMInitials(llmInfo?.display_name)}
                                            </span>
                                            <span className="flex flex-col items-start leading-tight">
                                                <span className={`text-sm font-medium ${c.text}`}>
                                                    {llmInfo?.display_name || 'LLM'}
                                                </span>
                                                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                                                    {modelTypeLabel(llmInfo?.model_type)} · #{llmInfo?.display_number}
                                                </span>
                                            </span>
                                        </button>
                                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </header>
                                    <div className="px-4 py-3">
                                        <AIMessage text={msg.content} />
                                    </div>
                                </article>
                            )
                        })}

                        {/* Pending "thinking" placeholders */}
                        {Object.keys(pendingLLMs).map(llmId => {
                            const llm = invitedLLMs.find(l => l.id === llmId)
                            if (!llm) return null
                            const c = getLLMColor(llm.display_number)
                            return (
                                <div
                                    key={`pending-${llmId}`}
                                    className={`overflow-hidden rounded-2xl border ${c.softBorder} bg-[var(--color-surface-2)] lp-fade-in`}
                                >
                                    <header className="flex items-center gap-2.5 border-b border-[var(--color-line-soft)] px-4 py-2.5">
                                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${c.avatarBg} text-[10px] font-semibold ${c.avatarText}`}>
                                            {getLLMInitials(llm.display_name)}
                                        </span>
                                        <span className={`text-sm font-medium ${c.text}`}>{llm.display_name}</span>
                                        <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">thinking…</span>
                                    </header>
                                    <div className="flex items-center gap-1.5 px-4 py-4">
                                        <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} />
                                        <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} style={{ animationDelay: '0.16s' }} />
                                        <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} style={{ animationDelay: '0.32s' }} />
                                    </div>
                                </div>
                            )
                        })}
                    </>
                )}
            </div>
        </section>
    )

    return (
        <div className="relative flex h-full w-full flex-col bg-[var(--color-canvas)]">
            {/* Modals */}
            {InviteLLMpop && (
                <InviteLLM
                    onClose={() => setInviteLLMpop(false)}
                    onInvite={handleInviteLLM}
                    invitedLLMs={invitedLLMs}
                />
            )}
            {showInviteUser && (
                <InviteUser
                    chatId={chatId}
                    onClose={() => setShowInviteUser(false)}
                />
            )}
            {contextLLM && (
                <LLMContext
                    llm={contextLLM}
                    messages={messages}
                    invitedLLMs={invitedLLMs}
                    onClose={() => setContextLLM(null)}
                />
            )}

            {topBar}

            {/* Mobile tab toggle */}
            <div className="flex border-b border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:hidden">
                <TabBtn active={mobileTab === 'team'} onClick={() => setMobileTab('team')}>
                    Team chat
                </TabBtn>
                <TabBtn active={mobileTab === 'models'} onClick={() => setMobileTab('models')}>
                    Workspace
                    {Object.keys(pendingLLMs).length > 0 && (
                        <span className="ml-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 lp-dot" />
                    )}
                </TabBtn>
            </div>

            {/* Two-pane layout */}
            <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:flex-row">
                <div className={`flex min-h-0 flex-1 ${mobileTab === 'team' ? 'flex' : 'hidden'} md:flex`}>
                    {teamPane}
                </div>
                <div className={`flex min-h-0 flex-1 ${mobileTab === 'models' ? 'flex' : 'hidden'} md:flex`}>
                    {modelsPane}
                </div>
            </div>
        </div>
    )
}

/* ---------------- Sub-components ---------------- */

function IconBtn({ children, label, onClick }) {
    return (
        <button
            onClick={onClick}
            title={label}
            aria-label={label}
            className="rounded-lg p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
        >
            {children}
        </button>
    )
}

function TabBtn({ children, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
                active
                    ? 'border-b-2 border-[var(--color-fg)] text-[var(--color-fg)]'
                    : 'border-b-2 border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
            }`}
        >
            {children}
        </button>
    )
}

function EmptyTeam() {
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] text-[var(--color-fg-muted)]">
                <ChatIcon />
            </div>
            <p className="text-sm font-medium text-[var(--color-fg)]">Start the conversation</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--color-fg-muted)]">
                Type a message to your team. Use <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px]">@</span> to ask a model.
            </p>
        </div>
    )
}

function EmptyModels({ onInvite, hasModels }) {
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
                <BotIcon />
            </div>
            <p className="text-sm font-medium text-[var(--color-fg)]">
                {hasModels ? 'Mention a model in chat' : 'No models yet'}
            </p>
            <p className="mt-1 max-w-xs text-xs text-[var(--color-fg-muted)]">
                {hasModels
                    ? 'Type @ followed by a model name to send it the prompt. Replies appear here.'
                    : 'Invite a model to your workspace to get started.'}
            </p>
            {!hasModels && (
                <button
                    onClick={onInvite}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-[var(--color-brand)]"
                >
                    Invite a model →
                </button>
            )}
        </div>
    )
}

/* ---------------- Icons ---------------- */
function SendIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    )
}
function BotIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" />
            <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
    )
}
function UserPlusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
    )
}
function ChatIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    )
}

export default Chat
