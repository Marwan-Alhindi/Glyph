import { useEffect, useState } from "react"
import { supabase } from "../../services/supabase"

export function useChatMessages(chatId, { onLLMReply } = {}) {
    const [chatName, setChatName] = useState("Chat")
    const [messages, setMessages] = useState([])
    const [invitedLLMs, setInvitedLLMs] = useState([])
    const [profilesById, setProfilesById] = useState({})
    const [loading, setLoading] = useState(true)

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
                .select("user_id, role")
                .eq("chat_id", chatId)
            if (participants?.length) {
                const { data: profiles } = await supabase
                    .from("profiles")
                    .select("id, first_name")
                    .in("id", participants.map(p => p.user_id))
                if (profiles) {
                    const roleByUserId = Object.fromEntries(participants.map(p => [p.user_id, p.role]))
                    setProfilesById(Object.fromEntries(profiles.map(p => [p.id, { ...p, role: roleByUserId[p.id] }])))
                }
            }

            setLoading(false)
        }
        loadData()
    }, [chatId])

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

                        if (fullMsg.sender_type === 'llm' && fullMsg.sender_llm_id) {
                            onLLMReply?.(fullMsg)
                        }

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
                { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
                (payload) => {
                    const updated = payload.new
                    if (!updated?.id) return
                    setMessages(prev => prev.map(m => m.id === updated.id
                        ? {
                            ...m,
                            content: updated.content,
                            deleted_at: updated.deleted_at,
                            edited_at: updated.edited_at,
                            included_in_context: updated.included_in_context,
                            side_parent_message_id: updated.side_parent_message_id,
                        }
                        : m
                    ))
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
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_participants', filter: `chat_id=eq.${chatId}` },
                async (payload) => {
                    const userId = payload.new?.user_id
                    if (!userId) return
                    const role = payload.new?.role
                    const { data: profile } = await supabase
                        .from("profiles")
                        .select("id, first_name")
                        .eq("id", userId)
                        .single()
                    if (profile) {
                        setProfilesById(prev => ({ ...prev, [profile.id]: { ...profile, role } }))
                    }
                }
            )
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'chat_participants', filter: `chat_id=eq.${chatId}` },
                (payload) => {
                    const userId = payload.old?.user_id
                    if (!userId) return
                    setProfilesById(prev => {
                        if (!prev[userId]) return prev
                        const next = { ...prev }
                        delete next[userId]
                        return next
                    })
                }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [chatId, onLLMReply])

    return {
        chatName,
        messages,
        setMessages,
        invitedLLMs,
        setInvitedLLMs,
        profilesById,
        setProfilesById,
        loading,
    }
}
