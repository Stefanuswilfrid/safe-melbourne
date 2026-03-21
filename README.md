# Safe Melbourne - OSINT Safety Monitoring Platform

A real-time safety monitoring platform for Melbourne that tracks incidents, protests, road closures, and safety alerts by scraping TikTok and Twitter/X using AI-powered location extraction.

## What It Does

- **Interactive Map**: Real-time map showing incidents and safety alerts across Melbourne
- **AI Chat Assistant**: Ask natural language questions about current safety situations
- **TikTok Scraping**: Automatically scrapes Melbourne incident videos and extracts locations using AI
- **Twitter/X Scraping**: Monitors Melbourne-related tweets for safety alerts and incidents
- **Road Closures**: Tracks and displays road closure incidents
- **RSS News Monitoring**: Processes news articles for relevant safety events
- **Bot Detection**: Flags potentially bot-generated Twitter content

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Database**: Neon PostgreSQL with Prisma ORM
- **Cache**: Upstash Redis
- **AI**: OpenRouter + OpenAI GPT-4o (location extraction, chat)
- **Maps**: Mapbox GL JS
- **Scraping**: RapidAPI (TikTok + Twitter/X)
- **Geocoding**: Google Maps API with smart caching
- **Deployment**: Vercel (with cron jobs)

## Quick Start

### 1. Clone and Install
```bash
git clone <repository-url>
cd safe-melbourne
npm install
```

### 2. Environment Setup

Copy `.env.example` and fill in the values:
```bash
cp .env.example .env
```

Required environment variables:
```env
DATABASE_URL=                     # Neon PostgreSQL connection string
NEXT_PUBLIC_MAPBOX_TOKEN=         # Mapbox public token
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=  # Google Maps API key
OPENAI_API_KEY=                   # OpenAI API key (for chat)
OPENROUTER_API_KEY=               # OpenRouter API key (for scraping AI)
RAPIDAPI_KEY=                     # RapidAPI key (TikTok + Twitter scraping)
UPSTASH_REDIS_REST_URL=           # Upstash Redis URL
UPSTASH_REDIS_REST_TOKEN=         # Upstash Redis token
SCRAPE_SECRET=                    # Random secret for scrape endpoint auth
CRON_SECRET=                      # Random secret for Vercel cron auth
NEXT_PUBLIC_APP_URL=              # Your deployment URL
NEXT_PUBLIC_APP_TITLE=            # App title (e.g. "Safe Melbourne")
```

Generate `SCRAPE_SECRET` and `CRON_SECRET` with:
```bash
openssl rand -hex 32
```

### 3. Database Setup
```bash
npx prisma generate
npx prisma migrate dev
```

If Migrate reports drift on an existing database, use `prisma db execute` with the SQL under `prisma/migrations/` as needed (e.g. `scrape_runs`).

### 4. Run Development Server
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Scraping

### TikTok
**Default behaviour (no mode env vars):** TikTok **search** runs for each term in `DEFAULT_TIKTOK_SEARCH_KEYWORDS` in [`src/config/tiktok-scrape-accounts.ts`](src/config/tiktok-scrape-accounts.ts). Only hits from **curated news accounts** (`DEFAULT_TIKTOK_NEWS_ACCOUNTS`, or `SCRAPE_TIKTOK_ACCOUNTS` if you set it) are kept — then each video is processed (AI location → geocode → `events`).

**Optional overrides:**

```env
# Replace the default keyword list (pipe-separated). Optional {date} → DD/MM/YYYY today.
SCRAPE_KEYWORDS=melbourne stabbing|melbourne crash

# Replace the default curated accounts (pipe-separated handles, no @).
SCRAPE_TIKTOK_ACCOUNTS=7newsmelbourne|9newsmelbourne
```

If RapidAPI’s “User” endpoint path differs from `user/posts` (only relevant for other tooling), set `SCRAPE_TIKTOK_USER_POSTS_PATH` without a leading slash.

### Twitter/X
Searches for Melbourne-related tweets via RapidAPI. Stores tweets with social metrics and bot detection signals.

Default keywords (override with `TWITTER_SEARCH_KEYWORDS` env var, pipe-separated):
```
melbourne protest | melbourne incident | melbourne stabbing | melbourne shooting | melbourne crash | melbourne fight | melbourne attack | melbourne emergency
```

### Triggering Scrapes Manually

```bash
# TikTok
curl -X GET "http://localhost:3000/api/scrape/tiktok" \
  -H "x-internal-cron: true" \
  -H "x-scrape-secret: YOUR_SCRAPE_SECRET"

# Twitter
curl -X GET "http://localhost:3000/api/twitter/search" \
  -H "x-internal-cron: true" \
  -H "x-scrape-secret: YOUR_SCRAPE_SECRET"

# Both (via cron endpoint)
curl -X GET "http://localhost:3000/api/scrape/cron" \
  -H "x-internal-cron: true" \
  -H "x-scrape-secret: YOUR_SCRAPE_SECRET"
```

### Scrape observability (UI + API)

- **Dashboard:** [`/admin/scraping`](http://localhost:3000/admin/scraping) — live TikTok progress (from `/api/scrape/status`), run history, and expandable JSON per run. History is read **on the server** (Prisma + Server Actions), so you do not paste `SCRAPE_SECRET` in the browser; protect `/admin/*` in production if the data is sensitive (middleware, Vercel password, etc.).
- **List runs (scripts / curl):** `GET /api/scrape/runs?limit=50&job=tiktok` with header `x-scrape-secret` or `Authorization: Bearer …` matching `SCRAPE_SECRET` or `ADMIN_SECRET`. If neither env var is set, the API is open (local dev only).
- **Single run:** `GET /api/scrape/runs/:id` with the same auth.

Each TikTok and Twitter scrape creates a row in `scrape_runs` (summary + capped outcome list). Apply the table if your database was created outside Prisma Migrate:

```bash
npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20250321120000_add_scrape_runs/migration.sql
```

Or paste the SQL from that file into the Neon (or Postgres) console.

## Cron Jobs

Configured in `vercel.json` — runs daily at 09:00 UTC:

```json
{
  "crons": [
    { "path": "/api/scrape/cron", "schedule": "0 9 * * *" }
  ]
}
```

The cron endpoint runs TikTok and Twitter scraping in parallel.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/events` | GET | Fetch safety events |
| `/api/events` | POST | Report a new event |
| `/api/events/stream` | GET | Real-time SSE updates |
| `/api/chat` | POST | AI chat about current safety |
| `/api/scrape/tiktok` | GET | Run TikTok scrape (auth required) |
| `/api/scrape/cron` | GET | Run all scrapers (auth required) |
| `/api/twitter/search` | GET | Run Twitter scrape (auth required) |
| `/api/twitter/data` | GET | View stored Twitter data (admin) |
| `/api/road-closures` | GET | Road closure data |
| `/api/hoax/search` | GET | Search hoax database |

## Deployment

### Vercel

1. Push to GitHub and connect to Vercel
2. Set all environment variables in Vercel → Settings → Environment Variables
3. Make sure `NEXT_PUBLIC_APP_URL` is set to your deployment URL (e.g. `https://safe-melbourne.vercel.app`)
4. The build command is set in `vercel.json`: `prisma generate && next build`
5. Cron jobs activate automatically on deploy

## Security

- Scrape endpoints require `x-internal-cron: true` + `x-scrape-secret` headers
- Vercel cron jobs authenticate via `CRON_SECRET` in the `Authorization: Bearer` header
- Admin endpoints require admin authentication
- Rate limiting applied to public-facing API endpoints

---

**Safe Melbourne** — Keeping communities informed through real-time OSINT monitoring and AI-powered insights.
