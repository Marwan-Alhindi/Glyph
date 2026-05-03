import { useNavigate } from "react-router-dom"
import { useAuth } from "../../contexts/AuthContext"
import { useState } from "react"

function Getstarted() {
    const navigate = useNavigate()
    const { register } = useAuth()
    const [email, setEmail] = useState("")
    const [firstName, setFirstName] = useState("")
    const [lastName, setLastName] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    async function handleRegister(e) {
        e.preventDefault()
        setError("")

        if (password !== confirmPassword) {
            setError("Passwords do not match")
            return
        }
        if (password.length < 6) {
            setError("Password must be at least 6 characters")
            return
        }

        setLoading(true)
        try {
            await register(email, firstName, lastName, password)
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
                <div className="mb-8 flex flex-col items-center text-center">
                    <img src="/logo-white.png" width={36} height={36} alt="" />
                    <h1 className="mt-4 text-2xl font-semibold tracking-tight">Create your account</h1>
                    <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
                        Start free. Bring models and teammates into the same chat.
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

                    <Field
                        label="Email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={setEmail}
                    />

                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label="First name"
                            type="text"
                            placeholder="Marwan"
                            value={firstName}
                            onChange={setFirstName}
                        />
                        <Field
                            label="Last name"
                            type="text"
                            placeholder="Alhindi"
                            value={lastName}
                            onChange={setLastName}
                        />
                    </div>

                    <Field
                        label="Password"
                        type="password"
                        placeholder="At least 6 characters"
                        value={password}
                        onChange={setPassword}
                    />
                    <Field
                        label="Confirm password"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-all hover:bg-[var(--color-brand)] disabled:opacity-60"
                    >
                        {loading ? 'Creating account…' : 'Create account'}
                        {!loading && <span className="transition-transform group-hover:translate-x-0.5">→</span>}
                    </button>

                    <p className="text-center text-[11px] text-[var(--color-fg-subtle)]">
                        By continuing, you agree to O's Terms and Privacy.
                    </p>
                </form>

                <p className="mt-6 text-center text-sm text-[var(--color-fg-muted)]">
                    Already have an account?{' '}
                    <button
                        onClick={() => navigate('/login')}
                        className="text-[var(--color-fg)] underline-offset-4 hover:underline"
                    >
                        Log in
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

export default Getstarted
