import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export const API_BASE = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000"

/**
 * Call a backend endpoint with the current Supabase access token attached.
 * Throws an Error with `status` and `detail` populated on non-2xx.
 */
export async function apiFetch(path, { method = "GET", body, headers = {}, auth = true } = {}) {
    const finalHeaders = { "Content-Type": "application/json", ...headers }
    if (auth) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
            finalHeaders.Authorization = `Bearer ${session.access_token}`
        }
    }
    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    let data = null
    const text = await res.text()
    if (text) {
        try { data = JSON.parse(text) } catch { data = text }
    }

    if (!res.ok) {
        const detail = (data && typeof data === "object" && data.detail) || data || res.statusText
        const err = new Error(typeof detail === "string" ? detail : "Request failed")
        err.status = res.status
        err.detail = detail
        throw err
    }
    return data
}

/**
 * Upload a File object to POST /uploads (multipart/form-data).
 * Returns { url, mime_type, filename, size }.
 */
export async function apiUpload(file) {
    const { data: { session } } = await supabase.auth.getSession()
    const form = new FormData()
    form.append("file", file)
    const res = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: form,
    })
    let data = null
    const text = await res.text()
    if (text) { try { data = JSON.parse(text) } catch { data = text } }
    if (!res.ok) {
        const detail = (data && typeof data === "object" && data.detail) || data || res.statusText
        const err = new Error(typeof detail === "string" ? detail : "Upload failed")
        err.status = res.status
        err.detail = detail
        throw err
    }
    return data
}
