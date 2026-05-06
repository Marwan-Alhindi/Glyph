import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react"
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
import Agent from "./plannerView/Agent"
import {
    SendIcon, TargetIcon, FeatureIcon, SideAskIcon, MoreIcon, AttachIcon,
    WebIcon, VoiceIcon, ExportIcon, RefreshIcon, BotIcon, UserPlusIcon,
    PeopleIcon, FilterIcon, TrashIcon, FileIcon, CalendarIcon, NoteIcon,
    AgentIcon, ChatBubbleIcon, ChatIcon,
} from "./Icons"
import { supabase, API_BASE } from "../../services/supabase"
import { useAuth } from "../../contexts/AuthContext"
import { getLLMColor, getLLMInitials, getPersonColor, modelTypeLabel } from "../utils/llmColors"
import { findMentions, isMentionPrefix } from "../utils/mentions"

const GROUP_KEYS = {
    chat: ['team', 'models', 'files'],
    planner: ['calendar', 'daily', 'agent'],
}
const PANEL_LABELS = {
    team: 'Team chat',
    models: 'Workspace',
    files: 'Files',
    calendar: 'Calendar',
    daily: 'Daily note',
    agent: 'Agent',
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
            detail: modelTypeLabel(target.llm.model_type),
        }
    }
    return {
        initials: (target.display_name?.[0] || 'U').toUpperCase(),
        detail: 'teammate',
    }
}

function Chat({ chatId }) {
    const [pendingLLMs, setPendingLLMs] = useState({}) // { llmId: true }
    const handleLLMReply = useCallback((fullMsg) => {
        setPendingLLMs(prev => {
            const next = { ...prev }
            delete next[fullMsg.sender_llm_id]
            return next
        })
    }, [])
    const {
        chatName,
        messages, setMessages,
        invitedLLMs, setInvitedLLMs,
        profilesById,
        loading,
    } = useChatMessages(chatId, { onLLMReply: handleLLMReply })

    const [inputText, setInputText] = useState("")
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
    const [teamFilterUserId, setTeamFilterUserId] = useState(null)
    const [workspaceFilterLLMId, setWorkspaceFilterLLMId] = useState(null)
    const [showTeamFilterDropdown, setShowTeamFilterDropdown] = useState(false)
    const [showWorkspaceFilterDropdown, setShowWorkspaceFilterDropdown] = useState(false)
    const [panelWidths, setPanelWidths] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("glyph.panelWidths") || "null")
            if (saved && typeof saved === "object") {
                return {
                    team: saved.team ?? 47,
                    models: saved.models ?? 53,
                    files: saved.files ?? 0,
                    calendar: saved.calendar ?? 24,
                    daily: saved.daily ?? 42,
                    agent: saved.agent ?? 34,
                }
            }
            // Migrate from the older two-pane key
            const oldTeamPct = parseFloat(localStorage.getItem("glyph.teamWidthPct"))
            if (Number.isFinite(oldTeamPct) && oldTeamPct >= 20 && oldTeamPct <= 80) {
                return { team: oldTeamPct, models: 100 - oldTeamPct, files: 0, calendar: 24, daily: 42, agent: 34 }
            }
        } catch {
            // Ignore malformed saved layout preferences.
        }
        return { team: 47, models: 53, files: 0, calendar: 24, daily: 42, agent: 34 }
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
                    agent: saved.agent !== false,
                }
            }
        } catch {
            // Ignore malformed saved panel preferences.
        }
        return { team: true, models: true, files: false, calendar: true, daily: true, agent: true }
    })
    const [viewGroup, setViewGroup] = useState(() => {
        const saved = localStorage.getItem("glyph.viewGroup")
        return saved === "planner" ? "planner" : "chat"
    })
    const { user, session } = useAuth()
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

    async function handleSendMessage() {
        if (!inputText.trim()) return
        const text = inputText
        const isSideAsk = sideAskActive
        const manualMentions = findMentions(text, mentionables)
        const effectiveTarget = manualMentions.length === 0 ? stickyMentionTarget : null
        const messageText = effectiveTarget ? `@${effectiveTarget.display_name} ${text}` : text
        setInputText("")
        setShowMentionDropdown(false)
        setShowStickyTargetDropdown(false)

        const { data: newMsg, error: msgError } = await supabase
            .from("messages")
            .insert({
                chat_id: chatId,
                sender_type: "user",
                sender_user_id: user.id,
                content: messageText,
                included_in_context: !isSideAsk
            })
            .select("*, invited_llms(id, display_name, display_number, model_type)")
            .single()

        if (msgError) {
            console.error("Message insert error:", msgError)
            alert("Failed to send message: " + msgError.message)
            setInputText(text)
            setSideAskActive(isSideAsk)
            return
        }

        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])

        // Only model mentions trigger a stream; person mentions stay in the team thread.
        const mentioned = findMentions(messageText, mentionables).filter(m => m.kind === 'llm')
        const targetLLMs = mentioned.length > 0 ? [mentioned[0].target] : []

        for (const llm of targetLLMs) {
            await streamLLMReply(llm, null, isSideAsk ? newMsg.id : null)
        }
    }

    async function streamLLMReply(llm, replaceMessageId = null, sideMessageId = null) {
        setPendingLLMs(prev => ({ ...prev, [llm.id]: { text: "", replaceMessageId, sideMessageId } }))
        try {
            const res = await fetch(`${API_BASE}/askLLM`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
                body: JSON.stringify({
                    chat_id: chatId,
                    llm_id: llm.id,
                    ...(replaceMessageId ? { replace_message_id: replaceMessageId } : {}),
                    ...(sideMessageId ? { side_message_id: sideMessageId } : {}),
                })
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error("Backend ask error:", err)
                alert("LLM error: " + (err.detail || res.statusText))
                setPendingLLMs(prev => { const n = { ...prev }; delete n[llm.id]; return n })
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
                    if (data.type === "token") {
                        setPendingLLMs(prev => {
                            const cur = prev[llm.id]
                            if (!cur) return prev
                            return { ...prev, [llm.id]: { ...cur, text: cur.text + data.content } }
                        })
                    } else if (data.type === "error") {
                        console.error("Stream error:", data.detail)
                        alert("LLM error: " + (data.detail || "stream failed"))
                        setPendingLLMs(prev => { const n = { ...prev }; delete n[llm.id]; return n })
                    } else if (data.type === "done") {
                        // For new messages the INSERT realtime push also clears
                        // pending — but for regenerations the backend UPDATEs the
                        // existing row (no INSERT), so 'done' is the reliable signal.
                        setPendingLLMs(prev => { const n = { ...prev }; delete n[llm.id]; return n })
                    }
                    // 'tool' events: client just renders progress; nothing to do here.
                }
            }
        } catch (err) {
            console.error("Ask fetch error:", err)
            alert(`Could not reach backend at ${API_BASE}: ${err.message}`)
            setPendingLLMs(prev => { const n = { ...prev }; delete n[llm.id]; return n })
        }
    }

    async function handleEditMessage(msg, newContent) {
        const nowIso = new Date().toISOString()
        const prevSnapshot = { content: msg.content, edited_at: msg.edited_at }
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: newContent, edited_at: nowIso } : m))
        const { error } = await supabase
            .from("messages")
            .update({ content: newContent, edited_at: nowIso })
            .eq("id", msg.id)
            .eq("sender_user_id", user.id)
        if (error) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...prevSnapshot } : m))
            alert("Failed to edit message: " + error.message)
            return false
        }
        return true
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
        const { error } = await supabase
            .from("messages")
            .update({ deleted_at: nowIso })
            .eq("id", msg.id)
            .eq("sender_user_id", user.id)
        if (error) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, deleted_at: prevDeletedAt } : m))
            alert("Failed to delete message: " + error.message)
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
        const { error } = await supabase
            .from("messages")
            .update({ included_in_context: true })
            .in("id", idsToInclude)
            .eq("chat_id", chatId)
        if (error) {
            console.error("Failed to add message to context:", error)
            setMessages(prev => prev.map(m => idsToInclude.includes(m.id) ? { ...m, included_in_context: false } : m))
            alert("Failed to add message to context: " + error.message)
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
            const deltaPx = e.clientX - activeResize.startX
            const deltaPct = (deltaPx / rect.width) * 100
            const MIN = 15
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

    // Reset filters if the selected target is no longer present
    useEffect(() => {
        if (teamFilterUserId && !profilesById[teamFilterUserId]) setTeamFilterUserId(null)
    }, [teamFilterUserId, profilesById])
    useEffect(() => {
        if (workspaceFilterLLMId && !invitedLLMs.some(l => l.id === workspaceFilterLLMId)) {
            setWorkspaceFilterLLMId(null)
        }
    }, [workspaceFilterLLMId, invitedLLMs])

    // Close filter dropdowns on outside click / Escape
    useEffect(() => {
        if (!showTeamFilterDropdown && !showWorkspaceFilterDropdown) return
        function onDown(e) {
            if (showTeamFilterDropdown && !e.target.closest?.('[data-filter="team"]')) {
                setShowTeamFilterDropdown(false)
            }
            if (showWorkspaceFilterDropdown && !e.target.closest?.('[data-filter="workspace"]')) {
                setShowWorkspaceFilterDropdown(false)
            }
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
    const { teamMessages, modelMessages, teamMessagesAll, modelMessagesAll } = useMemo(() => {
        const teamAll = []
        const modelAll = []
        for (const msg of messages) {
            if (msg.sender_type === 'llm') modelAll.push(msg)
            else teamAll.push(msg)
        }
        const team = teamFilterUserId
            ? teamAll.filter(m => m.sender_user_id === teamFilterUserId)
            : teamAll
        const model = workspaceFilterLLMId
            ? modelAll.filter(m => m.sender_llm_id === workspaceFilterLLMId)
            : modelAll
        return { teamMessages: team, modelMessages: model, teamMessagesAll: teamAll, modelMessagesAll: modelAll }
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
                    <span className="ml-2">Loading conversation…</span>
                </div>
            </div>
        )
    }

    /* ---------- Mention dropdown (rendered above input) ---------- */
    const noMatches = filteredMentions.people.length === 0 && filteredMentions.llms.length === 0
    const mentionDropdown = showMentionDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl lp-scroll">
            {noMatches && (
                <div className="px-3 py-2 text-xs text-[var(--color-fg-subtle)]">No matches — invite someone below</div>
            )}

            {filteredMentions.people.length > 0 && (
                <>
                    <div className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        People
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
                                <span className={`text-xs ${c.text}`}>· teammate</span>
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
                        Models
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
                                <span className="text-xs text-[var(--color-fg-subtle)]">· {modelTypeLabel(llm.model_type)}</span>
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

    const stickyTargetDropdown = showStickyTargetDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl lp-scroll">
            <div className="border-b border-[var(--color-line-soft)] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    Always Send To
                </div>
                <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                    Applies only when the message has no manual @mention.
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
                        <span className="text-[var(--color-fg)]">Turn off default target</span>
                        <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">Currently @{stickyMentionTarget.display_name}</span>
                    </button>
                </div>
            )}

            {mentionGroups.people.length === 0 && mentionGroups.llms.length === 0 && (
                <div className="px-3 py-3 text-xs text-[var(--color-fg-subtle)]">
                    Invite a teammate or model first.
                </div>
            )}

            {mentionGroups.people.length > 0 && (
                <>
                    <div className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        People
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
                                        On
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
                        Models
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
                                        On
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
                    Always sending to <span className={`font-medium ${stickyMentionColor.text}`}>@{stickyMentionTarget.display_name}</span>
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
            <span className="truncate text-xs font-medium">Ask Side is on</span>
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
            <span>Not in context</span>
            <button
                onClick={() => includeMessageInContext(msg)}
                className="rounded-full px-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                title="Add this message back to context"
            >
                Add
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
                label="Always"
                popoverTitle="Always send to"
                popoverText="Pick a default person or model for messages that do not include a manual @mention."
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
                label="Ask Side"
                popoverTitle="Ask Side"
                popoverText="Keep side questions and answers visible, but exclude them from future model context."
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
                label="More"
                onClick={() => setShowFeatureMore(v => !v)}
            />
            {showFeatureMore && (
                <div className="absolute bottom-11 right-0 w-52 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] py-1 shadow-2xl">
                    <FeatureMoreItem icon={<AttachIcon />} label="Attach file" detail="Placeholder" />
                    <FeatureMoreItem icon={<WebIcon />} label="Web search" detail="Placeholder" />
                    <FeatureMoreItem icon={<VoiceIcon />} label="Voice note" detail="Placeholder" />
                    <div className="my-1 border-t border-[var(--color-line-soft)]" />
                    <FeatureMoreItem icon={<ExportIcon />} label="Export chat" detail="Placeholder" />
                </div>
            )}
        </div>
    )

    /* ---------- Input ---------- */
    const inputBar = (
        <div className="border-t border-[var(--color-line-soft)] bg-[var(--color-surface-1)] px-4 py-3">
            <div ref={composerRef} className="relative">
                {mentionDropdown}
                {stickyTargetDropdown}
                {activeFeatureStrips}
                <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 transition-colors focus-within:border-[var(--color-fg-subtle)]">
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
                        placeholder="Message your team — type @ to mention people or models"
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
            </div>

            <div className="flex items-center gap-2">
                <div className="hidden items-center gap-0.5 rounded-lg border border-[var(--color-line)] p-0.5 md:flex">
                    <GroupBtn active={viewGroup === 'chat'} onClick={() => setViewGroup('chat')} icon={<ChatBubbleIcon />}>Chat</GroupBtn>
                    <GroupBtn active={viewGroup === 'planner'} onClick={() => setViewGroup('planner')} icon={<CalendarIcon />}>Planner</GroupBtn>
                </div>
                <div className="hidden items-center gap-0.5 rounded-lg border border-[var(--color-line)] p-0.5 md:flex">
                    {viewGroup === 'chat' ? (
                        <>
                            <PanelToggleBtn active={openPanels.team} onClick={() => togglePanel('team')} label="Team chat"><PeopleIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.models} onClick={() => togglePanel('models')} label="Workspace"><BotIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.files} onClick={() => togglePanel('files')} label="Files"><FileIcon /></PanelToggleBtn>
                        </>
                    ) : (
                        <>
                            <PanelToggleBtn active={openPanels.calendar} onClick={() => togglePanel('calendar')} label="Calendar"><CalendarIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.daily} onClick={() => togglePanel('daily')} label="Daily note"><NoteIcon /></PanelToggleBtn>
                            <PanelToggleBtn active={openPanels.agent} onClick={() => togglePanel('agent')} label="Agent"><AgentIcon /></PanelToggleBtn>
                        </>
                    )}
                </div>
                {viewGroup === 'chat' && (
                    <div className="flex items-center gap-1">
                        <IconBtn label="Invite model" onClick={() => setInviteLLMpop(true)}><BotIcon /></IconBtn>
                        <IconBtn label="Invite teammate" onClick={() => setShowInviteUser(true)}><UserPlusIcon /></IconBtn>
                    </div>
                )}
            </div>
        </div>
    )

    /* ---------- Team pane (left) ---------- */
    const teamFilterPerson = teamFilterUserId ? profilesById[teamFilterUserId] : null
    const teamShownCount = teamMessages.filter(m => m.sender_type === 'user').length
    const teamTotalCount = teamMessagesAll.filter(m => m.sender_type === 'user').length
    const teamPane = (
        <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        Team chat
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
                            title="Filter by person"
                        >
                            <FilterIcon />
                            <span className="max-w-[8rem] truncate">
                                {teamFilterPerson
                                    ? (teamFilterUserId === user?.id ? `${teamFilterPerson.first_name} (you)` : teamFilterPerson.first_name)
                                    : 'All people'}
                            </span>
                            <span className="text-[8px] leading-none">▾</span>
                        </button>
                        {showTeamFilterDropdown && (
                            <div className="lp-scroll absolute left-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
                                <button
                                    type="button"
                                    onClick={() => { setTeamFilterUserId(null); setShowTeamFilterDropdown(false) }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                >
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-line-soft)] text-[var(--color-fg-subtle)]">
                                        <PeopleIcon />
                                    </span>
                                    <span>All people</span>
                                    {!teamFilterUserId && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                </button>
                                {teamPeopleList.length > 0 && (
                                    <div className="border-t border-[var(--color-line-soft)]" />
                                )}
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
                                            <span className="truncate">{isMe ? `${p.first_name} (you)` : p.first_name}</span>
                                            {isActive && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                    {teamFilterUserId ? `${teamShownCount} of ${teamTotalCount}` : `${teamShownCount}`} messages
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
                        const isSideMessage = msg.included_in_context === false
                        return (
                            <div key={msg.id} className={`flex items-start gap-3 lp-fade-in ${isMe ? 'flex-row-reverse' : ''}`}>
                                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${isMe ? 'bg-gradient-to-br from-emerald-400 to-sky-400 text-black' : 'bg-[var(--color-surface-3)] text-[var(--color-fg)]'}`}>
                                    {avatarLetter}
                                </div>
                                <div className={`min-w-0 max-w-[88%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                                    <span className={`mb-1 text-[11px] text-[var(--color-fg-subtle)] ${isMe ? 'text-right' : ''}`}>{displayName}</span>
                                    {isSideMessage && (
                                        <SideContextBadge msg={msg} align={isMe ? "end" : "start"} />
                                    )}
                                    <Message
                                        text={msg.content}
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
    const workspaceFilterLLM = workspaceFilterLLMId
        ? invitedLLMs.find(l => l.id === workspaceFilterLLMId)
        : null
    const workspaceFilterColor = workspaceFilterLLM ? getLLMColor(workspaceFilterLLM.display_number) : null
    const modelsPane = (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                        Workspace
                    </span>
                    <div className="relative" data-filter="workspace">
                        <button
                            type="button"
                            onClick={() => setShowWorkspaceFilterDropdown(v => !v)}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                                workspaceFilterLLMId
                                    ? `${workspaceFilterColor?.softBorder || 'border-[var(--color-line)]'} ${workspaceFilterColor?.softBg || 'bg-[var(--color-surface-2)]'} ${workspaceFilterColor?.text || 'text-[var(--color-fg)]'}`
                                    : 'border-[var(--color-line-soft)] bg-transparent text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-muted)]'
                            }`}
                            title="Filter by AI"
                        >
                            <FilterIcon />
                            <span className="max-w-[8rem] truncate">
                                {workspaceFilterLLM ? workspaceFilterLLM.display_name : 'All models'}
                            </span>
                            <span className="text-[8px] leading-none">▾</span>
                        </button>
                        {showWorkspaceFilterDropdown && (
                            <div className="lp-scroll absolute left-0 top-full z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
                                <button
                                    type="button"
                                    onClick={() => { setWorkspaceFilterLLMId(null); setShowWorkspaceFilterDropdown(false) }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface-3)]"
                                >
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-line-soft)] text-[var(--color-fg-subtle)]">
                                        <BotIcon />
                                    </span>
                                    <span>All models</span>
                                    {!workspaceFilterLLMId && <span className="ml-auto text-[var(--color-fg-subtle)]">✓</span>}
                                </button>
                                {invitedLLMs.length > 0 && (
                                    <div className="border-t border-[var(--color-line-soft)]" />
                                )}
                                {invitedLLMs.map(llm => {
                                    const c = getLLMColor(llm.display_number)
                                    const isActive = workspaceFilterLLMId === llm.id
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
                                            <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">
                                                {isActive ? '✓' : `#${llm.display_number}`}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {workspaceFilterLLMId && (
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                            {modelMessages.filter(m => m.kind !== 'join').length} of {modelMessagesAll.filter(m => m.kind !== 'join').length}
                        </span>
                    )}
                    <button
                        onClick={() => setInviteLLMpop(true)}
                        className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                    >
                        + Invite model
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
                                            {llmInfo?.display_name} joined the workspace
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
                                                    {modelTypeLabel(llmInfo?.model_type)} · #{llmInfo?.display_number}
                                                </span>
                                            </span>
                                        </button>
                                        <div className="flex items-center gap-2">
                                            {isSideMessage && (
                                                <SideContextBadge msg={msg} />
                                            )}
                                            {isRegenerating ? (
                                                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                                                    {hasStreamingText ? 'streaming…' : 'thinking…'}
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

                        {/* New-reply pending bubbles. Regen-pending is rendered
                            in-place above, so we skip entries with replaceMessageId. */}
                        {Object.entries(pendingLLMs).map(([llmId, state]) => {
                            if (state?.replaceMessageId) return null
                            const llm = invitedLLMs.find(l => l.id === llmId)
                            if (!llm) return null
                            const c = getLLMColor(llm.display_number)
                            const text = (state && state.text) || ""
                            const hasText = text.length > 0
                            const isSideReply = !!state?.sideMessageId
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
                                        {isSideReply && (
                                            <span className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)]">
                                                Not in context
                                            </span>
                                        )}
                                        <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">{hasText ? 'streaming…' : 'thinking…'}</span>
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
                                </div>
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

    const agentPane = <Agent chatId={chatId} notes={notes} />


    /* ---------- Files pane ---------- */
    const filesPane = (
        <section className="flex min-h-0 flex-1 flex-col border-[var(--color-line-soft)] bg-[var(--color-surface-1)] md:border-l">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    Files
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                    {generatedFiles.length} {generatedFiles.length === 1 ? 'file' : 'files'}
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
                                        {fileTimeAgo(f.created_at)}
                                    </div>
                                </div>
                                <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg border border-[var(--color-line)] px-3 py-1 text-[11px] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
                                >
                                    Open ↗
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
                                <p className="text-base font-semibold text-[var(--color-fg)]">Delete this message?</p>
                                <p className="truncate text-xs text-[var(--color-fg-muted)]">
                                    {(deleteMessageTarget.content || "").slice(0, 80) || "(empty)"}
                                </p>
                            </div>
                        </div>
                        <p className="mb-5 text-sm text-[var(--color-fg-muted)]">
                            Other participants will see a tombstone where this message used to be. The model won't see it on regeneration.
                        </p>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={() => !deleteMessagePending && setDeleteMessageTarget(null)}
                                disabled={deleteMessagePending}
                                className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-40"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteMessage}
                                disabled={deleteMessagePending}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:opacity-40"
                            >
                                {deleteMessagePending ? 'Deleting…' : 'Delete message'}
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
                    <GroupBtn active={viewGroup === 'chat'} onClick={() => setViewGroup('chat')} icon={<ChatBubbleIcon />}>Chat</GroupBtn>
                    <GroupBtn active={viewGroup === 'planner'} onClick={() => setViewGroup('planner')} icon={<CalendarIcon />}>Planner</GroupBtn>
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
                    agent: agentPane,
                }
                const panels = GROUP_KEYS[viewGroup]
                    .filter(k => openPanels[k])
                    .map(k => ({ key: k, node: paneNodes[k] }))

                return (
                    <div ref={splitRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
                        {panels.map((p, i) => (
                            <Fragment key={p.key}>
                                <div
                                    className={`min-h-0 w-full flex-1 md:flex md:w-[var(--panel-w)] md:flex-none ${mobileTab === p.key ? 'flex' : 'hidden md:flex'}`}
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

function FeatureMoreItem({ icon, label, detail }) {
    return (
        <button
            type="button"
            onClick={() => {}}
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
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]">
                <FileIcon />
            </span>
            <p className="mt-3 text-sm text-[var(--color-fg-muted)]">No files yet</p>
            <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                Files generated by tools (PDFs, slides, etc.) will appear here.
            </p>
        </div>
    )
}
function fileTimeAgo(iso) {
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

export default Chat
