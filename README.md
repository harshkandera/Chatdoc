# ChatDoc

Chat with any technical documentation using AI. Paste a docs URL, ChatDoc indexes it, and you get accurate, source-backed answers — no hallucinations, no outdated info.

Built with RAG (Retrieval-Augmented Generation) so every answer is grounded in the actual documentation you indexed.

---

## Features

- **Index any docs** — paste a URL, ChatDoc crawls and indexes the entire documentation site
- **Source-backed answers** — every response cites the exact page it came from
- **Multiple workspaces** — manage different doc sources side by side
- **Smart change detection** — get notified when your indexed docs are updated (RSS / sitemap / hash-based)
- **Re-index on demand** — keep your answers fresh when docs change
- **Multi-provider LLM** — Groq, OpenAI, Gemini, or self-hosted Ollama
- **LangGraph agent** (Pro) — multi-step reasoning for complex questions
- **Web search fallback** (Pro) — escalates to Tavily if docs don't have the answer
- **Free & Pro plans** via Polar

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript |
| Auth | Clerk |
| Database | PostgreSQL (Neon) + Prisma |
| Vector DB | Pinecone |
| Cache | Redis |
| AI / LLM | LangChain, Vercel AI SDK, Groq, OpenAI, Gemini, Ollama |
| Scraping | FireCrawl, Tavily |
| Background jobs | Inngest |
| Billing | Polar |
| Email | Resend |
| Storage | AWS S3 |
| Styling | Tailwind CSS, Radix UI |

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL database (or [Neon](https://neon.tech) free tier)
- [Pinecone](https://pinecone.io) account (free tier works)
- [Clerk](https://clerk.com) account
- [Inngest](https://inngest.com) account
- At least one LLM API key (Groq is free and fast)

### 1. Clone & install

```bash
git clone https://github.com/harshkandera/Chatdoc.git
cd Chatdoc
pnpm install
```

### 2. Set up environment variables

Create a `.env.local` file in the root. See [Environment Variables](#environment-variables) below.

### 3. Set up the database

```bash
npx prisma db push
```

> Use `db push` not `db migrate` — the schema has drift from migration history.

### 4. Run locally

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run Inngest dev server

In a separate terminal (required for background indexing to work):

```bash
npx inngest-cli@latest dev
```

---

## Environment Variables

```bash
# ── App ──────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ── Auth (Clerk) ─────────────────────────────────────────────────────────────
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SIGNING_SECRET=

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@host/db?sslmode=require

# ── Vector DB (Pinecone) ─────────────────────────────────────────────────────
PINECONE_API_KEY=
PINECONE_INDEX=chatdoc

# ── LLM Providers (at least one required) ────────────────────────────────────
GROQ_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=

# ── Embeddings ────────────────────────────────────────────────────────────────
EMBEDDING_PROVIDER=ollama           # ollama | gemini | openai
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

# ── Scraping ──────────────────────────────────────────────────────────────────
SCRAPER_MODE=firecrawl              # firecrawl | traditional
FIRECRAWL_API_KEY=                  # get from firecrawl.dev (leave empty for self-hosted)
FIRECRAWL_API_URL=                  # set for self-hosted, leave empty for cloud

# ── Background Jobs (Inngest) ────────────────────────────────────────────────
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# ── Cache (Redis) — optional but recommended ─────────────────────────────────
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

# ── File Storage (AWS S3) ────────────────────────────────────────────────────
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=

# ── Billing (Polar) — optional for self-hosting ──────────────────────────────
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=
NEXT_PUBLIC_POLAR_PRICE_ID=
NEXT_PUBLIC_POLAR_YEARLY_PRICE_ID=

# ── Email (Resend) — optional ─────────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=ChatDoc <onboarding@yourdomain.com>
RESEND_CONTACT_EMAIL=contact@yourdomain.com
RESEND_SALES_EMAIL=sales@yourdomain.com
RESEND_ADMIN_EMAIL=you@yourdomain.com

# ── Plan Limits ───────────────────────────────────────────────────────────────
NEXT_PUBLIC_FREE_WORKSPACE_LIMIT=1
NEXT_PUBLIC_PRO_WORKSPACE_LIMIT=10
FREE_REINDEX_LIMIT=1
PRO_REINDEX_LIMIT=5
NEXT_PUBLIC_PRO_PRICE=19

# ── Web Search Fallback (Pro feature) ────────────────────────────────────────
TAVILY_API_KEY=

# ── Observability — optional ──────────────────────────────────────────────────
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=chatdoc
LANGCHAIN_API_KEY=
```

---

## Architecture

```
chatdoc/
├── app/
│   ├── api/
│   │   ├── chat/              # RAG chat endpoint (streaming)
│   │   ├── workspaces/        # Workspace CRUD + indexing control
│   │   ├── webhooks/          # Clerk user sync + Polar billing events
│   │   ├── contact/           # Contact form
│   │   └── subscription/      # Usage & plan info
│   └── chat/                  # Chat UI pages
├── components/
│   ├── chat/                  # Chat interface components
│   └── workspace/             # Workspace management UI
├── lib/
│   ├── ai/
│   │   ├── indexer/           # Scrape → chunk → embed → store pipeline
│   │   ├── query/             # RAG query handler
│   │   └── graph/             # LangGraph agent (Pro)
│   ├── db/                    # Prisma helpers
│   ├── emails/                # Resend templates
│   └── inngest/               # Background job definitions
└── prisma/
    └── schema.prisma          # DB schema
```

### Indexing pipeline

```
URL submitted
    → FireCrawl scrapes all pages
    → Text chunked with overlap
    → Chunks embedded (Ollama / Gemini / OpenAI)
    → Vectors upserted to Pinecone
    → Metadata saved to PostgreSQL
    → User notified via email
```

### Query pipeline

```
User message
    → Intent classification (casual vs doc query)
    → Query decomposition (complex questions split into sub-queries)
    → Vector search in Pinecone
    → Context assembled + LLM answer generated
    → Sources returned with response
```

---

## Deployment

The easiest path is [Vercel](https://vercel.com) + [Neon](https://neon.tech).

1. Push to GitHub
2. Import project in Vercel
3. Add all environment variables
4. Deploy

**Webhooks to configure:**

- Inngest: `https://yourdomain.com/api/inngest`
- Clerk: `https://yourdomain.com/api/webhooks/clerk` → subscribe to `user.created`, `user.updated`, `user.deleted`
- Polar: `https://yourdomain.com/api/webhooks/polar`

---

## Scripts

```bash
# Test email delivery for all email types
pnpm tsx scripts/test-emails.ts [recipient]

# Send welcome emails to all existing users
pnpm tsx scripts/send-welcome-emails.ts          # dry-run
pnpm tsx scripts/send-welcome-emails.ts --send   # actually send

# Test FireCrawl scraper
pnpm tsx scripts/test-firecrawl.ts [url]
```

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a PR

---

## License

MIT

---

Built by [Harsh Kandera](https://github.com/harshkandera)
