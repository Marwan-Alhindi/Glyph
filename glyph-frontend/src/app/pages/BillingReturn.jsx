import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch } from "../../services/supabase"

// Noon redirects the payer here (APP_URL/app/billing/return?ref=...) after the
// hosted checkout. We confirm the charge with the backend, which re-fetches the
// order from Noon and flips the plan. status: verifying | paid | failed | error
function BillingReturn() {
    const [params] = useSearchParams()
    const navigate = useNavigate()
    const ref = params.get("ref")

    const [status, setStatus] = useState("verifying")
    const [plan, setPlan] = useState(null)
    const verifying = useRef(false)

    useEffect(() => {
        if (!ref) {
            setStatus("error")
            return
        }
        if (verifying.current) return
        verifying.current = true

        apiFetch(`/payments/verify/${encodeURIComponent(ref)}`)
            .then(({ status: s, plan: p }) => {
                setPlan(p)
                setStatus(s === "paid" ? "paid" : "failed")
            })
            .catch(() => setStatus("error"))
    }, [ref])

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
            {status === "verifying" && (
                <>
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-fg)]" />
                    <p className="text-sm text-[var(--color-fg-muted)]">Confirming your payment…</p>
                </>
            )}

            {status === "paid" && (
                <>
                    <p className="text-lg font-semibold text-[var(--color-fg)]">You're on {plan} 🎉</p>
                    <p className="text-sm text-[var(--color-fg-muted)]">Your subscription is active.</p>
                    <button
                        onClick={() => navigate("/app")}
                        className="mt-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)]"
                    >
                        Back to Glyph
                    </button>
                </>
            )}

            {(status === "failed" || status === "error") && (
                <>
                    <p className="text-lg font-semibold text-[var(--color-fg)]">Payment not completed</p>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                        {status === "error"
                            ? "We couldn't verify this payment."
                            : "The payment didn't go through. You weren't charged."}
                    </p>
                    <button
                        onClick={() => navigate("/app")}
                        className="mt-2 rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
                    >
                        Back to Glyph
                    </button>
                </>
            )}
        </div>
    )
}

export default BillingReturn
