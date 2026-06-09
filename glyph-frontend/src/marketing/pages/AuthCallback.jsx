import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../../contexts/AuthContext"
import { supabase } from "../../services/supabase"

// Lands here when the user clicks the verification email, any
// emailRedirectTo link, or returns from an OAuth provider (Google).
// supabase-js auto-detects the access_token in the URL hash (email/implicit)
// or exchanges the `?code=` (OAuth/PKCE) on app init; once that completes we
// forward the user.
function AuthCallback() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const { user, loading } = useAuth()
    const [error, setError] = useState("")

    const next = searchParams.get("next") || "/app"

    useEffect(() => {
        if (loading) return
        if (user) {
            navigate(next, { replace: true })
            return
        }

        // No session yet. Could be: (a) hash still being processed by
        // supabase-js, (b) error in the URL, or (c) link already used.
        const hashErr = parseHashError()
        const queryErr = searchParams.get("error_description") || searchParams.get("error")
        if (hashErr || queryErr) {
            setError(hashErr || queryErr)
            return
        }

        // Give supabase-js time to process the hash / exchange the OAuth code,
        // re-checking a few times before giving up (the code exchange is a
        // network round-trip and can outlast a single short timeout).
        let cancelled = false
        let attempts = 0
        const iv = setInterval(async () => {
            attempts += 1
            const { data: { session } } = await supabase.auth.getSession()
            if (cancelled) return
            if (session) {
                clearInterval(iv)
                navigate(next, { replace: true })
            } else if (attempts >= 5) {
                clearInterval(iv)
                setError("We couldn't complete sign in. The link may have expired or already been used.")
            }
        }, 800)
        return () => {
            cancelled = true
            clearInterval(iv)
        }
    }, [user, loading, navigate, next, searchParams])

    return (
        <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
                <div className="mb-6 flex flex-col items-center text-center">
                    <img src="/logo-white.png" width={36} height={36} alt="" />
                </div>
                <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)]/70 p-7 text-center backdrop-blur-md">
                    {error ? (
                        <>
                            <h1 className="text-xl font-semibold tracking-tight">Verification link issue</h1>
                            <p className="mt-2 text-sm text-rose-300">{error}</p>
                            <div className="mt-6 flex flex-col gap-2">
                                <button
                                    onClick={() => navigate("/login")}
                                    className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)]"
                                >
                                    Go to log in
                                </button>
                                <button
                                    onClick={() => navigate("/getstarted")}
                                    className="rounded-lg px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                                >
                                    Create a new account
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="mx-auto flex h-3 items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" />
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" style={{ animationDelay: "0.16s" }} />
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-muted)] lp-dot" style={{ animationDelay: "0.32s" }} />
                            </div>
                            <h1 className="mt-3 text-base font-medium text-[var(--color-fg)]">Finishing up sign in…</h1>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

function parseHashError() {
    if (typeof window === "undefined") return null
    const hash = window.location.hash || ""
    if (!hash.includes("error")) return null
    const params = new URLSearchParams(hash.replace(/^#/, ""))
    return params.get("error_description") || params.get("error")
}

export default AuthCallback
