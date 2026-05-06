import { useEffect, useState } from "react"
import { supabase } from "../../services/supabase"
import { toDateKey } from "../components/plannerView/Calendar"

export function usePlannerNotes(chatId, userId) {
    const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()))
    const [notes, setNotes] = useState({})

    useEffect(() => {
        if (!chatId) {
            setNotes({})
            return
        }
        let cancelled = false
        ;(async () => {
            const { data, error } = await supabase
                .from("daily_notes")
                .select("date, content")
                .eq("chat_id", chatId)
            if (cancelled) return
            if (error) {
                console.error("Failed to load daily notes:", error)
                setNotes({})
                return
            }
            const map = {}
            for (const row of data || []) {
                map[row.date] = row.content || ""
            }
            setNotes(map)
        })()
        return () => { cancelled = true }
    }, [chatId])

    useEffect(() => {
        if (!chatId) return
        const channelName = `daily-notes-${chatId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const channel = supabase
            .channel(channelName)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'daily_notes', filter: `chat_id=eq.${chatId}` },
                (payload) => {
                    if (payload.eventType === 'DELETE') {
                        const oldDate = payload.old?.date
                        if (!oldDate) return
                        setNotes(prev => {
                            if (!(oldDate in prev)) return prev
                            const next = { ...prev }
                            delete next[oldDate]
                            return next
                        })
                    } else if (payload.new) {
                        const { date, content } = payload.new
                        setNotes(prev => prev[date] === (content || "") ? prev : { ...prev, [date]: content || "" })
                    }
                }
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [chatId])

    async function updateNote(dateKey, content) {
        if (!chatId) return
        const isEmpty = !content || content.trim() === ""

        setNotes(prev => {
            const next = { ...prev }
            if (isEmpty) delete next[dateKey]
            else next[dateKey] = content
            return next
        })

        if (isEmpty) {
            const { error } = await supabase
                .from("daily_notes")
                .delete()
                .eq("chat_id", chatId)
                .eq("date", dateKey)
            if (error) console.error("Failed to delete note:", error)
        } else {
            const { error } = await supabase
                .from("daily_notes")
                .upsert(
                    { chat_id: chatId, date: dateKey, content, updated_by: userId ?? null },
                    { onConflict: "chat_id,date" }
                )
            if (error) console.error("Failed to save note:", error)
        }
    }

    return { selectedDate, setSelectedDate, notes, updateNote }
}
