# gatecheck-notes

A MindChuk-style **sticky-note board** for the GateCheck toolkit. Capture a
thought as a dated note, organize with tags, build quick to-do lists, and paste
a YouTube / Vimeo / X / website link to get a live preview right on the card.

Runs at **`notes.gatecheck.net`** as a Cloudflare Worker (Hono + TypeScript),
sharing the same D1 + R2 + session cookie as the rest of GateCheck — so you're
already signed in if you're signed in anywhere on `*.gatecheck.net`.

## What it does

- **Quick capture** — type a note at the top, ⌘↵ to save. Each note is stamped
  with the date/time it was created (`May 15 · 9:24 AM`).
- **Notes & to-do lists** — toggle the composer between a free-text Note and a
  checklist To-Do (with a `3/7` progress count on the card).
- **Tags** — first-class, per-user tags (with optional one level of nesting).
  Filter the board by tag, multi-tag a note, and **Edit Tags** to rename or
  delete. Renaming updates a tag everywhere; deleting removes it from notes but
  **keeps the notes**.
- **Rich media previews** — paste a link and the card renders the right thing:
  - **YouTube / Vimeo** → inline video player (privacy-friendly `nocookie` /
    `player.vimeo.com` embeds)
  - **X (Twitter)** → the embedded tweet
  - **Direct image URLs** (`.jpg/.png/.gif/.webp/…`) → the image inline
  - **Any other site** → an OpenGraph card (thumbnail, title, description,
    favicon), scraped server-side and cached
- **Search** by text *or* date (`may 15`, `2025-05-15`, a word, a tag).
- **View options** (the `⋯` menu): Group by time frame, Compact view, Sort
  oldest first. Pinned notes always float to the top. Notes can be marked
  **Done** (dimmed + struck through).

## Architecture (same pattern as the other GateCheck tools)

```
notes.gatecheck.net   ← this Worker (gatecheck-notes)
  binds DB    → gatecheck-auth D1   (SAME database_id as auth + shotlister)
  binds FILES → gatecheck-files R2  (reserved for future image uploads)
```

- **No call to `auth.gatecheck.net`.** Identity is resolved directly: read the
  `__Secure-gatecheck-session` cookie → SHA-256 → look up `sessions.id_hash`
  JOIN `users` in the shared D1. See `src/lib/auth.ts` (copied verbatim from
  shotlister — this is the shared SSO pattern).
- All data is scoped `WHERE owner_id = user.id`. App tables are prefixed
  `notes_*` and live in the *same* D1 as `users`, so `ON DELETE CASCADE` from a
  deleted user cleans everything up.
- The board is rendered **client-side** (`src/pages/app.client.ts`) from
  `/api/notes` + `/api/tags`; the server only ships the static shell. One render
  path = no server/client card-markup drift.
- Link previews are scraped by the Worker (`src/lib/preview.ts`) using
  `HTMLRewriter`, with a 512 KB read cap, a 6 s timeout, an SSRF guard
  (blocks private/loopback hosts), and a D1 cache (`notes_link_cache`).

```
src/index.ts            Hono router + notFound/onError
src/types.ts            Env, User, Note/Tag DTOs
src/db/schema.sql       notes_notes, notes_tags, notes_note_tags, notes_link_cache
src/lib/auth.ts         session cookie → user (shared D1 lookup)
src/lib/ids.ts          uuid + sha256
src/lib/preview.ts      server-side OpenGraph scraper (+ SSRF guard)
src/lib/ui.ts           page chrome + the full stylesheet
src/routes/notes.ts     /api/notes  CRUD
src/routes/tags.ts      /api/tags   CRUD
src/routes/preview.ts   /api/preview (cache-then-scrape)
src/pages/index.ts      GET /  (static shell)
src/pages/app.client.ts the browser board app (vanilla JS, shipped as a string)
```

## Develop

```bash
npm install
npm run dev          # http://localhost:8787  (hot reload)
npm run typecheck    # tsc --noEmit  (no test suite — this is the gate)
```

Local dev needs a session cookie from auth. Either sign in on a `*.gatecheck.net`
domain in the same browser, or hit the local server with a valid
`__Secure-gatecheck-session` cookie.

## Database

The `notes_*` tables live in the shared `gatecheck-auth` D1. Apply the schema
once (idempotent — it only adds the new tables):

```bash
npm run db:migrate:local     # local .wrangler D1
npm run db:migrate:remote    # production D1  (do this once after first deploy)
npm run db:console:remote    # peek at stored notes
```

## Deploy

Like `gatecheck-shotlister`, this is designed for **Cloudflare Workers Builds**
(Git integration):

1. Push to GitHub (e.g. `github.com/MasterPrimez/gatecheck-notes`).
2. Cloudflare dashboard → Workers & Pages → Create → Connect to Git.
   - Build command: `npm install`
   - Deploy command: `npx wrangler deploy`
3. Attach bindings if they don't auto-resolve:
   - D1 `DB` → `gatecheck-auth`
   - R2 `FILES` → `gatecheck-files`
4. Add custom domain `notes.gatecheck.net` to the Worker (dashboard).
5. Run `npm run db:migrate:remote` once.

Or deploy directly with `npm run deploy` (`wrangler deploy`) if you have wrangler
authenticated locally.

## API

All `/api/*` routes require the session cookie (401 JSON otherwise).

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/health` | no auth; service ping |
| GET | `/api/notes` | list notes (with `tag_ids`) |
| POST | `/api/notes` | `{ kind:'note'\|'todo', content, items?, tag_ids?, pinned?, done? }` |
| GET | `/api/notes/:id` | one note |
| PUT | `/api/notes/:id` | any subset of the create fields |
| DELETE | `/api/notes/:id` | delete |
| GET | `/api/tags` | list tags |
| POST | `/api/tags` | `{ name, parent_id?, position? }` (idempotent on name) |
| PUT | `/api/tags/:id` | `{ name?, parent_id?, position? }` |
| DELETE | `/api/tags/:id` | delete tag (notes kept) |
| GET | `/api/preview?url=…` | OpenGraph preview JSON (cached) |

```bash
# example (replace COOKIE)
curl -s https://notes.gatecheck.net/api/notes \
  -H "cookie: __Secure-gatecheck-session=COOKIE" | jq

curl -s -X POST https://notes.gatecheck.net/api/notes \
  -H "cookie: __Secure-gatecheck-session=COOKIE" \
  -H "content-type: application/json" \
  -d '{"kind":"note","content":"Lighting idea https://youtu.be/dQw4w9WgXcQ","tag_ids":[]}'
```

## Notes

- A to-do note stores its checklist as JSON in `notes_notes.items`; the note's
  `content` is the list title.
- Pinning/Done/checkbox toggles persist immediately via `PUT /api/notes/:id`.
- View options (group / compact / oldest-first) are remembered per-browser in
  `localStorage`.
- X/Twitter embeds load `platform.twitter.com/widgets.js` lazily; if a tweet
  can't be embedded, the link still renders. YouTube/Vimeo/X are detected
  client-side from the URL — only generic links hit `/api/preview`.
