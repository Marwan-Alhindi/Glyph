# API Reference

All endpoints are served by the FastAPI backend (`glyph-backend/`). Every protected endpoint requires an `Authorization: Bearer <supabase_access_token>` header. Auth is verified via Supabase JWKS (`auth.py`).

Base URL: configured via `VITE_BACKEND_URL` (default `http://localhost:8000`).

---

## Root

### `GET /`
Health check.

**Response:** `{ "message": "Welcome to Glyph backend" }`

---

## Usage

### `GET /usage`
Returns the authenticated user's token usage and plan limits for the current billing month.

**Auth:** required

**Response:**
```json
{
  "plan": "free",
  "tokens_used": 45000,
  "tokens_limit": 200000,
  "requests_this_hour": 3,
  "requests_limit": 10
}
```

---

## Chats — `api/chats.py`

### `POST /chats`
Create a new chat. The caller becomes the owner and is added as a participant.

**Auth:** required

**Request body:**
```json
{ "name": "My Chat" }
```
`name` defaults to `"New chat"` if omitted.

**Plan gate:** free plan is limited to 3 owned chats.

**Response:**
```json
{
  "chat": { "id": "...", "name": "...", "created_by": "...", "created_at": "..." },
  "participant": { "role": "owner", "pinned_at": null, "joined_at": "..." }
}
```

---

### `PATCH /chats/{chat_id}`
Rename a chat.

**Auth:** required (must be participant)

**Request body:** `{ "name": "New name" }`

**Response:** `{ "ok": true, "name": "New name" }`

---

### `PATCH /chats/{chat_id}/pin`
Pin or unpin a chat for the authenticated user.

**Auth:** required (must be participant)

**Request body:** `{ "pinned": true }`

**Response:** `{ "ok": true, "pinned_at": "2026-06-08T..." }`

---

### `POST /chats/{chat_id}/leave`
Leave a chat. Creates a system `leave` message, then removes the participant row.

**Auth:** required (must be participant)

**Response:** `{ "ok": true }`

---

## Messages — `api/messages.py`

### `POST /messages`
Send a user message to a chat.

**Auth:** required (must be participant)

**Request body:**
```json
{
  "chat_id": "...",
  "content": "Hello!",
  "included_in_context": true,
  "attachments": [
    { "url": "...", "mime_type": "image/png", "filename": "photo.png", "size": 12345 }
  ]
}
```

**Response:** Full message row joined with `invited_llms(id, display_name, display_number)`.

---

### `PATCH /messages/{message_id}`
Edit a user's own message. Sets `edited_at`.

**Auth:** required (must be the message's sender)

**Request body:** `{ "content": "Corrected text" }`

**Response:** `{ "ok": true, "edited_at": "..." }`

---

### `DELETE /messages/{message_id}`
Soft-delete a user's own message. Sets `deleted_at`; the row remains in the DB but is hidden in UI and invisible to LLMs.

**Auth:** required (must be the message's sender)

**Response:** `{ "ok": true, "deleted_at": "..." }`

---

### `POST /messages/include_in_context`
Toggle the `included_in_context` flag for one or more messages (promote/demote side-ask messages).

**Auth:** required (must be participant)

**Request body:**
```json
{
  "chat_id": "...",
  "message_ids": ["id1", "id2"],
  "included": true
}
```

**Response:** `{ "ok": true, "updated_ids": [...], "included": true }`

---

## Participants & LLMs — `api/participants.py`

### `POST /inviteLLM`
Invite a new LLM into a chat. Creates the `invited_llms` row, sets up `llm_connections`, generates a join message, and inserts it as a `kind='join'` message.

**Auth:** required (must be participant)

**Request body:**
```json
{
  "chat_id": "...",
  "display_name": "Researcher",
  "model_instruct": "You are a research assistant.",
  "model_type": "openai",
  "connections": [
    { "target_type": "user" },
    { "target_type": "llm", "target_llm_id": "..." }
  ]
}
```

`model_type` options: `openai`, `gemini`, or any string that maps to Claude (e.g. `anthropic`, `glyph`).

**Response:**
```json
{
  "llm": { "id": "...", "display_name": "Researcher", ... },
  "connections": [...],
  "join_message": "Hi, I'm Researcher and I just joined!"
}
```

---

### `GET /chats/{chat_id}/participants`
List all human participants and invited LLMs in the chat, including each LLM's connections.

**Auth:** required (must be participant)

**Response:**
```json
{
  "people": [
    { "user_id": "...", "role": "owner", "joined_at": "...", "first_name": "Alice", "last_name": null }
  ],
  "llms": [
    {
      "id": "...", "display_name": "Researcher", "model_type": "openai",
      "connections": [{ "target_type": "user", "target_llm_id": null }, ...]
    }
  ]
}
```

---

## AI — `api/ask_llm.py`

### `POST /askLLM`
Trigger an LLM reply. Returns a **Server-Sent Events (SSE)** stream.

**Auth:** required (must be participant)

**Plan gate:** checks rate limit (requests/hour) and monthly token budget.

**Request body:**
```json
{
  "chat_id": "...",
  "llm_id": "...",
  "side_message_id": null,
  "replace_message_id": null
}
```

- `side_message_id` — force a side-ask message into the LLM's context even though `included_in_context=false`.
- `replace_message_id` — regenerate an existing LLM message in place (context is truncated to before that message; the result is UPDATE'd onto the existing row).

**SSE event types:**
```
data: {"type": "token",  "llm_id": "...", "content": "Hello"}
data: {"type": "tool",   "llm_id": "...", "name": "web_search"}
data: {"type": "done",   "llm_id": "...", "message_id": "...", "content": "Full reply text"}
data: {"type": "error",  "llm_id": "...", "detail": "..."}
```

---

## Invitations — `api/invitations.py`

### `POST /invitations`
Send an email invitation to join a chat.

**Auth:** required (must be owner or have `can_invite=true`)

**Plan gate:** free plan allows 1 teammate, pro allows 3.

**Request body:** `{ "chat_id": "...", "email": "user@example.com" }`

**Response:** The created invitation row.

---

### `GET /invitations?chat_id=...`
List active (pending, not expired) invitations for a chat.

**Auth:** required (must be owner or `can_invite=true`)

**Response:** `{ "invitations": [...] }`

---

### `DELETE /invitations/{invitation_id}`
Revoke an invitation.

**Auth:** required (must be the inviter or the chat owner)

**Response:** `{ "ok": true }`

---

### `POST /invitations/accept`
Accept an invitation by token (called from the invite link flow).

**Auth:** required

**Request body:** `{ "token": "..." }`

**Response:** `{ "chat_id": "..." }`

---

### `POST /invitations/claim_pending`
Claim any pending invitations matching the authenticated user's email. Called automatically on login.

**Auth:** required

**Response:** `{ "joined_chat_ids": ["..."] }`

---

### `GET /invitations/peek?token=...`
Public preview of an invitation (no auth required). Used to show the invite details before login.

**Response:**
```json
{
  "email": "user@example.com",
  "chat_name": "My Chat",
  "inviter_name": "Alice",
  "expires_at": "..."
}
```

---

### `PATCH /chat_participants/{participant_id}/can_invite`
Grant or revoke invite permission for a participant.

**Auth:** required (must be chat owner)

**Request body:** `{ "can_invite": true }`

**Response:** `{ "ok": true }`

---

## Uploads — `api/uploads.py`

### `POST /uploads`
Upload a file (multipart/form-data). Max 20 MB. Stored in the `chat-uploads` Supabase Storage bucket.

**Auth:** required

**Form field:** `file`

**Response:**
```json
{
  "url": "https://...",
  "mime_type": "image/png",
  "filename": "photo.png",
  "size": 12345
}
```

---

## Integrations — `api/integrations/router.py`

All routes prefixed with `/integrations`.

### `GET /integrations/catalog`
Return the static catalog of all supported integrations with their required credential fields.

**Auth:** required

**Response:** `{ "integrations": [{ "id": "gmail", "name": "Gmail", "capabilities": [...], "credential_fields": [...] }] }`

---

### `GET /integrations/{llm_id}`
List active integrations for an LLM.

**Auth:** required (must be participant in the LLM's chat)

**Response:** `{ "integrations": [{ "id": "...", "integration_type": "gmail", "status": "active", ... }] }`

---

### `POST /integrations/{llm_id}/{integration_type}/credentials`
Save credentials for an integration (upsert).

**Auth:** required (must be participant)

**Request body:** `{ "credentials": { "access_token": "...", ... } }`

**Response:** `{ "ok": true }`

---

### `DELETE /integrations/{llm_id}/{integration_type}`
Remove an integration.

**Auth:** required (must be participant)

**Response:** `{ "ok": true }`

---

### `GET /integrations/{llm_id}/oauth/gmail/start`
Begin the Gmail OAuth2 PKCE flow. Returns the Google authorization URL.

**Auth:** required (must be participant)

**Response:** `{ "url": "https://accounts.google.com/o/oauth2/auth?..." }`

---

### `GET /integrations/oauth/callback`
OAuth2 redirect endpoint (no auth header — called by Google). Exchanges the code for tokens, stores them via `IntegrationRepository.upsert`, then uses `postMessage` to notify the opener window and closes the popup.

**Query params:** `code`, `state`, `error`

**Response:** HTML page with `<script>` that calls `window.opener.postMessage(...)` and `window.close()`.

---

## Plan Limits Summary

| Plan | Monthly Tokens | Requests/Hour | Max Chats | Max Teammates |
|------|---------------|---------------|-----------|---------------|
| free | 200,000 | 10 | 3 | 1 |
| pro | 3,000,000 | 60 | unlimited | 3 |
| max | 15,000,000 | 120 | unlimited | unlimited |
