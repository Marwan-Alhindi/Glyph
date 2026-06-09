import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../../contexts/AuthContext"
import { useLanguage } from "../../contexts/LanguageContext"
import { useEffect, useState } from "react"
import { apiFetch } from "../../services/supabase"
import GoogleButton from "../components/GoogleButton"

function Getstarted() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const inviteToken = searchParams.get("invite")
    const { register, resendVerification } = useAuth()
    const { t } = useLanguage()
    const tg = t.getstarted
    const [email, setEmail] = useState("")
    const [firstName, setFirstName] = useState("")
    const [lastName, setLastName] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [invitePreview, setInvitePreview] = useState(null)
    const [pendingVerification, setPendingVerification] = useState(null)
    const [resending, setResending] = useState(false)
    const [resendNotice, setResendNotice] = useState("")
    const [emailAlreadyExists, setEmailAlreadyExists] = useState(false)

    useEffect(() => {
        if (!inviteToken) return
        apiFetch(`/invitations/peek?token=${encodeURIComponent(inviteToken)}`, { auth: false })
            .then(p => {
                setInvitePreview(p)
                if (p?.email) setEmail(p.email)
            })
            .catch(err => setError(err.detail || err.message || "This invitation is no longer valid."))
    }, [inviteToken])

    async function handleRegister(e) {
        e.preventDefault()
        setError("")

        if (password !== confirmPassword) {
            setError(tg.passwordsNoMatch)
            return
        }
        if (password.length < 6) {
            setError(tg.passwordTooShort)
            return
        }

        setLoading(true)
        try {
            const next = inviteToken ? `/invite/${inviteToken}` : '/app'
            const data = await register(email, firstName, lastName, password, { next })
            if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
                setEmailAlreadyExists(true)
                return
            }
            if (data?.session) {
                navigate(next)
            } else {
                setPendingVerification(email)
            }
        } catch (err) {
            const msg = (err?.message || "").toLowerCase()
            if (msg.includes("already registered") || msg.includes("user already exists")) {
                setEmailAlreadyExists(true)
            } else {
                setError(err.message)
            }
        } finally {
            setLoading(false)
        }
    }

    async function handleResend() {
        if (!pendingVerification) return
        setResending(true)
        setResendNotice("")
        try {
            const next = inviteToken ? `/invite/${inviteToken}` : '/app'
            await resendVerification(pendingVerification, { next })
            setResendNotice(tg.checkEmail.resend + ' ✓')
        } catch (err) {
            setResendNotice(err.message || "Could not resend verification.")
        } finally {
            setResending(false)
        }
    }

    if (emailAlreadyExists) {
        const loginPath = inviteToken ? `/login?invite=${inviteToken}` : '/login'
        return (
            <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-12">
                <div className="w-full max-w-md">
                    <div className="mb-6 flex flex-col items-center text-center">
                        <img src="/logo-white.png" width={36} height={36} alt="" />
                    </div>
                    <div className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)]/70 p-7 text-center backdrop-blur-md">
                        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
                            <UserCheckIcon />
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight">{tg.accountExists.title}</h1>
                        <p className="text-sm text-[var(--color-fg-muted)]">
                            {tg.accountExists.desc(email, invitePreview?.chat_name)}
                        </p>
                        <div className="flex flex-col gap-2 pt-2">
                            <button
                                onClick={() => navigate(loginPath)}
                                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)]"
                            >
                                {tg.accountExists.goToLogin}
                            </button>
                            <button
                                onClick={() => setEmailAlreadyExists(false)}
                                className="rounded-lg px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                            >
                                {tg.accountExists.useDifferent}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (pendingVerification) {
        return (
            <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-12">
                <div className="w-full max-w-md">
                    <div className="mb-6 flex flex-col items-center text-center">
                        <img src="/logo-white.png" width={36} height={36} alt="" />
                    </div>
                    <div className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)]/70 p-7 text-center backdrop-blur-md">
                        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                            <MailIcon />
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight">{tg.checkEmail.title}</h1>
                        <p className="text-sm text-[var(--color-fg-muted)]">
                            {tg.checkEmail.desc(pendingVerification, invitePreview?.chat_name)}
                        </p>
                        <p className="text-xs text-[var(--color-fg-subtle)]">
                            {tg.checkEmail.spam}
                        </p>
                        {resendNotice && (
                            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                                {resendNotice}
                            </div>
                        )}
                        <div className="flex flex-col gap-2 pt-2">
                            <button
                                onClick={handleResend}
                                disabled={resending}
                                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2 text-sm text-[var(--color-fg)] hover:border-[var(--color-fg-subtle)] disabled:opacity-60"
                            >
                                {resending ? tg.checkEmail.sending : tg.checkEmail.resend}
                            </button>
                            <button
                                onClick={() => navigate('/login')}
                                className="rounded-lg px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                            >
                                {tg.checkEmail.backToLogin}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
                <div className="mb-8 flex flex-col items-center text-center">
                    <img src="/logo-white.png" width={36} height={36} alt="" />
                    <h1 className="mt-4 text-2xl font-semibold tracking-tight">{tg.title}</h1>
                    <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
                        {invitePreview
                            ? `${invitePreview.inviter_name} invited you to ${invitePreview.chat_name}.`
                            : tg.subtitle}
                    </p>
                </div>

                <form
                    onSubmit={handleRegister}
                    className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)]/70 p-7 backdrop-blur-md"
                >
                    {error && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                            {error}
                        </div>
                    )}

                    <GoogleButton
                        next={inviteToken ? `/invite/${inviteToken}` : '/app'}
                        label={tg.continueWithGoogle}
                        onError={setError}
                    />

                    <div className="flex items-center gap-3">
                        <span className="h-px flex-1 bg-[var(--color-line)]" />
                        <span className="text-xs text-[var(--color-fg-subtle)]">{tg.or}</span>
                        <span className="h-px flex-1 bg-[var(--color-line)]" />
                    </div>

                    <Field
                        label={tg.email}
                        type="email"
                        placeholder={tg.emailPlaceholder}
                        value={email}
                        onChange={setEmail}
                        readOnly={Boolean(invitePreview)}
                    />

                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label={tg.firstName}
                            type="text"
                            placeholder={tg.firstNamePlaceholder}
                            value={firstName}
                            onChange={setFirstName}
                        />
                        <Field
                            label={tg.lastName}
                            type="text"
                            placeholder={tg.lastNamePlaceholder}
                            value={lastName}
                            onChange={setLastName}
                        />
                    </div>

                    <Field
                        label={tg.password}
                        type="password"
                        placeholder={tg.passwordPlaceholder}
                        value={password}
                        onChange={setPassword}
                    />
                    <Field
                        label={tg.confirmPassword}
                        type="password"
                        placeholder={tg.confirmPasswordPlaceholder}
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-all hover:bg-[var(--color-brand)] disabled:opacity-60"
                    >
                        {loading ? tg.creatingAccount : tg.createAccount}
                        {!loading && <span className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180">{t.arrow}</span>}
                    </button>

                    <p className="text-center text-[11px] text-[var(--color-fg-subtle)]">
                        {tg.terms}
                    </p>
                </form>

                <p className="mt-6 text-center text-sm text-[var(--color-fg-muted)]">
                    {tg.alreadyHave}{' '}
                    <button
                        onClick={() => navigate('/login')}
                        className="text-[var(--color-fg)] underline-offset-4 hover:underline"
                    >
                        {tg.logIn}
                    </button>
                </p>
            </div>
        </div>
    )
}

function Field({ label, type, placeholder, value, onChange, readOnly = false }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-fg-muted)]">{label}</span>
            <input
                type={type}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required
                readOnly={readOnly}
                className={`w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none transition-colors focus:border-[var(--color-fg-subtle)] focus:ring-2 focus:ring-white/10 ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`}
            />
        </label>
    )
}

function MailIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
        </svg>
    )
}

function UserCheckIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
        </svg>
    )
}

export default Getstarted
