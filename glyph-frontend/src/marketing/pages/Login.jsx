import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../../contexts/AuthContext"
import { useLanguage } from "../../contexts/LanguageContext"
import { useState } from "react"
import GoogleButton from "../components/GoogleButton"

function Login() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const inviteToken = searchParams.get("invite")
    const { login } = useAuth()
    const { t } = useLanguage()
    const tl = t.login
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    async function handleLogin(e) {
        e.preventDefault()
        setError("")
        setLoading(true)
        try {
            await login(email, password)
            navigate(inviteToken ? `/invite/${inviteToken}` : '/app')
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
                {/* Brand */}
                <div className="mb-8 flex flex-col items-center text-center">
                    <img src="/logo-white.png" width={36} height={36} alt="" />
                    <h1 className="mt-4 text-2xl font-semibold tracking-tight">{tl.title}</h1>
                    <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
                        {tl.subtitle}
                    </p>
                </div>

                {/* Card */}
                <form
                    onSubmit={handleLogin}
                    className="space-y-5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)]/70 p-7 backdrop-blur-md"
                >
                    {error && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                            {error}
                        </div>
                    )}

                    <GoogleButton
                        next={inviteToken ? `/invite/${inviteToken}` : '/app'}
                        label={tl.continueWithGoogle}
                        onError={setError}
                    />

                    <div className="flex items-center gap-3">
                        <span className="h-px flex-1 bg-[var(--color-line)]" />
                        <span className="text-xs text-[var(--color-fg-subtle)]">{tl.or}</span>
                        <span className="h-px flex-1 bg-[var(--color-line)]" />
                    </div>

                    <Field
                        label={tl.email}
                        type="email"
                        placeholder={tl.emailPlaceholder}
                        value={email}
                        onChange={setEmail}
                    />
                    <Field
                        label={tl.password}
                        type="password"
                        placeholder={tl.passwordPlaceholder}
                        value={password}
                        onChange={setPassword}
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-all hover:bg-[var(--color-brand)] disabled:opacity-60"
                    >
                        {loading ? tl.signingIn : tl.continue}
                        {!loading && <span className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180">{t.arrow}</span>}
                    </button>
                </form>

                <p className="mt-6 text-center text-sm text-[var(--color-fg-muted)]">
                    {tl.newToGlyph}{' '}
                    <button
                        onClick={() => navigate('/getstarted')}
                        className="text-[var(--color-fg)] underline-offset-4 hover:underline"
                    >
                        {tl.createAccount}
                    </button>
                </p>
            </div>
        </div>
    )
}

function Field({ label, type, placeholder, value, onChange }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-fg-muted)]">{label}</span>
            <input
                type={type}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none transition-colors focus:border-[var(--color-fg-subtle)] focus:ring-2 focus:ring-white/10"
            />
        </label>
    )
}

export default Login
