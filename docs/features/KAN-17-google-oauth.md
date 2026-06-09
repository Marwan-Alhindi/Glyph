# KAN-17 — Google authentication (OAuth sign-in)

## What it does
Adds "Continue with Google" to the login and signup screens, letting users
authenticate with their Google account instead of email/password. Scope for this
task is **Google only, web-only**, relying on Supabase's default identity linking
(an OAuth sign-in auto-links to an existing account when the email matches and is
verified). Apple was descoped (requires a paid Apple Developer account) — the auth
helper is provider-agnostic, so Apple can be added later with no code changes
beyond a button.

## Why
Lower-friction sign-in; no password to manage. Faster onboarding for new users.

## Key files touched
- `glyph-frontend/src/contexts/AuthContext.jsx` — new `signInWithOAuth(provider, { next })`
  wrapper over `supabase.auth.signInWithOAuth`, exposed on the auth context.
- `glyph-frontend/src/marketing/components/GoogleButton.jsx` — shared "Continue with
  Google" button (official multi-color logo), used by both auth screens. Surfaces
  redirect errors via an `onError` callback; the browser leaves the page on success.
- `glyph-frontend/src/marketing/pages/Login.jsx` and `Getstarted.jsx` — render the
  button + an "or" divider above the email form, passing the invite-aware `next`
  destination (`/invite/<token>` or `/app`).
- `glyph-frontend/src/marketing/pages/AuthCallback.jsx` — now retries the session
  check on a short interval instead of a single 1.5s timeout, to cover the OAuth
  code-exchange network round-trip (not just the email-link hash).
- `glyph-frontend/src/i18n/en.js` + `ar.js` — `continueWithGoogle` and `or` strings.

## How it works end-to-end
1. User clicks "Continue with Google". `signInWithOAuth("google", { next })` calls
   `supabase.auth.signInWithOAuth` with `redirectTo = <origin>/auth/callback?next=<dest>`.
2. The browser is redirected to Google → user consents → Google redirects to the
   **Supabase** callback (`https://<ref>.supabase.co/auth/v1/callback`).
3. Supabase establishes the session and redirects back to our `redirectTo`
   (`/auth/callback?next=...`).
4. `AuthCallback` waits for supabase-js to finish the code exchange, then forwards
   the user to `next` (default `/app`).
5. Backend JWT verification (JWKS via Supabase) is unchanged — OAuth-issued sessions
   carry the same Supabase JWT, so `auth.py` works as-is.

## Config / dashboard setup (one-time, outside the repo)
- **Google Cloud Console** → OAuth consent screen + an OAuth 2.0 Web client:
  - Authorized JavaScript origins: `http://localhost:5173`, `https://glypho.live`
  - Authorized redirect URI: the Supabase callback `https://<ref>.supabase.co/auth/v1/callback`
- **Supabase → Auth → Providers → Google**: enable, paste Client ID + Client Secret.
- **Supabase → Auth → URL Configuration → Redirect URLs** (wildcards, so the
  `?next=` query param still matches):
  - `http://localhost:5173/**`
  - `https://glypho.live/**`

  > Gotcha worth recording: a bare `…/auth/callback` entry does **not** match our
  > `…/auth/callback?next=/app` redirect (exact-match), so Supabase silently falls
  > back to the Site URL and lands the user on `/#`. The `/**` wildcard fixes it.

## Known follow-up — `profiles` name population
New users' `profiles` rows are created by a Supabase `handle_new_user` trigger that
reads `raw_user_meta_data.first_name` / `last_name` (the keys the email/password flow
sets). Google instead sends `given_name` / `family_name` / `full_name`, so a Google
user's `profiles.first_name` / `last_name` may be **blank** until the trigger is
extended with OAuth fallbacks. This is a DB-only change (no app code) and is tracked
as a follow-up; sign-in itself works regardless.

## How to test
1. Complete the dashboard setup above.
2. `cd glyph-frontend && npm run dev`, open `/login` or `/getstarted`.
3. Click "Continue with Google" → consent → you should land on `/app` signed in.
4. Confirm a `profiles` row exists for the new user (name may be blank — see above).
