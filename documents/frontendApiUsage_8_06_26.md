# Frontend API Usage

The frontend (`glyph-frontend/`) communicates with two backends:
1. **Supabase** — direct client calls for reads, realtime subscriptions, auth, and daily notes writes.
2. **FastAPI backend** — called via `apiFetch` / `apiUpload` (from `src/services/supabase.js`) for all write operations and AI interactions.

---

## Core HTTP Utilities — `src/services/supabase.js`

### `apiFetch(path, options?)`
Wraps `fetch` for all backend calls. Automatically attaches `Authorization: Bearer <access_token>` from the active Supabase session.

```js
apiFetch("/chats", { method: "POST", body: { name: "My Chat" } })
```

Throws an `Error` with `.status` and `.detail` on non-2xx responses.

### `apiUpload(file)`
Sends a `multipart/form-data` `POST /uploads` request. Retries once on network-level failure. Returns `{ url, mime_type, filename, size }`.

### `supabase`
The Supabase JS client — used directly for reads and realtime subscriptions throughout the app.

---

## Hook: `useChatMessages` — `src/app/hooks/useChatMessages.js`

**Purpose:** Loads and live-syncs all data needed to render a chat.

**Initial data loaded (Supabase direct):**
- `chats` — fetches chat name
- `messages` joined with `invited_llms(id, display_name, display_number)`
- `invited_llms` joined with `llm_connections!llm_id(*)`
- `chat_participants` + `profiles` for display names and roles

**Realtime subscriptions (Supabase channels):**

| Table | Event | Action |
|-------|-------|--------|
| `messages` | INSERT | Append full message (refetch with join); fire `onLLMReply` callback for new LLM chat messages |
| `messages` | UPDATE | Patch `content`, `deleted_at`, `edited_at`, `included_in_context`, `side_parent_message_id` in state |
| `invited_llms` | INSERT | Append new LLM to state (refetch with connections join) |
| `chat_participants` | INSERT | Fetch profile and add to `profilesById` |
| `chat_participants` | DELETE | Remove from `profilesById` |

**Channel naming:** `chat-${chatId}-${Date.now()}-${random}` — unique per mount to avoid React 19 strict-mode double-mount issues.

**Returns:** `{ chatName, messages, setMessages, invitedLLMs, setInvitedLLMs, profilesById, setProfilesById, loading }`

---

## Hook: `usePlannerNotes` — `src/app/hooks/usePlannerNotes.js`

**Purpose:** Loads and live-syncs daily planner notes for a chat.

**Initial load (Supabase direct):**
```js
supabase.from("daily_notes").select("date, content").eq("chat_id", chatId)
```

**Realtime subscription:** Listens to all `*` events on `daily_notes` filtered by `chat_id`. Patches the local `notes` map on INSERT/UPDATE, removes on DELETE.

**`updateNote(dateKey, content)`:**
- Optimistically updates local state.
- If `content` is empty: `DELETE` from `daily_notes` where `chat_id + date`.
- Otherwise: `UPSERT` into `daily_notes` with conflict on `(chat_id, date)`.

**Returns:** `{ selectedDate, setSelectedDate, notes, updateNote }`

---

## Hook: `useUsage` — `src/app/hooks/useUsage.js`

**Purpose:** Polls `GET /usage` every 30 seconds to keep usage/plan data current.

```js
apiFetch("/usage")
```

**Returns:** `{ plan, tokens_used, tokens_limit, requests_this_hour, requests_limit }` or `null` while loading.

---

## Chat Operations — called from `Chat.jsx`

### Sending a message
```js
apiFetch("/messages", {
  method: "POST",
  body: {
    chat_id,
    content,
    included_in_context: true,
    attachments: [{ url, mime_type, filename, size }]
  }
})
```
The new message row arrives via the realtime subscription — the frontend does not append it manually.

### Triggering an LLM reply
```js
const res = await fetch(`${API_BASE}/askLLM`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id, llm_id, side_message_id, replace_message_id })
})
// Then read the SSE stream:
const reader = res.body.getReader()
```

SSE events processed by the frontend:
- `token` → appends streaming text to a temporary in-progress bubble
- `tool` → shows tool-use indicator
- `done` → finalises the bubble; the permanent message arrives via realtime subscription
- `error` → shows error state

### Uploading a file attachment
```js
const attachment = await apiUpload(file)
// attachment = { url, mime_type, filename, size }
// Attach to the next message payload
```

### Creating a chat
```js
apiFetch("/chats", { method: "POST", body: { name } })
```

### Renaming a chat
```js
apiFetch(`/chats/${chatId}`, { method: "PATCH", body: { name } })
```

### Leaving a chat
```js
apiFetch(`/chats/${chatId}/leave`, { method: "POST" })
```

### Pinning / unpinning a chat
```js
apiFetch(`/chats/${chatId}/pin`, { method: "PATCH", body: { pinned: true } })
```

---

## Message Operations

### Editing a message
```js
apiFetch(`/messages/${messageId}`, { method: "PATCH", body: { content } })
```

### Deleting a message
```js
apiFetch(`/messages/${messageId}`, { method: "DELETE" })
```

### Toggling context inclusion (side-ask)
```js
apiFetch("/messages/include_in_context", {
  method: "POST",
  body: { chat_id, message_ids: [id], included: true }
})
```

---

## Participant & LLM Operations

### Inviting an LLM
```js
apiFetch("/inviteLLM", {
  method: "POST",
  body: {
    chat_id,
    display_name: "Researcher",
    model_instruct: "You are ...",
    model_type: "openai",
    connections: [{ target_type: "user" }]
  }
})
```

### Listing participants
```js
apiFetch(`/chats/${chatId}/participants`)
```

### Updating can_invite permission
```js
apiFetch(`/chat_participants/${participantId}/can_invite`, {
  method: "PATCH",
  body: { can_invite: true }
})
```

---

## Invitation Operations

### Sending an invitation
```js
apiFetch("/invitations", {
  method: "POST",
  body: { chat_id, email: "user@example.com" }
})
```

### Listing invitations
```js
apiFetch(`/invitations?chat_id=${chatId}`)
```

### Revoking an invitation
```js
apiFetch(`/invitations/${invitationId}`, { method: "DELETE" })
```

### Peeking at an invite (before auth — no bearer token)
```js
apiFetch(`/invitations/peek?token=${token}`, { auth: false })
```

### Accepting an invitation
```js
apiFetch("/invitations/accept", { method: "POST", body: { token } })
```

### Claiming pending invitations on login
```js
apiFetch("/invitations/claim_pending", { method: "POST" })
```

---

## Integrations Operations

### Loading the integration catalog
```js
apiFetch("/integrations/catalog")
```

### Listing an LLM's active integrations
```js
apiFetch(`/integrations/${llmId}`)
```

### Saving credentials
```js
apiFetch(`/integrations/${llmId}/${integrationType}/credentials`, {
  method: "POST",
  body: { credentials: { access_token: "..." } }
})
```

### Removing an integration
```js
apiFetch(`/integrations/${llmId}/${integrationType}`, { method: "DELETE" })
```

### Starting Gmail OAuth
```js
apiFetch(`/integrations/${llmId}/oauth/gmail/start`)
// Opens the returned URL in a popup window
// Listens for window.postMessage({ type: "oauth_complete" }) to close and refresh
```

---

## Direct Supabase Queries (no backend involved)

The frontend reads several tables directly via the Supabase JS client. These bypass the FastAPI backend entirely:

| Query | Where used |
|-------|-----------|
| `chats.select("name")` | `useChatMessages` |
| `messages.select("*, invited_llms(...)")` | `useChatMessages` |
| `invited_llms.select("*, llm_connections!llm_id(*)")` | `useChatMessages` |
| `chat_participants.select("user_id, role")` | `useChatMessages` |
| `profiles.select("id, first_name")` | `useChatMessages` |
| `daily_notes.select("date, content")` | `usePlannerNotes` |
| `daily_notes.upsert(...)` | `usePlannerNotes.updateNote` |
| `daily_notes.delete(...)` | `usePlannerNotes.updateNote` |
| Realtime channels on all of the above | `useChatMessages`, `usePlannerNotes` |
