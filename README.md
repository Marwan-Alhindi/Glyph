# Glyph

Collaborative LLMs and teammates in the same chat.

## Repos

- `glyph-frontend/` — React + Vite + Tailwind v4 client
- `glyph-backend/` — Python server (FastAPI) for LLM orchestration

## Frontend structure

```
glyph-frontend/src/
├── app/                    # Authenticated app UI (after login)
│   ├── components/         # Chat, Message, AIMessage, InviteLLM, InviteUser, LLMContext
│   ├── pages/              # Chat page
│   ├── utils/              # llmColors helper (per-LLM accent palette)
│   ├── services/           # API calls
│   └── AppLayout.jsx       # Shared shell + sidebar
│
├── marketing/              # Public site
│   ├── components/         # Hero, Navigation
│   ├── pages/              # Landing, Login, Getstarted
│   └── MarketingLayout.jsx # Shared marketing shell
│
├── contexts/               # AuthContext
├── components/             # ProtectedRoute
├── services/               # supabase client
├── styles/                 # Tailwind + design tokens
├── main.jsx                # Entry point
└── router.jsx              # React Router setup
```
