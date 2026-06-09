import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [session, setSession] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            setUser(session?.user ?? null)
            setLoading(false)
        })

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
            setUser(session?.user ?? null)
        })

        return () => subscription.unsubscribe()
    }, [])

    async function login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        return data
    }

    async function register(email, firstName, lastName, password, { next } = {}) {
        const callback = `${window.location.origin}/auth/callback`
        const emailRedirectTo = next ? `${callback}?next=${encodeURIComponent(next)}` : callback
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo,
                data: {
                    first_name: firstName,
                    last_name: lastName
                }
            }
        })
        if (error) throw error
        return data
    }

    async function signInWithOAuth(provider, { next } = {}) {
        const callback = `${window.location.origin}/auth/callback`
        const redirectTo = next ? `${callback}?next=${encodeURIComponent(next)}` : callback
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo },
        })
        if (error) throw error
        // On the web, signInWithOAuth redirects the browser to the provider;
        // execution past this point only happens if the redirect was blocked.
        return data
    }

    async function resendVerification(email, { next } = {}) {
        const callback = `${window.location.origin}/auth/callback`
        const emailRedirectTo = next ? `${callback}?next=${encodeURIComponent(next)}` : callback
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo },
        })
        if (error) throw error
    }

    async function logout() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
    }

    return (
        <AuthContext.Provider value={{ user, session, loading, login, register, signInWithOAuth, resendVerification, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) throw new Error('useAuth must be used within an AuthProvider')
    return context
}
