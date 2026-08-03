# SonicAI — AI Chat + Music Discovery

A secure, production-ready fullstack app that combines a Groq-powered AI
chat assistant with Audius-powered music search. **No API key is ever sent
to, or callable from, the browser.**

## Why this isn't a plain `index.html` / `api/*.js` project

This sandbox is provisioned as a **Next.js (App Router) + PostgreSQL/Drizzle**
project, and the platform's build/deploy/validation pipeline (`next typegen`,
`tsc`, `next build`, health checks) is wired specifically for that framework.
To give you a project that actually builds, deploys, and passes validation on
Vercel, the same architecture you asked for was implemented **on top of
Next.js API Route Handlers** instead of a static `public/index.html` +
standalone `api/*.js` Vercel Functions layout. The security guarantees and
the request/response contracts you asked for are identical:

| Your spec        | This project                              |
| ----------------- | ------------------------------------------ |
| `api/chat.js`      | `src/app/api/chat/route.ts`                |
| `api/music.js`     | `src/app/api/music/route.ts`               |
| `api/speech.js`    | `src/app/api/speech/route.ts`              |
| `api/config.js`    | `src/app/api/config/route.ts` (safe flags only, never returns keys) |
| `index.html` / `script.js` | `src/app/page.tsx` + `src/components/*.tsx` (React) |
| `style.css`        | Tailwind CSS via `src/app/globals.css`      |

Next.js Route Handlers deployed to Vercel **are** Vercel serverless
functions — one is generated per route automatically. Nothing changes about
where your secrets live or who can call the third-party APIs.

## Security

- `GROQ_API_KEY` and `AUDIUS_API_KEY` are read **only** with
  `process.env.*` inside server-side route handlers.
- The frontend (`SonicApp`, `ChatPanel`, `MusicPanel`) only ever calls:
  - `fetch("/api/chat")`
  - `fetch("/api/music")`
  - `fetch("/api/speech")`
  - `fetch("/api/config")` (public, non-secret feature flags only)
- No key, token, or secret is ever included in any HTML, JS bundle, or
  network response sent to the browser.

## API Routes

### `POST /api/chat`
Streams a Groq chat completion as Server-Sent Events.

```jsonc
// Request
{ "sessionId": "optional-uuid", "message": "Recommend a chill playlist" }
```

Response is `text/event-stream`, each event a JSON line:
`{"content":"..."}` for text deltas, `{"sessionId":"..."}` once at the start,
`{"error":"..."}` on failure, and `{"done":true}` at the end.

Conversation memory is persisted per `sessionId` in Postgres
(`chat_messages` table) so follow-up requests include prior turns
automatically. `DELETE /api/chat?sessionId=...` clears a conversation.

### `GET /api/music?q=<query>&limit=<n>`
Searches Audius and returns:

```jsonc
{
  "query": "lofi",
  "count": 12,
  "results": [
    {
      "id": "...",
      "title": "...",
      "artist": "...",
      "genre": "Electronic",
      "durationSeconds": 184,
      "artwork": "https://.../480x480.jpg",
      "streamUrl": "https://api.audius.co/v1/tracks/<id>/stream?app_name=SonicAI"
    }
  ]
}
```

### `POST /api/speech`
Dual-purpose voice endpoint backed by Groq:

- Send `multipart/form-data` with an `audio` field → **speech-to-text**
  (Whisper), returns `{ "text": "..." }`.
- Send `application/json` `{ "text": "...", "voice": "Fritz-PlayAI" }` →
  **text-to-speech** (PlayAI TTS), returns a streamed `audio/wav` file.

### `GET /api/config`
Returns only boolean feature flags (`chatEnabled`, `musicEnabled`,
`speechEnabled`) computed from whether the server env vars are set — never
the key values themselves.

## Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in
your local `.env` for development):

| Variable          | Required | Used by                     |
| ----------------- | -------- | ---------------------------- |
| `DATABASE_URL`    | Yes      | Postgres/Drizzle (chat memory) |
| `GROQ_API_KEY`    | Yes      | `/api/chat`, `/api/speech`    |
| `AUDIUS_API_KEY`  | Optional | `/api/music` (raises rate limits; search still works without it) |

## Database

`src/db/schema.ts` defines a `chat_messages` table used purely for
conversation memory. Apply schema changes with:

```bash
npx drizzle-kit push
```

## Local Development

```bash
npm install
npx drizzle-kit push
npm run dev
```

## Deploying to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket and import it in Vercel.
2. Add `DATABASE_URL`, `GROQ_API_KEY`, and `AUDIUS_API_KEY` under
   Environment Variables.
3. Deploy — Vercel auto-detects Next.js (also declared in `vercel.json`).
