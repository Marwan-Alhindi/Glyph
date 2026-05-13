import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../../services/supabase"

const POLL_INTERVAL = 30_000

export function useUsage(user) {
    const [usage, setUsage] = useState(null)

    const refresh = useCallback(() => {
        if (!user) return
        apiFetch("/usage")
            .then(setUsage)
            .catch(() => {})
    }, [user?.id])

    useEffect(() => {
        if (!user) return
        refresh()
        const id = setInterval(refresh, POLL_INTERVAL)
        return () => clearInterval(id)
    }, [refresh])

    return usage
}
