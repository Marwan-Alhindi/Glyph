import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { useChatMessages } from "../hooks/useChatMessages"
import { usePlannerNotes } from "../hooks/usePlannerNotes"
import Message from "./chatView/message/Message"
import AIMessage from "./chatView/message/AIMessage"
import InviteLLM from "./chatView/invite/InviteLLM"
import InviteUser from "./chatView/invite/InviteUser"
import LLMContext from "./chatView/context/LLMContext"
import UserContext from "./chatView/context/UserContext"
import Calendar from "./plannerView/Calendar"
import DailyNote from "./plannerView/DailyNote"
import {
    SendIcon, TargetIcon, FeatureIcon, SideAskIcon, MoreIcon, AttachIcon,
    WebIcon, VoiceIcon, ExportIcon, RefreshIcon, BotIcon, UserPlusIcon,
    PeopleIcon, FilterIcon, TrashIcon, FileIcon, CalendarIcon, NoteIcon,
    ChatBubbleIcon, ChatIcon, XIcon, ImageIcon,
} from "./Icons"
import { API_BASE, apiFetch, apiUpload } from "../../services/supabase"
import { useAuth } from "../../contexts/AuthContext"
import { useUsage } from "../hooks/useUsage"
import { getLLMColor, getLLMInitials, getPersonColor } from "../utils/llmColors"
import { findMentions, isMentionPrefix } from "../utils/mentions"

const GROUP_KEYS = {
    chat: ['team', 'models', 'files'],
    planner: ['calendar', 'daily'],
}

function getMentionableColor(target) {
    if (!target) return null
    return target.kind === 'llm'
        ? getLLMColor(target.llm.display_number)
        : getPersonColor(target.profile?.id || target.id || target.display_name)
}

function getMentionableBadge(target) {
    if (!target) return { initials: '?', detail: '' }
    if (target.kind === 'llm') {
        return {
            initials: getLLMInitials(target.display_name),
            detail: `#${target.llm.display_number}`,
        }
    }
    return {
        initials: (target.display_name?.[0] || 'U').toUpperCase(),
        detail: 'teammate',
    }
}

function Chat({ chatId }) {
    const { t, lang } = useLanguage()
    const tc = t.chat
    const tp = t.tryItDemo.panels
    const PANEL_LABELS = useMemo(() => ({
        team: tp.team,
        models: tp.workspace,
        files: tp.files,
        calendar: tp.calendar,
        daily: tp.daily,
    }), [tp])

    const [pendingLLMs, setPendingLLMs] = useState({}) // { llmId: true }
    const pendingLLMIdsRef = useRef(new Set())
    const sendingMessageRef = useRef(false)
    // Holds the active SSE fetch's AbortController so the user can cancel a
    // running stream from the UI. Replaced on each new /askLLM call; cleared
    // when the stream finishes or aborts.
    const streamControllerRef = useRef(null)
    const markPendingLLM = useCallback((llmId, state = {}) => {
        if (!llmId) return
        pendingLLMIdsRef.current.add(llmId)
        setPendingLLMs(prev => {
            const cur = prev[llmId] || { text: "" }
            return {
                ...prev,
                [llmId]: {
                    ...cur,
                    ...state,
                    text: state.text ?? cur.text ?? "",
                },
            }
        })
    }, [])
    const clearPendingLLM = useCallback((llmId) => {
        if (!llmId) return
        pendingLLMIdsRef.current.delete(llmId)
        setPendingLLMs(prev => {
            if (!prev[llmId]) return prev
            const next = { ...prev }
            delete next[llmId]
            return next
        })
    }, [])
    const handleLLMReply = useCallback((fullMsg) => {
        clearPendingLLM(fullMsg.sender_llm_id)
    }, [clearPendingLLM])
    const {
        chatName,
        messages, setMessages,
        invitedLLMs, setInvitedLLMs,
        profilesById,
        loading,
    } = useChatMessages(chatId, { onLLMReply: handleLLMReply })

    const [inputText, setInputText] = useState("")
    const [pendingAttachments, setPendingAttachments] = useState([]) // [{url,mime_type,filename,size,localPreview?,uploading?}]
    const [isDragOver, setIsDragOver] = useState(false)
    const [isPaneDragOver, setIsPaneDragOver] = useState(false)
    const fileInputRef = useRef(null)
    const [InviteLLMpop, setInviteLLMpop] = useState(false)
    const [deleteMessageTarget, setDeleteMessageTarget] = useState(null)
    const [deleteMessagePending, setDeleteMessagePending] = useState(false)
    const [showMentionDropdown, setShowMentionDropdown] = useState(false)
    const [mentionFilter, setMentionFilter] = useState("")
    const [stickyMention, setStickyMention] = useState(null)
    const [stickyMentionLoadedKey, setStickyMentionLoadedKey] = useState(null)
    const [showFeatureTray, setShowFeatureTray] = useState(false)
    const [showFeatureMore, setShowFeatureMore] = useState(false)
    const [sideAskActive, setSideAskActive] = useState(false)
    const [showStickyTargetDropdown, setShowStickyTargetDropdown] = useState(false)
    const [contextLLM, setContextLLM] = useState(null)
    const [contextUser, setContextUser] = useState(null)
    const [showInviteUser, setShowInviteUser] = useState(false)
    const [mobileTab, setMobileTab] = useState("team") // "team" | "models"
    const [teamTabs, setTeamTabs] = useState(() => [{ id: 'team-tab-1', filterId: null }])
    const [activeTeamTabId, setActiveTeamTabId] = useState('team-tab-1')
    const [dragTeamTabId, setDragTeamTabId] = useState(null)
    const [dragOverTeamTabId, setDragOverTeamTabId] = useState(null)
    const [workspaceTabs, setWorkspaceTabs] = useState(() => [{ id: 'tab-1', filterId: null }])
    const [activeTabId, setActiveTabId] = useState('tab-1')
    const [dragTabId, setDragTabId] = useState(null)
    const [dragOverTabId, setDragOverTabId] = useState(null)
    const [showWorkspaceFilterDropdown, setShowWorkspaceFilterDropdown] = useState(false)
    const [showTeamFilterDropdown, setShowTeamFilterDropdown] = useState(false)

    // Derived workspace tab state — keeps all downstream code that reads
    // workspaceFilterLLMId / setWorkspaceFilterLLMId working unchanged.
    const activeWorkspaceTab = useMemo(
        () => workspaceTabs.find(t => t.id === activeTabId) ?? workspaceTabs[0],
        [workspaceTabs, activeTabId]
    )
    const workspaceFilterLLMId = activeWorkspaceTab?.filterId ?? null
    function setWorkspaceFilterLLMId(filterId) {
        setWorkspaceTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, filterId } : t))
    }
    function addWorkspaceTab() {
        const id = `tab-${Date.now()}`
        setWorkspaceTabs(prev => [...prev, { id, filterId: null }])
        setActiveTabId(id)
    }
    function closeWorkspaceTab(tabId, e) {
        e.stopPropagation()
        setWorkspaceTabs(prev => {
            if (prev.length <= 1) return prev
            const idx = prev.findIndex(t => t.id === tabId)
            const next = prev.filter(t => t.id !== tabId)
            if (activeTabId === tabId) setActiveTabId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id)
            return next
        })
    }

    // Derived team tab state — mirrors the workspace tab pattern for the team pane.
    const activeTeamTab = useMemo(
        () => teamTabs.find(t => t.id === activeTeamTabId) ?? teamTabs[0],
        [teamTabs, activeTeamTabId]
    )
    const teamFilterUserId = activeTeamTab?.filterId ?? null
    function setTeamFilterUserId(filterId) {
        setTeamTabs(prev => prev.map(t => t.id === activeTeamTabId ? { ...t, filterId } : t))
    }
    function addTeamTab() {
        const id = `team-tab-${Date.now()}`
        setTeamTabs(prev => [...prev, { id, filterId: null }])
        setActiveTeamTabId(id)
    }
    function closeTeamTab(tabId, e) {
        e.stopPropagation()
        setTeamTabs(prev => {
            if (prev.length <= 1) return prev
            const idx = prev.findIndex(t => t.id === tabId)
            const next = prev.filter(t => t.id !== tabId)
            if (activeTeamTabId === tabId) setActiveTeamTabId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id)
            return next
        })
    }

    const [panelWidths, setPanelWidths] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("glyph.panelWidths") || "null")
            if (saved && typeof saved === "object") {
                return {
                    team: saved.team ?? 47,
                    models: saved.models ?? 53,
                    files: saved.files ?? 0,
                    calendar: saved.calendar ?? 38,
                    daily: saved.daily ?? 62,
                }
            }
            // Migrate from the older two-pane key
            const oldTeamPct = parseFloat(localStorage.getItem("glyph.teamWidthPct"))
            if (Number.isFinite(oldTeamPct) && oldTeamPct >= 20 && oldTeamPct <= 80) {
                return { team: oldTeamPct, models: 100 - oldTeamPct, files: 0, calendar: 38, daily: 62 }
            }
        } catch {
            // Ignore malformed saved layout preferences.
        }
        return { team: 47, models: 53, files: 0, calendar: 38, daily: 62 }
    })
    const [isResizing, setIsResizing] = useState(false)
    const [activeResize, setActiveResize] = useState(null)
    const [openPanels, setOpenPanels] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("glyph.openPanels") || "")
            if (saved && typeof saved === "object") {
                return {
                    team: saved.team !== false,
                    models: saved.models !== false,
                    files: !!saved.files,
                    calendar: saved.calendar !== false,
                    daily: saved.daily !== false,
                }
            }
        } catch {
            // Ignore malformed saved panel preferences.
        }
        return { team: true, models: true, files: false, calendar: true, daily: true }
    })
    const { user, session } = useAuth()
    const usage = useUsage(user)
    const canAccessPlanner = (usage?.plan || 'free') === 'max'
    const [viewGroup, setViewGroup] = useState(() => {
        const saved = localStorage.getItem("glyph.viewGroup")
        return saved === "planner" ? "planner" : "chat"
    })
    const { selectedDate, setSelectedDate, notes, updateNote } = usePlannerNotes(chatId, user?.id)

    const teamScrollRef = useRef(null)
    const modelsScrollRef = useRef(null)
    const inputRef = useRef(null)
    const splitRef = useRef(null)
    const composerRef = useRef(null)

    // Auto-scroll each pane independently
    useEffect(() => {
        if (teamScrollRef.current) {
            teamScrollRef.current.scrollTo({ top: teamScrollRef.current.scrollHeight, behavior: 'smooth' })
        }
        if (modelsScrollRef.current) {
            modelsScrollRef.current.scrollTo({ top: modelsScrollRef.current.scrollHeight, behavior: 'smooth' })
        }
    }, [messages])

    const stickyMentionStorageKey = useMemo(() => {
        if (!chatId || !user?.id) return null
        return `glyph.stickyMention.${user.id}.${chatId}`
    }, [chatId, user?.id])

    async function handleInviteLLM(name, modelType, instructions, connections) {
        // Backend owns the full flow now: create LLM row, persist connections,
        // post the join message. The frontend just hands over user intent.
        const connectionsPayload = connections.map(c => c === "user"
            ? { target_type: "user", target_llm_id: null }
            : { target_type: "llm", target_llm_id: c }
        )

        try {
            const { llm: newLlm, connections: connRows } = await apiFetch('/inviteLLM', {
                method: 'POST',
                body: {
                    chat_id: chatId,
                    display_name: name,
                    model_instruct: instructions,
                    model_type: modelType || 'openai',
                    connections: connectionsPayload,
                },
            })
            const fullLlm = {
                ...newLlm,
                llm_connections: (connRows || []).map((c, i) => ({ id: `temp-${i}`, ...c })),
            }
            setInvitedLLMs(prev => prev.some(l => l.id === fullLlm.id) ? prev : [...prev, fullLlm])
            setInviteLLMpop(false)
        } catch (err) {
            console.error('Invite LLM error:', err)
            alert('Failed to invite LLM: ' + (err.detail || err.message))
        }
    }

    // Unified list of @-mentionables: invited LLMs + chat participants
    // (excluding the current user — you don't @-mention yourself).
    const mentionables = useMemo(() => {
        const llms = invitedLLMs.map(l => ({
            id: l.id,
            display_name: l.display_name,
            kind: 'llm',
            llm: l,
        }))
        const people = Object.values(profilesById)
            .filter(p => p.id !== user?.id && p.first_name)
            .map(p => ({
                id: p.id,
                display_name: p.first_name,
                kind: 'person',
                profile: p,
        }))
        return [...people, ...llms]
    }, [invitedLLMs, profilesById, user?.id])

    const mentionGroups = useMemo(() => ({
        people: mentionables.filter(m => m.kind === 'person'),
        llms: mentionables.filter(m => m.kind === 'llm'),
    }), [mentionables])

    const stickyMentionTarget = useMemo(() => {
        if (!stickyMention) return null
        return mentionables.find(m => m.kind === stickyMention.kind && m.id === stickyMention.id) || null
    }, [mentionables, stickyMention])

    const stickyMentionColor = useMemo(
        () => getMentionableColor(stickyMentionTarget),
        [stickyMentionTarget]
    )

    const stickyMentionBadge = useMemo(
        () => getMentionableBadge(stickyMentionTarget),
        [stickyMentionTarget]
    )

    useEffect(() => {
        if (!stickyMentionStorageKey) {
            setStickyMention(null)
            setStickyMentionLoadedKey(null)
            return
        }
        try {
            const saved = JSON.parse(localStorage.getItem(stickyMentionStorageKey) || "null")
            if (saved?.id && (saved.kind === 'llm' || saved.kind === 'person')) {
                setStickyMention({ id: saved.id, kind: saved.kind })
            } else {
                setStickyMention(null)
            }
        } catch (err) {
            console.error("Failed to load sticky mention preference:", err)
            setStickyMention(null)
        }
        setStickyMentionLoadedKey(stickyMentionStorageKey)
    }, [stickyMentionStorageKey])

    useEffect(() => {
        if (!stickyMentionStorageKey || stickyMentionLoadedKey !== stickyMentionStorageKey) return
        try {
            if (stickyMention?.id && stickyMention?.kind) {
                localStorage.setItem(stickyMentionStorageKey, JSON.stringify(stickyMention))
            } else {
                localStorage.removeItem(stickyMentionStorageKey)
            }
        } catch (err) {
            console.error("Failed to save sticky mention preference:", err)
        }
    }, [stickyMention, stickyMentionLoadedKey, stickyMentionStorageKey])

    useEffect(() => {
        if (!showStickyTargetDropdown) return
        function handleOutsideClick(event) {
            if (composerRef.current && !composerRef.current.contains(event.target)) {
                setShowStickyTargetDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [showStickyTargetDropdown])

    useEffect(() => {
        if (!showFeatureTray) return
        function handleOutsideClick(event) {
            if (composerRef.current && !composerRef.current.contains(event.target)) {
                setShowFeatureTray(false)
                setShowFeatureMore(false)
            }
        }
        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [showFeatureTray])

    useEffect(() => {
        if (!loading && stickyMention && !stickyMentionTarget) {
            setStickyMention(null)
        }
    }, [loading, stickyMention, stickyMentionTarget])

    function handleInputChange(e) {
        const value = e.target.value
        setInputText(value)
        const lastAtIndex = value.lastIndexOf('@')
        if (lastAtIndex === -1) {
            setShowMentionDropdown(false)
            return
        }
        const afterAt = value.slice(lastAtIndex + 1)
        // Keep the dropdown open while the partial could still grow into a known
        // display name — handles multi-word names like "Time Manager".
        if (afterAt.length === 0 || isMentionPrefix(afterAt, mentionables)) {
            setMentionFilter(afterAt)
            setShowMentionDropdown(true)
            setShowStickyTargetDropdown(false)
        } else {
            setShowMentionDropdown(false)
        }
    }

    function handleSelectMention(target) {
        const lastAtIndex = inputText.lastIndexOf('@')
        const newText = inputText.slice(0, lastAtIndex) + `@${target.display_name} `
        setInputText(newText)
        setShowMentionDropdown(false)
        inputRef.current?.focus()
    }

    function clearMentionFragment() {
        const lastAtIndex = inputText.lastIndexOf('@')
        if (lastAtIndex !== -1) setInputText(inputText.slice(0, lastAtIndex))
        setShowMentionDropdown(false)
    }

    async function handleFilesSelected(files) {
        const fileArray = Array.from(files)
        if (!fileArray.length) return
        // Add placeholders immediately so the user sees them
        const placeholders = fileArray.map(f => ({
            _key: `${f.name}-${Date.now()}-${Math.random()}`,
            filename: f.name,
            mime_type: f.type || 'application/octet-stream',
            size: f.size,
            localPreview: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
            uploading: true,
            url: null,
        }))
        setPendingAttachments(prev => [...prev, ...placeholders])
        // Upload each file and replace the placeholder with the real URL
        await Promise.all(fileArray.map(async (file, i) => {
            const key = placeholders[i]._key
            try {
                const result = await apiUpload(file)
                setPendingAttachments(prev => prev.map(a =>
                    a._key === key ? { ...a, ...result, uploading: false } : a
                ))
            } catch (err) {
                setPendingAttachments(prev => prev.map(a =>
                    a._key === key ? { ...a, uploading: false, error: err.detail || err.message } : a
                ))
            }
        }))
    }

    async function handleSendMessage() {
        if ((!inputText.trim() && pendingAttachments.length === 0) || sendingMessageRef.current) return
        const stillUploading = pendingAttachments.some(a => a.uploading)
        if (stillUploading) { alert('Please wait for uploads to finish.'); return }
        sendingMessageRef.current = true
        const text = inputText
        const attachments = pendingAttachments.filter(a => a.url).map(({ url, mime_type, filename, size }) => ({ url, mime_type, filename, size }))
        const isSideAsk = sideAskActive
        const manualMentions = findMentions(text, mentionables)
        const effectiveTarget = manualMentions.length === 0 ? stickyMentionTarget : null
        const messageText = effectiveTarget ? `@${effectiveTarget.display_name} ${text}` : text
        setInputText("")
        setPendingAttachments([])
        setShowMentionDropdown(false)
        setShowStickyTargetDropdown(false)

        let newMsg
        try {
            newMsg = await apiFetch('/messages', {
                method: 'POST',
                body: {
                    chat_id: chatId,
                    content: messageText,
                    included_in_context: !isSideAsk,
                    attachments,
                },
            })
        } catch (err) {
            console.error('Message insert error:', err)
            alert('Failed to send message: ' + (err.detail || err.message))
            setInputText(text)
            setPendingAttachments(attachments.map(a => ({ ...a })))
            setSideAskActive(isSideAsk)
            sendingMessageRef.current = false
            return
        }

        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
        sendingMessageRef.current = false

        // Addressee rule: the FIRST active (`@`, not `@@`) mention is the addressee.
        // If it's a person, no LLM fires (the message is for that person, even if
        // it references LLMs later). If it's an LLM, that LLM fires.
        const allMentions = findMentions(messageText, mentionables)
        const firstActive = allMentions.find(m => m.active)
        const targetLLMs = firstActive && firstActive.kind === 'llm' ? [firstActive.target] : []

        for (const llm of targetLLMs) {
            await streamLLMReply(llm, null, isSideAsk ? newMsg.id : null)
        }
    }

    async function streamLLMReply(llm, replaceMessageId = null, sideMessageId = null) {
        if (pendingLLMIdsRef.current.has(llm.id)) return

        const streamOwnedLLMIds = new Set()
        const beginPending = (llmId, state = {}) => {
            if (!pendingLLMIdsRef.current.has(llmId)) {
                streamOwnedLLMIds.add(llmId)
            }
            markPendingLLM(llmId, state)
        }
        const clearIfOwned = (llmId) => {
            if (streamOwnedLLMIds.has(llmId)) clearPendingLLM(llmId)
        }

        // Abort any prior in-flight stream (defensive — there shouldn't be one
        // because pendingLLMIdsRef gates re-entry, but a stale ref is safer to
        // null out than to leave dangling).
        streamControllerRef.current?.abort()
        const controller = new AbortController()
        streamControllerRef.current = controller

        beginPending(llm.id, { text: "", replaceMessageId, sideMessageId })
        try {
            const res = await fetch(`${API_BASE}/askLLM`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
                body: JSON.stringify({
                    chat_id: chatId,
                    llm_id: llm.id,
                    ...(replaceMessageId ? { replace_message_id: replaceMessageId } : {}),
                    ...(sideMessageId ? { side_message_id: sideMessageId } : {}),
                }),
                signal: controller.signal,
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error("Backend ask error:", err)
                if (res.status === 429) {
                    alert(err.detail || "Usage limit reached. Upgrade your plan or try again later.")
                } else {
                    alert("LLM error: " + (err.detail || res.statusText))
                }
                clearIfOwned(llm.id)
                return
            }
            setMobileTab("models")

            // Read SSE stream (data: {...}\n\n events)
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const events = buffer.split("\n\n")
                buffer = events.pop() || ""
                for (const evt of events) {
                    if (!evt.startsWith("data: ")) continue
                    let data
                    try { data = JSON.parse(evt.slice(6)) } catch { continue }
                    const eventLlmId = data.llm_id || llm.id
                    if (data.type === "agent_start") {
                        beginPending(eventLlmId, {
                            text: "",
                            delegatedFromLlmId: data.from_llm_id,
                            delegationMessageId: data.delegation_message_id,
                        })
                    } else if (data.type === "token") {
                        if (!pendingLLMIdsRef.current.has(eventLlmId)) beginPending(eventLlmId)
                    } else if (data.type === "error") {
                        console.error("Stream error:", data.detail)
                        alert("LLM error: " + (data.detail || "stream failed"))
                        clearIfOwned(eventLlmId)
                    } else if (data.type === "done") {
                        // For new messages the INSERT realtime push also clears
                        // pending — but for regenerations the backend UPDATEs the
                        // existing row (no INSERT), so 'done' is the reliable signal.
                        clearIfOwned(eventLlmId)
                    }
                    // 'tool' events: client just renders progress; nothing to do here.
                }
            }
        } catch (err) {
            // User-initiated abort: just clean up silently. Anything else is a
            // real network/runtime error and worth surfacing.
            if (err.name !== 'AbortError') {
                console.error("Ask fetch error:", err)
                alert(`Could not reach backend at ${API_BASE}: ${err.message}`)
            }
        } finally {
            for (const pendingId of streamOwnedLLMIds) {
                clearPendingLLM(pendingId)
            }
            if (streamControllerRef.current === controller) {
                streamControllerRef.current = null
            }
        }
    }

    function stopGeneration() {
        streamControllerRef.current?.abort()
    }

    async function handleEditMessage(msg, newContent) {
        const nowIso = new Date().toISOString()
        const prevSnapshot = { content: msg.content, edited_at: msg.edited_at }
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: newContent, edited_at: nowIso } : m))
        try {
            const { edited_at } = await apiFetch(`/messages/${msg.id}`, {
                method: 'PATCH',
                body: { content: newContent },
            })
            if (edited_at) {
                setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, edited_at } : m))
            }
            return true
        } catch (err) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...prevSnapshot } : m))
            alert('Failed to edit message: ' + (err.detail || err.message))
            return false
        }
    }

    function handleDeleteMessage(msg) {
        setDeleteMessageTarget(msg)
    }

    async function confirmDeleteMessage() {
        const msg = deleteMessageTarget
        if (!msg) return
        setDeleteMessagePending(true)
        const nowIso = new Date().toISOString()
        const prevDeletedAt = msg.deleted_at
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, deleted_at: nowIso } : m))
        try {
            await apiFetch(`/messages/${msg.id}`, { method: 'DELETE' })
        } catch (err) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, deleted_at: prevDeletedAt } : m))
            alert('Failed to delete message: ' + (err.detail || err.message))
            setDeleteMessagePending(false)
            return
        }
        setDeleteMessageTarget(null)
        setDeleteMessagePending(false)
    }

    async function handleRegenerateAI(msg) {
        const llm = invitedLLMs.find(l => l.id === msg.sender_llm_id)
        if (!llm) return
        if (pendingLLMs[llm.id]) return
        await streamLLMReply(llm, msg.id)
    }

    async function includeMessageInContext(msg) {
        if (!msg?.id || msg.included_in_context !== false) return
        let idsToInclude = [msg.id]
        if (msg.side_parent_message_id) {
            idsToInclude = [msg.id, msg.side_parent_message_id]
        } else {
            const childIds = messages
                .filter(m => m.side_parent_message_id === msg.id)
                .map(m => m.id)
            idsToInclude = [msg.id, ...childIds]

            // Backfill behavior for side messages created before
            // side_parent_message_id existed.
            const index = messages.findIndex(m => m.id === msg.id)
            if (index !== -1 && childIds.length === 0) {
                if (msg.sender_type === "user") {
                    const nextSideReply = messages.slice(index + 1).find(m =>
                        m.sender_type === "llm" &&
                        m.included_in_context === false &&
                        !m.side_parent_message_id
                    )
                    if (nextSideReply) idsToInclude.push(nextSideReply.id)
                } else if (msg.sender_type === "llm") {
                    const previousSideUser = [...messages.slice(0, index)].reverse().find(m =>
                        m.sender_type === "user" &&
                        m.included_in_context === false
                    )
                    if (previousSideUser) idsToInclude.push(previousSideUser.id)
                }
            }
        }
        idsToInclude = [...new Set(idsToInclude)].filter(Boolean)

        setMessages(prev => prev.map(m => idsToInclude.includes(m.id) ? { ...m, included_in_context: true } : m))
        try {
            await apiFetch('/messages/include_in_context', {
                method: 'POST',
                body: { chat_id: chatId, message_ids: idsToInclude, included: true },
            })
        } catch (err) {
            console.error('Failed to add message to context:', err)
            setMessages(prev => prev.map(m => idsToInclude.includes(m.id) ? { ...m, included_in_context: false } : m))
            alert('Failed to add message to context: ' + (err.detail || err.message))
        }
    }

    function openContext(llmId) {
        const llm = invitedLLMs.find(l => l.id === llmId)
        if (llm) setContextLLM(llm)
    }

    function handleSplitDragStart(dividerIndex) {
        return (e) => {
            e.preventDefault()
            const visible = GROUP_KEYS[viewGroup].filter(k => openPanels[k])
            if (dividerIndex < 0 || dividerIndex >= visible.length - 1) return
            const leftKey = visible[dividerIndex]
            const rightKey = visible[dividerIndex + 1]
            setIsResizing(true)
            setActiveResize({
                leftKey,
                rightKey,
                startX: e.clientX,
                startLeft: panelWidths[leftKey],
                startRight: panelWidths[rightKey],
            })
        }
    }

    useEffect(() => {
        if (!isResizing || !activeResize) return

        function onMove(e) {
            const container = splitRef.current
            if (!container) return
            const rect = container.getBoundingClientRect()
            const deltaPx = (e.clientX - activeResize.startX) * (lang === 'ar' ? -1 : 1)
            const deltaPct = (deltaPx / rect.width) * 100
            // Pixel floor (must match the panes' md:min-w-[18rem]) so a pane can
            // never be dragged narrower than its header — otherwise the header's
            // shrink-0 controls overflow and paint over the neighboring pane.
            const MIN = Math.min(40, (18 * 16 / rect.width) * 100)
            let newLeft = activeResize.startLeft + deltaPct
            let newRight = activeResize.startRight - deltaPct
            if (newLeft < MIN) { newRight -= (MIN - newLeft); newLeft = MIN }
            if (newRight < MIN) { newLeft -= (MIN - newRight); newRight = MIN }
            setPanelWidths(prev => ({
                ...prev,
                [activeResize.leftKey]: newLeft,
                [activeResize.rightKey]: newRight,
            }))
        }
        function onUp() {
            setIsResizing(false)
            setActiveResize(null)
        }

        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
    }, [isResizing, activeResize])

    useEffect(() => {
        localStorage.setItem("glyph.panelWidths", JSON.stringify(panelWidths))
    }, [panelWidths])

    // Renormalize visible widths to sum to 100 whenever the visible set changes
    useEffect(() => {
        setPanelWidths(prev => {
            const visible = GROUP_KEYS[viewGroup].filter(k => openPanels[k])
            if (visible.length === 0) return prev
            const next = { ...prev }
            const zeros = visible.filter(k => (prev[k] || 0) === 0)
            if (zeros.length > 0) {
                const newShare = 100 / visible.length
                zeros.forEach(k => { next[k] = newShare })
                const reserved = newShare * zeros.length
                const remaining = 100 - reserved
                const nonZeros = visible.filter(k => !zeros.includes(k))
                const nzSum = nonZeros.reduce((s, k) => s + prev[k], 0)
                if (nzSum > 0) {
                    nonZeros.forEach(k => { next[k] = prev[k] * (remaining / nzSum) })
                } else {
                    nonZeros.forEach(k => { next[k] = remaining / nonZeros.length })
                }
                return next
            }
            const total = visible.reduce((s, k) => s + prev[k], 0)
            if (Math.abs(total - 100) > 0.5) {
                const factor = 100 / total
                visible.forEach(k => { next[k] = prev[k] * factor })
                return next
            }
            return prev
        })
    }, [openPanels, viewGroup])

    useEffect(() => {
        localStorage.setItem("glyph.openPanels", JSON.stringify(openPanels))
    }, [openPanels])

    useEffect(() => {
        if (usage && !canAccessPlanner && viewGroup === 'planner') {
            setViewGroup('chat')
        }
    }, [canAccessPlanner, usage])

    useEffect(() => {
        localStorage.setItem("glyph.viewGroup", viewGroup)
    }, [viewGroup])

    function togglePanel(name) {
        setOpenPanels(prev => {
            const next = { ...prev, [name]: !prev[name] }
            const stillVisible = GROUP_KEYS[viewGroup].some(k => next[k])
            if (!stillVisible) return prev
            return next
        })
    }

    useEffect(() => {
        const groupKeys = GROUP_KEYS[viewGroup]
        if (!groupKeys.includes(mobileTab) || !openPanels[mobileTab]) {
            const first = groupKeys.find(k => openPanels[k])
            if (first) setMobileTab(first)
        }
    }, [openPanels, mobileTab, viewGroup])

    // Reset tab filterIds if the target person/LLM is no longer in the chat
    useEffect(() => {
        setTeamTabs(prev => prev.map(t =>
            t.filterId && !profilesById[t.filterId] ? { ...t, filterId: null } : t
        ))
    }, [profilesById])
    useEffect(() => {
        setWorkspaceTabs(prev => prev.map(t =>
            t.filterId && !invitedLLMs.some(l => l.id === t.filterId)
                ? { ...t, filterId: null }
                : t
        ))
    }, [invitedLLMs])

    // Close filter dropdowns on outside click / Escape
    useEffect(() => {
        if (!showTeamFilterDropdown && !showWorkspaceFilterDropdown) return
        function onDown(e) {
            if (showTeamFilterDropdown && !e.target.closest?.('[data-filter="team"]')) setShowTeamFilterDropdown(false)
            if (showWorkspaceFilterDropdown && !e.target.closest?.('[data-filter="workspace"]')) setShowWorkspaceFilterDropdown(false)
        }
        function onKey(e) {
            if (e.key === 'Escape') {
                setShowTeamFilterDropdown(false)
                setShowWorkspaceFilterDropdown(false)
            }
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [showTeamFilterDropdown, showWorkspaceFilterDropdown])

    const filteredMentions = useMemo(() => {
        const q = mentionFilter.toLowerCase()
        const matches = mentionables.filter(m => m.display_name.toLowerCase().startsWith(q))
        return {
            people: matches.filter(m => m.kind === 'person'),
            llms: matches.filter(m => m.kind === 'llm'),
        }
    }, [mentionables, mentionFilter])

    // Split messages into team (user + system) and models (llm)
    const { teamMessages, modelMessages, teamMessagesAll } = useMemo(() => {
        const teamAll = []
        const modelAll = []
        for (const msg of messages) {
            if (msg.kind === 'delegation') continue
            if (msg.sender_type === 'llm') modelAll.push(msg)
            else teamAll.push(msg)
        }
        const team = teamFilterUserId
            ? teamAll.filter(m => m.sender_user_id === teamFilterUserId)
            : teamAll
        const model = workspaceFilterLLMId
            ? modelAll.filter(m => m.sender_llm_id === workspaceFilterLLMId)
            : modelAll
        return { teamMessages: team, modelMessages: model, teamMessagesAll: teamAll }
    }, [messages, teamFilterUserId, workspaceFilterLLMId])

    // Extract generated files from message content (markdown links to known extensions)
    const generatedFiles = useMemo(() => {
        const out = []
        const seen = new Set()
        const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+?\.(pdf|pptx|docx|xlsx|py|js|ts|tsx|md|txt|csv|json|zip|png|jpe?g|svg))\)/gi
        for (const m of messages) {
            const content = m.content || ""
            let match
            while ((match = re.exec(content)) !== null) {
                const url = match[2]
                if (seen.has(url)) continue
                seen.add(url)
                out.push({
                    id: url,
                    name: match[1].replace(/^Download\s+/i, ""),
                    url,
                    ext: match[3].toLowerCase(),
                    created_at: m.created_at,
                    sender_llm_id: m.sender_type === 'llm' ? m.sender_llm_id : null,
                })
            }
        }
        return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [messages])

    const userCount = useMemo(() => Object.keys(profilesById).length || 1, [profilesById])

    const teamPeopleList = useMemo(() => {
        return Object.values(profilesById)
            .filter(p => p.first_name)
            .sort((a, b) => {
                if (a.id === user?.id) return -1
                if (b.id === user?.id) return 1
                return a.first_name.localeCompare(b.first_name)
            })
    }, [profilesById, user?.id])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-[var(--color-canvas)]">
                <div className="flex items-center gap-3 text-sm text-[var(--color-fg-muted)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" style={{ animationDelay: '0.16s' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" style={{ animationDelay: '0.32s' }} />
                    <span className="ml-2">{tc.loading}</span>
                </div>
            </div>
        )
    }

    /* ---------- Mention dropdown (rendered above input) ---------- */
    const noMatches = filteredMentions.people.length === 0 && filteredMentions.llms.length === 0
    const mentionDropdown = showMentionDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl lp-scroll">
            {noMatches && (
                <div className="px-3 py-2 text-xs text-[var(--color-fg-subtle)]">{tc.mentionNoMatches}</div>
            )}

            {filteredMentions.people.length > 0 && (
                <>
                    <div className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        {tc.people}
                    </div>
                    {filteredMentions.people.map(m => {
                        const c = getMentionableColor(m)
                        const badge = getMentionableBadge(m)
                        return (
                            <button
                                key={`person-${m.id}`}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-3)]"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectMention(m)}
                            >
                                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${c.avatarBg} ${c.avatarText}`}>
                                    {badge.initials}
                                </span>
                                <span className="text-[var(--color-fg)]">@{m.display_name}</span>
                                <span className={`text-xs ${c.text}`}>· {tc.personSuffix}</span>
                            </button>
                        )
                    })}
                </>
            )}

            {filteredMentions.llms.length > 0 && (
                <>
                    {filteredMentions.people.length > 0 && (
                        <div className="border-t border-[var(--color-line-soft)]" />
                    )}
                    <div className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        {tc.models}
                    </div>
                    {filteredMentions.llms.map(m => {
                        const llm = m.llm
                        const c = getLLMColor(llm.display_number)
                        return (
                            <button
                                key={`llm-${m.id}`}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-3)]"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectMention(m)}
                            >
                                <span className={`flex h-6 w-6 items-center justify-center rounded-full ${c.avatarBg} text-[10px] font-semibold ${c.avatarText}`}>
                                    {getLLMInitials(llm.display_name)}
                                </span>
                                <span className="text-[var(--color-fg)]">@{llm.display_name}</span>
                                <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">#{llm.display_number}</span>
                            </button>
                        )
                    })}
                </>
            )}

            <div className="border-t border-[var(--color-line-soft)]">
                <button
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { clearMentionFragment(); setInviteLLMpop(true) }}
                >
                    <span className="text-base leading-none">+</span> {tc.inviteNewModel}
                </button>
                <button
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { clearMentionFragment(); setShowInviteUser(true) }}
                >
                    <span className="text-base leading-none">+</span> {tc.inviteTeammate}
                </button>
            </div>
        </div>
    )

    const stickyTargetDropdown = showStickyTargetDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl lp-scroll">
            <div className="border-b border-[var(--color-line-soft)] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    {tc.alwaysSendTo}
                </div>
                <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                    {tc.alwaysSendToDesc}
                </div>
            </div>

            {stickyMentionTarget && stickyMentionColor && (
                <div className="border-b border-[var(--color-line-soft)] px-3 py-2">
                    <button
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm ${stickyMentionColor.softBorder} ${stickyMentionColor.softBg}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            setStickyMention(null)
                            setShowStickyTargetDropdown(false)
                        }}
                    >
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${stickyMentionColor.avatarBg} ${stickyMentionColor.avatarText}`}>
                            {stickyMentionBadge.initials}
                        </span>
                        <span className="text-[var(--color-fg)]">{tc.turnOffDefault}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">{tc.currentlyAt(stickyMentionTarget.display_name)}</span>
                    </button>
                </div>
            )}

            {mentionGroups.people.length === 0 && mentionGroups.llms.length === 0 && (
                <div className="px-3 py-3 text-xs text-[var(--color-fg-subtle)]">
                    {tc.inviteFirst}
                </div>
            )}

            {mentionGroups.people.length > 0 && (
                <>
                    <div className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        {tc.people}
                    </div>
                    {mentionGroups.people.map(target => {
                        const c = getMentionableColor(target)
                        const badge = getMentionableBadge(target)
                        const isActive = stickyMentionTarget?.kind === target.kind && stickyMentionTarget?.id === target.id
                        return (
                            <button
                                key={`sticky-person-${target.id}`}
                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-3)] ${isActive ? c.softBg : ''}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    setStickyMention({ id: target.id, kind: target.kind })
                                    setShowStickyTargetDropdown(false)
                                    inputRef.current?.focus()
                                }}
                            >
                                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${c.avatarBg} ${c.avatarText}`}>
                                    {badge.initials}
                                </span>
                                <span className="text-[var(--color-fg)]">@{target.display_name}</span>
                                <span className={`text-xs ${c.text}`}>· {badge.detail}</span>
                                {isActive && (
                                    <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${c.softBorder} ${c.text}`}>
                                        {tc.on}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </>
            )}

            {mentionGroups.llms.length > 0 && (
                <>
                    {mentionGroups.people.length > 0 && (
                        <div className="border-t border-[var(--color-line-soft)]" />
                    )}
                    <div className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        {tc.models}
                    </div>
                    {mentionGroups.llms.map(target => {
                        const c = getMentionableColor(target)
                        const badge = getMentionableBadge(target)
                        const isActive = stickyMentionTarget?.kind === target.kind && stickyMentionTarget?.id === target.id
                        return (
                            <button
                                key={`sticky-llm-${target.id}`}
                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-3)] ${isActive ? c.softBg : ''}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    setStickyMention({ id: target.id, kind: target.kind })
                                    setShowStickyTargetDropdown(false)
                                    inputRef.current?.focus()
                                }}
                            >
                                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${c.avatarBg} ${c.avatarText}`}>
                                    {badge.initials}
                                </span>
                                <span className="text-[var(--color-fg)]">@{target.display_name}</span>
                                <span className={`text-xs ${c.text}`}>· {badge.detail}</span>
                                {isActive && (
                                    <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${c.softBorder} ${c.text}`}>
                                        {tc.on}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </>
            )}
        </div>
    )

    const alwaysFeaturePill = stickyMentionTarget && stickyMentionColor && (
        <button
            type="button"
            onClick={() => {
                setStickyMention(null)
                setShowFeatureTray(false)
                setShowMentionDropdown(false)
            }}
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${stickyMentionColor.softBorder} ${stickyMentionColor.softBg} hover:bg-[var(--color-surface-3)]`}
            title="Turn off Always"
        >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${stickyMentionColor.avatarBg} ${stickyMentionColor.avatarText}`}>
                {stickyMentionBadge.initials}
            </span>
            <span className="min-w-0">
                <span className="block max-w-[12rem] truncate text-xs text-[var(--color-fg)]">
                    {tc.alwaysSendingTo(stickyMentionTarget.display_name).split(`@${stickyMentionTarget.display_name}`).map((part, i, arr) => i < arr.length - 1 ? <span key={i}>{part}<span className={`font-medium ${stickyMentionColor.text}`}>@{stickyMentionTarget.display_name}</span></span> : <span key={i}>{part}</span>)}
                </span>
            </span>
        </button>
    )

    const sideAskFeaturePill = sideAskActive && (
        <button
            type="button"
            onClick={() => setSideAskActive(false)}
            className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-left text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
            title="Turn off Ask Side"
        >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[10px] font-semibold text-[var(--color-fg)]">
                SA
            </span>
            <span className="truncate text-xs font-medium">{tc.sideAskOn}</span>
        </button>
    )

    const activeFeatureStrips = (alwaysFeaturePill || sideAskFeaturePill) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
            {alwaysFeaturePill}
            {sideAskFeaturePill}
        </div>
    )

    const SideContextBadge = ({ msg, align = "start" }) => (
        <span className={`mb-1 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)] ${align === "end" ? "self-end" : "self-start"}`}>
            <span>{tc.notInContext}</span>
            <button
                onClick={() => includeMessageInContext(msg)}
                className="rounded-full px-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                title="Add this message back to context"
            >
                {tc.addToContext}
            </button>
        </span>
    )

    const featureTray = showFeatureTray && (
        <div
            className="absolute bottom-2 left-12 z-20 flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1 shadow-2xl"
        >
            <FeatureAction
                active={!!stickyMentionTarget}
                activeClass={stickyMentionTarget && stickyMentionColor ? `${stickyMentionColor.softBorder} ${stickyMentionColor.softBg} ${stickyMentionColor.text}` : ""}
                icon={<TargetIcon />}
                label={tc.featureAlways}
                popoverTitle={tc.alwaysPopoverTitle}
                popoverText={tc.alwaysPopoverText}
                onClick={() => {
                    if (stickyMentionTarget) {
                        setStickyMention(null)
                        setShowStickyTargetDropdown(false)
                        setShowFeatureTray(false)
                        return
                    }
                    setShowStickyTargetDropdown(true)
                    setShowFeatureTray(false)
                    setMentionFilter("")
                    setShowMentionDropdown(false)
                }}
            />
            <FeatureAction
                active={sideAskActive}
                icon={<SideAskIcon />}
                label={tc.featureAskSide}
                popoverTitle={tc.sideAskPopoverTitle}
                popoverText={tc.sideAskPopoverText}
                onClick={() => {
                    setSideAskActive(v => !v)
                    setShowFeatureTray(false)
                    setShowFeatureMore(false)
                    inputRef.current?.focus()
                }}
            />
            <FeatureAction
                active={showFeatureMore}
                icon={<MoreIcon />}
                label={tc.featureMore}
                onClick={() => setShowFeatureMore(v => !v)}
            />
            {showFeatureMore && (
                <div className="absolute bottom-11 right-0 w-52 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] py-1 shadow-2xl">
                    <FeatureMoreItem icon={<AttachIcon />} label={tc.attachFile} detail={tc.attachFileDetail} onClick={() => { fileInputRef.current?.click(); setShowFeatureMore(false) }} />
                    <FeatureMoreItem icon={<WebIcon />} label={tc.webSearch} detail={tc.webSearchDetail} />
                    <FeatureMoreItem icon={<VoiceIcon />} label={tc.voiceNote} detail={tc.voiceNoteDetail} />
                    <div className="my-1 border-t border-[var(--color-line-soft)]" />
                    <FeatureMoreItem icon={<ExportIcon />} label={tc.exportChat} detail={tc.exportChatDetail} />
                </div>
            )}
        </div>
    )

    /* ---------- Input ---------- */
    const inputBar = (
        <div
            className={`border-t border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-4 py-3 transition-colors ${isDragOver ? 'bg-[var(--color-brand)]/5 border-[var(--color-brand)]' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }}
            onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setIsDragOver(false)
                setIsPaneDragOver(false)
                handleFilesSelected(e.dataTransfer.files)
            }}
        >
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml"
                className="hidden"
                onChange={(e) => { handleFilesSelected(e.target.files); e.target.value = '' }}
            />
            <div ref={composerRef} className="relative">
                {mentionDropdown}
                {stickyTargetDropdown}
                {activeFeatureStrips}
                <div className={`rounded-2xl border bg-[var(--color-surface-2)] px-3 py-2 transition-colors focus-within:border-[var(--color-fg-subtle)] ${isDragOver ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)]'}`}>
                    {/* Attachment chips */}
                    {pendingAttachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                            {pendingAttachments.map((a) => (
                                <div
                                    key={a._key}
                                    className={`group relative flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                                        a.error
                                            ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                                            : 'border-[var(--color-line)] bg-[var(--color-surface-3)] text-[var(--color-fg-muted)]'
                                    }`}
                                >
                                    {a.localPreview ? (
                                        <img src={a.localPreview} alt="" className="h-5 w-5 rounded object-cover" />
                                    ) : (
                                        <ImageIcon size={12} />
                                    )}
                                    <span className="max-w-[120px] truncate">{a.filename}</span>
                                    {a.uploading && <span className="ml-0.5 opacity-60">↑</span>}
                                    {a.error && <span className="ml-0.5" title={a.error}>!</span>}
                                    <button
                                        onClick={() => setPendingAttachments(prev => prev.filter(x => x._key !== a._key))}
                                        className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--color-fg)]"
                                        aria-label="Remove attachment"
                                    >
                                        <XIcon size={10} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-end gap-2">
                        <button
                            onClick={() => {
                                setShowFeatureTray(v => !v)
                                setShowStickyTargetDropdown(false)
                                setShowMentionDropdown(false)
                            }}
                            className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] ${showFeatureTray ? 'border-[var(--color-fg-subtle)] bg-[var(--color-surface-3)]' : 'border-[var(--color-line)]'}`}
                            aria-label="Open message features"
                            title="Message features"
                        >
                            <FeatureIcon />
                        </button>
                        {featureTray}
                        <textarea
                            ref={inputRef}
                            rows={1}
                            placeholder={isDragOver ? tc.dropPlaceholder : tc.messagePlaceholder}
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
                            disabled={!inputText.trim() && pendingAttachments.length === 0}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-black transition-all hover:bg-[var(--color-brand)] disabled:opacity-40"
                            aria-label="Send"
                        >
                            <SendIcon />
                        </button>
                    </div>
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
                        <span>{tc.person(userCount)}</span>
                        <span>·</span>
                        <span>{tc.model(invitedLLMs.length)}</span>
                    </div>
                </div>
                <div className="ml-3 hidden items-center gap-2 md:flex">
                    {Object.keys(profilesById).length > 0 && (
                        <div className="flex items-center -space-x-1.5">
                            {Object.values(profilesById).slice(0, 5).map(p => {
                                const isMe = p.id === user?.id
                                const initial = (p.first_name?.[0] || 'U').toUpperCase()
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => setContextUser(p)}
                                        title={`${p.first_name || 'User'}${isMe ? ' (you)' : ''}`}
                                        className={`flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-[var(--color-surface-1)] text-[10px] font-semibold hover:z-10 hover:scale-110 transition-transform ${
                                            isMe
                                                ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black'
                                                : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'
                                        }`}
                                    >
                                        {initial}
                                    </button>
                                )
                            })}
                            {Object.keys(profilesById).length > 5 && (
                                <span className="flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-[var(--color-surface-1)] bg-[var(--color-surface-3)] text-[10px] text-[var(--color-fg-muted)]">
                                    +{Object.keys(profilesById).length - 5}
                                </span>
                            )}
                        </div>
                    )}

                    {Object.keys(profilesById).length > 0 && invitedLLMs.length > 0 && (
                        <span className="h-6 w-px bg-[var(--color-line-soft)]" aria-hidden="true" />
                    )}

                    {invitedLLMs.length > 0 && (
                        <div className="flex items-center -space-x-1.5">
                            {invitedLLMs.slice(0, 5).map(llm => {
                                const c = getLLMColor(llm.display_number)
                                return (
                                    <button
                                        key={llm.id}
                                        onClick={() => openContext(llm.id)}
                                        title={llm.display_name}
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
            </div>

            <div className="flex items-center gap-2">
                <div className="hidden items-center gap-0.5 rounded-lg border border-[var(--color-line)] p-0.5 md:flex">
                    <GroupBtn active={viewGroup === 'chat'} onClick={() => setViewGroup('chat')} icon={<ChatBubbleIcon />}>{tc.chatGroup}</GroupBtn>
                    {canAccessPlanner && (
                        <GroupBtn active={viewGroup === 'planner'} onClick={() => setViewGroup('planner')} icon={<CalendarIcon />}>{tc.plannerGroup}</GroupBtn>
                    )}
                </div>
                <div className="hidden items-center gap-0.5 rounded-lg border border-[var(--color-line)] p-0.5 md:flex">
                    {viewGroup === 'chat' ? (
                        <>
                            <PanelToggleBtn active={openPanels.team} onClick={() => togglePanel('team')} label={PANEL_LABELS.team}><PeopleIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.models} onClick={() => togglePanel('models')} label={PANEL_LABELS.models}><BotIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.files} onClick={() => togglePanel('files')} label={PANEL_LABELS.files}><FileIcon /></PanelToggleBtn>
                        </>
                    ) : (
                        <>
                            <PanelToggleBtn active={openPanels.calendar} onClick={() => togglePanel('calendar')} label={PANEL_LABELS.calendar}><CalendarIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.daily} onClick={() => togglePanel('daily')} label={PANEL_LABELS.daily}><NoteIcon /></PanelToggleBtn>
                        </>
                    )}
                </div>
                {viewGroup === 'chat' && (
                    <div className="flex items-center gap-1">
                        <IconBtn label={tc.inviteNewModel} onClick={() => setInviteLLMpop(true)}><BotIcon /></IconBtn>
                        <IconBtn label={tc.inviteTeammate} onClick={() => setShowInviteUser(true)}><UserPlusIcon /></IconBtn>
                    </div>
                )}
            </div>
        </div>
    )

    /* ---------- Team pane (left) ---------- */
    const teamShownCount = teamMessages.filter(m => m.sender_type === 'user').length
    const teamTotalCount = teamMessagesAll.filter(m => m.sender_type === 'user').length
    const teamPane = (
        <section
            className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]"
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault()
                    setIsPaneDragOver(true)
                }
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setIsPaneDragOver(false)
            }}
            onDrop={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setIsPaneDragOver(false)
                handleFilesSelected(e.dataTransfer.files)
            }}
        >
            {isPaneDragOver && (
                <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-brand)]/10">
                    <div className="rounded-2xl border-2 border-dashed border-[var(--color-brand)] bg-[var(--color-surface-1)]/90 px-12 py-8 text-center shadow-2xl">
                        <div className="mb-2 text-3xl text-[var(--color-brand)]">↓</div>
                        <div className="text-sm font-medium text-[var(--color-brand)]">{tc.dropToAttach}</div>
                    </div>
                </div>
            )}
            {/* Chrome-style tab bar */}
            <div className="flex items-end border-b border-[var(--color-line-soft)] bg-[var(--color-surface-2)]">
                {/* Scrollable tab strip */}
                <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
                    {teamTabs.map(tab => {
                        const isActive = tab.id === activeTeamTabId
                        const tabPerson = tab.filterId ? profilesById[tab.filterId] : null
                        const isMe = tabPerson?.id === user?.id
                        const isDragOver = dragOverTeamTabId === tab.id && dragTeamTabId !== tab.id
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                draggable
                                onDragStart={() => setDragTeamTabId(tab.id)}
                                onDragEnd={() => { setDragTeamTabId(null); setDragOverTeamTabId(null) }}
                                onDragOver={e => { e.preventDefault(); setDragOverTeamTabId(tab.id) }}
                                onDrop={() => {
                                    if (!dragTeamTabId || dragTeamTabId === tab.id) return
                                    setTeamTabs(prev => {
                                        const from = prev.findIndex(t => t.id === dragTeamTabId)
                                        const to = prev.findIndex(t => t.id === tab.id)
                                        const next = [...prev]
                                        next.splice(to, 0, next.splice(from, 1)[0])
                                        return next
                                    })
                                    setDragTeamTabId(null)
                                    setDragOverTeamTabId(null)
                                }}
                                onClick={() => setActiveTeamTabId(tab.id)}
                                className={`group relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[11px] font-medium transition-colors ${
                                    isActive
                                        ? 'rounded-t-lg border border-b-0 border-[var(--color-line-soft)] bg-[var(--color-canvas)] text-[var(--color-fg)] -mb-px'
                                        : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]'
                                } ${isDragOver ? 'border-l-2 border-l-[var(--color-brand)]' : ''}`}
                            >
                                {tabPerson ? (
                                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[7px] font-bold ${isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}>
                                        {(tabPerson.first_name?.[0] || 'U').toUpperCase()}
                                    </span>
                                ) : (
                                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--color-line-soft)] text-[var(--color-fg-subtle)]">
                                        <PeopleIcon />
                                    </span>
                                )}
                                <span className="max-w-[7rem] truncate">
                                    {tabPerson ? (isMe ? `${tabPerson.first_name} ${tc.youSuffix}` : tabPerson.first_name) : tc.allTab}
                                </span>
                                {teamTabs.length > 1 && (
                                    <span
                                        role="button"
                                        onClick={(e) => closeTeamTab(tab.id, e)}
                                        className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--color-surface-3)] hover:text-rose-400 hover:!opacity-100 group-hover:opacity-50"
                                    >
                                        <XIcon size={8} />
                                    </span>
                                )}
                            </button>
                        )
                    })}
                    {/* + new tab */}
                    <button
                        type="button"
                        onClick={addTeamTab}
                        className="flex h-8 w-7 shrink-0 items-center justify-center self-center text-base text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                        title="New tab"
                    >
                        +
                    </button>
                </div>
                {/* Right: filter dropdown + message count */}
                <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5">
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">
                        {teamFilterUserId ? tc.msgsFiltered(teamShownCount, teamTotalCount) : tc.msgs(teamShownCount)}
                    </span>
                    <div className="relative" data-filter="team">
                        <button
                            type="button"
                            onClick={() => setShowTeamFilterDropdown(v => !v)}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                                teamFilterUserId
                                    ? 'border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-fg)]'
                                    : 'border-[var(--color-line-soft)] bg-transparent text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-muted)]'
                            }`}
                            title="Set tab filter"
                        >
                            <FilterIcon />
                            <span className="text-[8px] leading-none">▾</span>
                        </button>
                        {showTeamFilterDropdown && (
                            <div className="lp-scroll absolute right-0 top-full z-30 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
                                <button
                                    type="button"
                                    onClick={() => { setTeamFilterUserId(null); setShowTeamFilterDropdown(false) }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                >
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-line-soft)] text-[var(--color-fg-subtle)]">
                                        <PeopleIcon />
                                    </span>
                                    <span>{tc.allPeople}</span>
                                    {!teamFilterUserId && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                </button>
                                {teamPeopleList.length > 0 && <div className="border-t border-[var(--color-line-soft)]" />}
                                {teamPeopleList.map(p => {
                                    const isMe = p.id === user?.id
                                    const initial = (p.first_name?.[0] || 'U').toUpperCase()
                                    const isActive = teamFilterUserId === p.id
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => { setTeamFilterUserId(p.id); setShowTeamFilterDropdown(false) }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                        >
                                            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold ${isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}>
                                                {initial}
                                            </span>
                                            <span className="truncate">{isMe ? `${p.first_name} ${tc.youSuffix}` : p.first_name}</span>
                                            {isActive && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
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
                        const displayName = isMe ? tc.you : (profile?.first_name || 'User')
                        const avatarLetter = (displayName[0] || 'U').toUpperCase()
                        const isSideMessage = msg.included_in_context === false
                        return (
                            <div key={msg.id} className={`flex items-start gap-3 lp-fade-in ${isMe ? 'flex-row-reverse rtl:flex-row' : 'rtl:flex-row-reverse'}`}>
                                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}>
                                    {avatarLetter}
                                </div>
                                <div className={`min-w-0 max-w-[88%] ${isMe ? 'items-end rtl:items-start' : 'items-start rtl:items-end'} flex flex-col`}>
                                    <span className={`mb-1 text-[11px] text-[var(--color-fg-subtle)] ${isMe ? 'text-right' : 'rtl:text-left'}`}>{displayName}</span>
                                    {isSideMessage && (
                                        <SideContextBadge msg={msg} align={isMe ? "end" : "start"} />
                                    )}
                                    <Message
                                        text={msg.content}
                                        attachments={msg.attachments}
                                        isMe={isMe}
                                        invitedLLMs={invitedLLMs}
                                        profilesById={profilesById}
                                        deletedAt={msg.deleted_at}
                                        editedAt={msg.edited_at}
                                        canEdit={isMe && !msg.deleted_at}
                                        onEdit={(next) => handleEditMessage(msg, next)}
                                        onDelete={() => handleDeleteMessage(msg)}
                                    />
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
    const workspaceFilterLLM = workspaceFilterLLMId ? invitedLLMs.find(l => l.id === workspaceFilterLLMId) : null
    const workspaceFilterColor = workspaceFilterLLM ? getLLMColor(workspaceFilterLLM.display_number) : null
    const modelsPane = (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            {/* Chrome-style tab bar */}
            <div className="flex items-end border-b border-[var(--color-line-soft)] bg-[var(--color-surface-2)]">
                {/* Scrollable tab strip */}
                <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
                    {workspaceTabs.map(tab => {
                        const isActive = tab.id === activeTabId
                        const tabLLM = tab.filterId ? invitedLLMs.find(l => l.id === tab.filterId) : null
                        const tabColor = tabLLM ? getLLMColor(tabLLM.display_number) : null
                        const hasPending = tabLLM ? !!pendingLLMs[tabLLM.id] : Object.keys(pendingLLMs).length > 0
                        const isDragOver = dragOverTabId === tab.id && dragTabId !== tab.id
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                draggable
                                onDragStart={() => setDragTabId(tab.id)}
                                onDragEnd={() => { setDragTabId(null); setDragOverTabId(null) }}
                                onDragOver={e => { e.preventDefault(); setDragOverTabId(tab.id) }}
                                onDrop={() => {
                                    if (!dragTabId || dragTabId === tab.id) return
                                    setWorkspaceTabs(prev => {
                                        const from = prev.findIndex(t => t.id === dragTabId)
                                        const to = prev.findIndex(t => t.id === tab.id)
                                        const next = [...prev]
                                        next.splice(to, 0, next.splice(from, 1)[0])
                                        return next
                                    })
                                    setDragTabId(null)
                                    setDragOverTabId(null)
                                }}
                                onClick={() => setActiveTabId(tab.id)}
                                className={`group relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[11px] font-medium transition-colors ${
                                    isActive
                                        ? 'rounded-t-lg border border-b-0 border-[var(--color-line-soft)] bg-[var(--color-surface-1)] text-[var(--color-fg)] -mb-px'
                                        : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]'
                                } ${isDragOver ? 'border-l-2 border-l-[var(--color-brand)]' : ''}`}
                            >
                                {tabLLM ? (
                                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[7px] font-bold ${tabColor.avatarBg} ${tabColor.avatarText}`}>
                                        {getLLMInitials(tabLLM.display_name)}
                                    </span>
                                ) : (
                                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--color-line-soft)] text-[var(--color-fg-subtle)]">
                                        <BotIcon />
                                    </span>
                                )}
                                <span className="max-w-[7rem] truncate">
                                    {tabLLM ? tabLLM.display_name : tc.allTab}
                                </span>
                                {hasPending && (
                                    <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${tabColor ? tabColor.avatarBg : 'bg-[var(--color-fg-subtle)]'}`} />
                                )}
                                {workspaceTabs.length > 1 && (
                                    <span
                                        role="button"
                                        onClick={(e) => closeWorkspaceTab(tab.id, e)}
                                        className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--color-surface-3)] hover:text-rose-400 hover:!opacity-100 group-hover:opacity-50"
                                    >
                                        <XIcon size={8} />
                                    </span>
                                )}
                            </button>
                        )
                    })}
                    {/* + new tab */}
                    <button
                        type="button"
                        onClick={addWorkspaceTab}
                        className="flex h-8 w-7 shrink-0 items-center justify-center self-center text-base text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                        title="New tab"
                    >
                        +
                    </button>
                </div>

                {/* Right controls: per-tab filter + invite */}
                <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5">
                    <div className="relative" data-filter="workspace">
                        <button
                            type="button"
                            onClick={() => setShowWorkspaceFilterDropdown(v => !v)}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                                workspaceFilterLLMId
                                    ? `${workspaceFilterColor?.softBorder || 'border-[var(--color-line)]'} ${workspaceFilterColor?.softBg || ''} ${workspaceFilterColor?.text || ''}`
                                    : 'border-[var(--color-line-soft)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg-muted)]'
                            }`}
                            title="Filter this tab"
                        >
                            <FilterIcon />
                            <span className="max-w-[7rem] truncate">
                                {workspaceFilterLLM ? workspaceFilterLLM.display_name : tc.allModels}
                            </span>
                            <span className="text-[8px]">▾</span>
                        </button>
                        {showWorkspaceFilterDropdown && (
                            <div className="lp-scroll absolute right-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
                                <button
                                    type="button"
                                    onClick={() => { setWorkspaceFilterLLMId(null); setShowWorkspaceFilterDropdown(false) }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                >
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-line-soft)] text-[var(--color-fg-subtle)]"><BotIcon /></span>
                                    <span>{tc.allModels}</span>
                                    {!workspaceFilterLLMId && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                </button>
                                {invitedLLMs.length > 0 && <div className="border-t border-[var(--color-line-soft)]" />}
                                {invitedLLMs.map(llm => {
                                    const c = getLLMColor(llm.display_number)
                                    return (
                                        <button
                                            key={llm.id}
                                            type="button"
                                            onClick={() => { setWorkspaceFilterLLMId(llm.id); setShowWorkspaceFilterDropdown(false) }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                        >
                                            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold ${c.avatarBg} ${c.avatarText}`}>
                                                {getLLMInitials(llm.display_name)}
                                            </span>
                                            <span className="truncate">{llm.display_name}</span>
                                            {workspaceFilterLLMId === llm.id && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setInviteLLMpop(true)}
                        className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] whitespace-nowrap"
                    >
                        {tc.inviteModel}
                    </button>
                </div>
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
                            const isSideMessage = msg.included_in_context === false

                            if (isJoinMessage) {
                                return (
                                    <div key={msg.id} className="flex items-center justify-center py-1 lp-fade-in">
                                        <span className={`rounded-full border ${c.softBorder} ${c.softBg} px-3 py-1 text-[11px] ${c.text}`}>
                                            {tc.joinedWorkspace(llmInfo?.display_name || '')}
                                        </span>
                                    </div>
                                )
                            }

                            // If this exact message is being regenerated, render
                            // the streaming UI in-place so the user sees the
                            // single bubble transition through thinking → tokens
                            // → final content.
                            const pendingForLlm = pendingLLMs[msg.sender_llm_id]
                            const isRegenerating = pendingForLlm?.replaceMessageId === msg.id
                            const streamingText = isRegenerating ? (pendingForLlm?.text || "") : ""
                            const hasStreamingText = streamingText.length > 0

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
                                                    #{llmInfo?.display_number}
                                                </span>
                                            </span>
                                        </button>
                                        <div className="flex items-center gap-2">
                                            {isSideMessage && (
                                                <SideContextBadge msg={msg} />
                                            )}
                                            {isRegenerating ? (
                                                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                                                    {hasStreamingText ? tc.streaming : tc.thinking}
                                                </span>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => handleRegenerateAI(msg)}
                                                        disabled={!!pendingLLMs[msg.sender_llm_id]}
                                                        className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)] disabled:opacity-40"
                                                        title="Regenerate reply"
                                                    >
                                                        <RefreshIcon size={12} />
                                                    </button>
                                                    <span className="text-[10px] text-[var(--color-fg-subtle)]">
                                                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </header>
                                    {isRegenerating ? (
                                        hasStreamingText ? (
                                            <div className="whitespace-pre-wrap break-words px-4 py-3 text-sm text-[var(--color-fg)]">
                                                {streamingText}
                                                <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-[var(--color-fg-subtle)]" />
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5 px-4 py-4">
                                                <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} />
                                                <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} style={{ animationDelay: '0.16s' }} />
                                                <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} style={{ animationDelay: '0.32s' }} />
                                            </div>
                                        )
                                    ) : (
                                        <div className="px-4 py-3">
                                            <AIMessage text={msg.content} />
                                        </div>
                                    )}
                                </article>
                            )
                        })}

                        {/* Pending placeholders — thinking dots while the LLM is
                            working on a fresh reply. Skipped for regenerations
                            (those render in-place inside the existing bubble). */}
                        {Object.entries(pendingLLMs).map(([llmId, state]) => {
                            if (state?.replaceMessageId) return null
                            const llm = invitedLLMs.find(l => l.id === llmId)
                            if (!llm) return null
                            const c = getLLMColor(llm.display_number)
                            const text = (state && state.text) || ""
                            const hasText = text.length > 0
                            return (
                                <article
                                    key={`pending-${llmId}`}
                                    className={`overflow-hidden rounded-2xl border ${c.softBorder} bg-[var(--color-surface-2)] lp-fade-in`}
                                >
                                    <header className="flex items-center gap-2.5 border-b border-[var(--color-line-soft)] px-4 py-2.5">
                                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${c.avatarBg} text-[10px] font-semibold ${c.avatarText}`}>
                                            {getLLMInitials(llm.display_name)}
                                        </span>
                                        <span className={`text-sm font-medium ${c.text}`}>{llm.display_name}</span>
                                        <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">{hasText ? tc.streaming : tc.thinking}</span>
                                        <button
                                            onClick={stopGeneration}
                                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 hover:text-rose-200"
                                            title="Stop generation"
                                        >
                                            <span className="h-2 w-2 rounded-sm bg-rose-300" />
                                            {tc.stop}
                                        </button>
                                    </header>
                                    {hasText ? (
                                        <div className="whitespace-pre-wrap break-words px-4 py-3 text-sm text-[var(--color-fg)]">
                                            {text}
                                            <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-[var(--color-fg-subtle)]" />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 px-4 py-4">
                                            <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} />
                                            <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} style={{ animationDelay: '0.16s' }} />
                                            <span className={`h-1.5 w-1.5 rounded-full ${c.dot} lp-dot`} style={{ animationDelay: '0.32s' }} />
                                        </div>
                                    )}
                                </article>
                            )
                        })}
                    </>
                )}
            </div>
        </section>
    )

    /* ---------- Planner panes ---------- */
    const calendarPane = (
        <Calendar
            selectedKey={selectedDate}
            onSelect={setSelectedDate}
            hasNote={(key) => !!notes[key] && notes[key].trim() !== ""}
        />
    )

    const dailyPane = (
        <DailyNote
            dateKey={selectedDate}
            value={notes[selectedDate] || ""}
            onChange={updateNote}
        />
    )

    /* ---------- Files pane ---------- */
    const filesPane = (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    {tc.files}
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                    {tc.fileCount(generatedFiles.length)}
                </span>
            </div>
            <div className="lp-scroll flex-1 space-y-2 overflow-y-auto px-4 py-4">
                {generatedFiles.length === 0 ? (
                    <EmptyFiles />
                ) : (
                    generatedFiles.map(f => {
                        const llm = f.sender_llm_id ? invitedLLMs.find(l => l.id === f.sender_llm_id) : null
                        const c = llm ? getLLMColor(llm.display_number) : null
                        return (
                            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-3">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-3)] text-[10px] font-semibold uppercase text-[var(--color-fg-muted)]">
                                    {f.ext}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm text-[var(--color-fg)]">{f.name}</div>
                                    <div className="text-[10px] text-[var(--color-fg-subtle)]">
                                        {llm && c && (<><span className={c.text}>{llm.display_name}</span> · </>)}
                                        {fileTimeAgo(f.created_at, tc)}
                                    </div>
                                </div>
                                <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg border border-[var(--color-line)] px-3 py-1 text-[11px] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                                >
                                    {tc.openFile}
                                </a>
                            </div>
                        )
                    })
                )}
            </div>
        </section>
    )

    return (
        <div className="relative flex h-full w-full flex-col bg-[var(--color-canvas)]">
            {/* Modals */}
            {deleteMessageTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-sm mx-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6 shadow-2xl">
                        <div className="mb-3 flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
                                <TrashIcon />
                            </span>
                            <div className="min-w-0">
                                <p className="text-base font-semibold text-[var(--color-fg)]">{tc.deleteTitle}</p>
                                <p className="truncate text-xs text-[var(--color-fg-muted)]">
                                    {(deleteMessageTarget.content || "").slice(0, 80) || "(empty)"}
                                </p>
                            </div>
                        </div>
                        <p className="mb-5 text-sm text-[var(--color-fg-muted)]">
                            {tc.deleteDesc}
                        </p>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={() => !deleteMessagePending && setDeleteMessageTarget(null)}
                                disabled={deleteMessagePending}
                                className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-40"
                            >
                                {tc.cancel}
                            </button>
                            <button
                                onClick={confirmDeleteMessage}
                                disabled={deleteMessagePending}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:opacity-40"
                            >
                                {deleteMessagePending ? tc.deleting : tc.deleteConfirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
            {contextUser && (
                <UserContext
                    profile={contextUser}
                    isMe={contextUser.id === user?.id}
                    messages={messages}
                    onClose={() => setContextUser(null)}
                />
            )}

            {topBar}

            {/* Mobile group + tab toggle */}
            <div className="flex items-center border-b border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:hidden">
                <div className="flex items-center gap-0.5 rounded-lg border border-[var(--color-line)] p-0.5 m-2">
                    <GroupBtn active={viewGroup === 'chat'} onClick={() => setViewGroup('chat')} icon={<ChatBubbleIcon />}>{tc.chatGroup}</GroupBtn>
                    {canAccessPlanner && (
                        <GroupBtn active={viewGroup === 'planner'} onClick={() => setViewGroup('planner')} icon={<CalendarIcon />}>{tc.plannerGroup}</GroupBtn>
                    )}
                </div>
                <div className="flex flex-1">
                    {GROUP_KEYS[viewGroup].filter(k => openPanels[k]).map(k => (
                        <TabBtn key={k} active={mobileTab === k} onClick={() => setMobileTab(k)}>
                            {PANEL_LABELS[k]}
                            {k === 'models' && Object.keys(pendingLLMs).length > 0 && (
                                <span className="ml-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 lp-dot" />
                            )}
                        </TabBtn>
                    ))}
                </div>
            </div>

            {/* Multi-pane layout */}
            {(() => {
                const paneNodes = {
                    team: teamPane,
                    models: modelsPane,
                    files: filesPane,
                    calendar: calendarPane,
                    daily: dailyPane,
                }
                const panels = GROUP_KEYS[viewGroup]
                    .filter(k => openPanels[k])
                    .map(k => ({ key: k, node: paneNodes[k] }))

                return (
                    <div ref={splitRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
                        {panels.map((p, i) => (
                            <Fragment key={p.key}>
                                <div
                                    className={`min-h-0 min-w-0 w-full flex-1 md:flex md:grow-0 md:shrink md:basis-[var(--panel-w)] md:min-w-[18rem] ${mobileTab === p.key ? 'flex' : 'hidden md:flex'}`}
                                    style={{ '--panel-w': `${panelWidths[p.key]}%` }}
                                >
                                    {p.node}
                                </div>
                                {i < panels.length - 1 && (
                                    <div
                                        onMouseDown={handleSplitDragStart(i)}
                                        role="separator"
                                        aria-orientation="vertical"
                                        aria-label="Resize panes"
                                        className={`hidden md:block w-1 shrink-0 cursor-col-resize transition-colors ${
                                            isResizing ? 'bg-[var(--color-fg-subtle)]' : 'bg-[var(--color-line-soft)] hover:bg-[var(--color-fg-subtle)]'
                                        }`}
                                    />
                                )}
                            </Fragment>
                        ))}
                    </div>
                )
            })()}
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

function FeatureAction({ active, activeClass = "", icon, label, popoverTitle, popoverText, onClick }) {
    const baseClass = active
        ? (activeClass || 'border-[var(--color-fg-subtle)] bg-[var(--color-surface-3)] text-[var(--color-fg)]')
        : 'border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]'

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onClick}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${baseClass}`}
            >
                {icon}
                {label}
            </button>
            {popoverTitle && popoverText && (
                <div className="pointer-events-none absolute bottom-10 left-0 z-40 hidden w-60 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-left shadow-2xl group-hover:block group-focus-within:block">
                    <div className="text-xs font-medium text-[var(--color-fg)]">{popoverTitle}</div>
                    <div className="mt-1 text-[10px] leading-4 text-[var(--color-fg-subtle)]">{popoverText}</div>
                </div>
            )}
        </div>
    )
}

function FeatureMoreItem({ icon, label, detail, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick ?? (() => {})}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--color-surface-3)]"
        >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--color-line-soft)] text-[var(--color-fg-muted)]">
                {icon}
            </span>
            <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--color-fg)]">{label}</span>
                <span className="block truncate text-[10px] text-[var(--color-fg-subtle)]">{detail}</span>
            </span>
        </button>
    )
}

function EmptyTeam() {
    const { t } = useLanguage()
    const tc = t.chat
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-1)] text-[var(--color-fg-muted)]">
                <ChatIcon />
            </div>
            <p className="text-sm font-medium text-[var(--color-fg)]">{tc.startConversation}</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--color-fg-muted)]">
                {tc.startConversationDesc}
            </p>
        </div>
    )
}

function EmptyModels({ onInvite, hasModels }) {
    const { t } = useLanguage()
    const tc = t.chat
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
                <BotIcon />
            </div>
            <p className="text-sm font-medium text-[var(--color-fg)]">
                {hasModels ? tc.mentionModel : tc.noModels}
            </p>
            <p className="mt-1 max-w-xs text-xs text-[var(--color-fg-muted)]">
                {hasModels ? tc.mentionModelDesc : tc.noModelsDesc}
            </p>
            {!hasModels && (
                <button
                    onClick={onInvite}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-[var(--color-brand)]"
                >
                    {tc.inviteModelBtn}
                </button>
            )}
        </div>
    )
}

/* ---------------- Layout helpers ---------------- */
function GroupBtn({ children, icon, active, onClick }) {
    return (
        <button
            onClick={onClick}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-muted)]"
            }`}
        >
            {icon}
            {children}
        </button>
    )
}
function PanelToggleBtn({ children, active, onClick, label }) {
    return (
        <button
            onClick={onClick}
            title={`${active ? "Hide" : "Show"} ${label}`}
            aria-label={`${active ? "Hide" : "Show"} ${label}`}
            aria-pressed={active}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                active
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-muted)]"
            }`}
        >
            {children}
        </button>
    )
}
function EmptyFiles() {
    const { t } = useLanguage()
    const tc = t.chat
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]">
                <FileIcon />
            </span>
            <p className="mt-3 text-sm text-[var(--color-fg-muted)]">{tc.noFiles}</p>
            <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">{tc.noFilesDesc}</p>
        </div>
    )
}
function fileTimeAgo(iso, tc) {
    if (!iso) return ""
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (seconds < 60) return tc.justNow
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return tc.minutesAgo(minutes)
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return tc.hoursAgo(hours)
    const days = Math.floor(hours / 24)
    return tc.daysAgo(days)
}

export default Chat
