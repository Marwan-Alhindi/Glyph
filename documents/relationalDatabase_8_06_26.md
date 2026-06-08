# Relational Database — Tables, Relations & Queries

## Tables

### `auth.users` (Supabase managed)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | text | user email |

---

### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, FK → auth.users.id |
| first_name | text | |
| created_at | timestamptz | |
| plan | text | `free` \| `pro` \| `max` |

---

### `chats`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | |
| created_by | uuid | FK → auth.users.id |
| invite_code | text | nullable |
| created_at | timestamptz | |

---

### `chat_participants`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| chat_id | uuid | FK → chats.id |
| user_id | uuid | FK → auth.users.id |
| role | text | `owner` \| `member` |
| joined_at | timestamptz | |
| can_invite | bool | whether member may invite others |
| pinned_at | timestamptz | nullable — used to pin the chat in sidebar |

---

### `invited_llms`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| chat_id | uuid | FK → chats.id |
| display_name | text | e.g. "Researcher" |
| model_instruct | text | system prompt / persona |
| display_number | int4 | ordering within the chat |
| invited_by | uuid | FK → auth.users.id |
| created_at | timestamptz | |
| model_type | text | `openai` \| `gemini` \| `anthropic` / `glyph` |

---

### `llm_connections`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| llm_id | uuid | FK → invited_llms.id (the LLM that holds this connection) |
| target_type | text | `user` \| `llm` |
| target_llm_id | uuid | FK → invited_llms.id — only set when target_type = `llm` |

**Purpose:** Controls which messages each LLM can see in its context window. An LLM only sees user messages if it has a connection with `target_type='user'`, and only sees another LLM's messages if it has a connection to that specific LLM.

---

### `messages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| chat_id | uuid | FK → chats.id |
| sender_type | text | `user` \| `llm` |
| sender_user_id | uuid | FK → auth.users.id — set when sender_type = `user` |
| sender_llm_id | uuid | FK → invited_llms.id — set when sender_type = `llm` |
| content | text | |
| created_at | timestamptz | |
| kind | text | `chat` (default) \| `join` \| `leave` \| `delegation` |
| deleted_at | timestamptz | nullable — soft delete; LLMs see no trace |
| edited_at | timestamptz | nullable |
| included_in_context | bool | false = "side ask" — hidden from LLM context |
| side_parent_message_id | uuid | FK → messages.id — links a side-ask thread to its parent |
| attachments | jsonb | array of `{url, mime_type, filename, size}` |

---

### `daily_notes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| chat_id | uuid | FK → chats.id |
| date | date | YYYY-MM-DD |
| content | text | markdown body |
| updated_by | uuid | FK → auth.users.id |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on `(chat_id, date)` — one note per day per chat.

---

### `memories`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| chat_id | uuid | FK → chats.id |
| llm_id | uuid | FK → invited_llms.id — the LLM that saved this memory |
| content | text | |
| embedding | vector | generated via `text-embedding-3-small` for similarity search |
| created_at | timestamptz | |

Supports the `match_memories` RPC (pgvector cosine similarity search).

---

### `chat_invitations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| chat_id | uuid | FK → chats.id |
| email | text | invitee email |
| token | text | secure random token for the invite link |
| invited_by | uuid | FK → auth.users.id |
| created_at | timestamptz | |
| expires_at | timestamptz | 7 days from creation |
| accepted_at | timestamptz | nullable |
| accepted_by | uuid | FK → auth.users.id — nullable |
| revoked_at | timestamptz | nullable |

---

### `llm_integrations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| llm_id | uuid | FK → invited_llms.id |
| integration_type | text | `gmail` \| `outlook` \| `discord` \| `telegram` \| `teams` \| `slack` |
| credentials | jsonb | encrypted-at-rest by Supabase; stores tokens, keys, etc. |
| status | text | `active` \| `revoked` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on `(llm_id, integration_type)`.

---

### `usage_tracking`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → auth.users.id |
| period_start | date | first day of the billing month |
| tokens_used | int8 | cumulative token count for the period |
| updated_at | timestamptz | |

The `increment_usage` RPC atomically increments `tokens_used` to avoid race conditions.

---

## Entity Relationships

```
auth.users
  ├── profiles (1:1)
  ├── chats via created_by (1:many)
  ├── chat_participants (many:many with chats)
  ├── chat_invitations via invited_by (1:many)
  └── usage_tracking (1:many, by period)

chats
  ├── chat_participants (1:many)
  ├── invited_llms (1:many)
  ├── messages (1:many)
  ├── daily_notes (1:many, unique per date)
  └── chat_invitations (1:many)

invited_llms
  ├── llm_connections via llm_id (1:many)
  ├── llm_connections via target_llm_id (1:many — connections pointing to this LLM)
  ├── messages via sender_llm_id (1:many)
  ├── memories (1:many)
  └── llm_integrations (1:many, unique per integration_type)

messages
  └── messages via side_parent_message_id (self-referential 1:many for side-ask threads)
```

---

## Key Queries (via Repository classes)

### Context building (`context_builder.py`)
```sql
-- All non-deleted messages for a chat, oldest-first, with LLM display names
SELECT *, invited_llms(display_name)
FROM messages
WHERE chat_id = :chat_id
  AND (before_created_at IS NULL OR created_at < :before_created_at)
ORDER BY created_at ASC;

-- Connections for an LLM
SELECT * FROM llm_connections WHERE llm_id = :llm_id;
```

### Chat participant check (auth gate)
```sql
SELECT id FROM chat_participants
WHERE chat_id = :chat_id AND user_id = :user_id;
```

### Chat ownership / plan limits
```sql
-- Count chats owned by a user
SELECT COUNT(*) FROM chat_participants
WHERE user_id = :user_id AND role = 'owner';

-- Count human participants in a chat
SELECT COUNT(*) FROM chat_participants WHERE chat_id = :chat_id;
```

### Invitation lookups
```sql
-- Pending (not accepted, not revoked) invitation for an email+chat
SELECT id FROM chat_invitations
WHERE chat_id = :chat_id AND email = :email
  AND accepted_at IS NULL AND revoked_at IS NULL;

-- Active invitations for a chat
SELECT * FROM chat_invitations
WHERE chat_id = :chat_id
  AND accepted_at IS NULL AND revoked_at IS NULL
  AND expires_at > :now
ORDER BY created_at DESC;

-- All pending invitations for an email (claim on login)
SELECT * FROM chat_invitations
WHERE email = :email
  AND accepted_at IS NULL AND revoked_at IS NULL
  AND expires_at > :now;
```

### Token usage (via RPC)
```sql
-- Atomic increment (Postgres function)
SELECT increment_usage(:p_user_id, :p_period, :p_tokens);

-- Read monthly total
SELECT tokens_used FROM usage_tracking
WHERE user_id = :user_id AND period_start = :period;
```

### Memory similarity search (via RPC)
```sql
-- pgvector cosine similarity
SELECT * FROM match_memories(
  query_embedding := :embedding,
  match_threshold := 0.3,
  match_count     := :limit,
  p_chat_id       := :chat_id
);
```

### Message queries used by tools
```sql
-- Recent messages with LLM names (query_chat_data tool)
SELECT sender_type, sender_llm_id, content, created_at, invited_llms(display_name)
FROM messages
WHERE chat_id = :chat_id AND deleted_at IS NULL
ORDER BY created_at DESC LIMIT :limit;
```
