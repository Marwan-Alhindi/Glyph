import { useNavigate } from "react-router-dom"
import { useAuth } from "../../contexts/AuthContext"
import { useState } from "react"

function Login() {
    const navigate = useNavigate()
    const { login } = useAuth()
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
            navigate('/app')
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
                    <h1 className="mt-4 text-2xl font-semibold tracking-tight">Welcome back</h1>
                    <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
                        Log in to continue your conversations.
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

                    <Field
                        label="Email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={setEmail}
                    />
                    <Field
                        label="Password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={setPassword}
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-all hover:bg-[var(--color-brand)] disabled:opacity-60"
                    >
                        {loading ? 'Signing in…' : 'Continue'}
                        {!loading && <span className="transition-transform group-hover:translate-x-0.5">→</span>}
                    </button>
                </form>

                <p className="mt-6 text-center text-sm text-[var(--color-fg-muted)]">
                    New to O?{' '}
                    <button
                        onClick={() => navigate('/getstarted')}
                        className="text-[var(--color-fg)] underline-offset-4 hover:underline"
                    >
                        Create an account
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
