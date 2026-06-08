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

// Keep aligned with the backend MAX_SIGNED_SIZE and the Supabase bucket limit.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024  // 50 MB

const UPLOAD_BUCKET = "chat-uploads"

/**
 * Upload a File DIRECTLY to Supabase Storage via a backend-issued signed URL.
 * The bytes never pass through the backend (so proxy/body-size limits don't
 * apply). Returns { url, mime_type, filename, size } — same shape as before, so
 * callers and the RAG ingest pipeline are unchanged.
 */
export async function apiUpload(file) {
    // Fail fast with a friendly message instead of a wasted round-trip + raw 413.
    if (file.size > MAX_UPLOAD_BYTES) {
        const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
        const err = new Error(`"${file.name}" is too large (max ${mb} MB).`)
        err.status = 413
        err.detail = err.message
        throw err
    }

    // 1. Ask the backend for a signed upload URL (tiny JSON request).
    const sign = await apiFetch("/uploads/sign", {
        method: "POST",
        body: { filename: file.name, content_type: file.type, size: file.size },
    })

    // 2. Upload bytes straight to the bucket using the signed token.
    const { error } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .uploadToSignedUrl(sign.path, sign.token, file, {
            contentType: file.type || undefined,
        })
    if (error) {
        const err = new Error(error.message || "Upload failed")
        err.status = error.statusCode || 500
        err.detail = error.message
        throw err
    }

    // 3. Hand back the public URL + metadata (what /messages expects).
    return {
        url: sign.public_url,
        mime_type: file.type || "application/octet-stream",
        filename: file.name,
        size: file.size,
    }
}
