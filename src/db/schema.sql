-- GateCheck Notes schema  (the MindChuk-style sticky board)
--
-- These tables live in the SAME D1 database as auth's `users`/`sessions`
-- (shared database_id in wrangler.toml), so `ON DELETE CASCADE` from `users`
-- cleans everything up when an account is deleted. All app tables are prefixed
-- `notes_` to stay clear of other tools sharing the DB.
--
-- Run with:
--   Local:  npm run db:migrate:local
--   Remote: npm run db:migrate:remote
--
-- Idempotent (CREATE IF NOT EXISTS) so it's safe to re-run.

-- ── Notes / cards ──────────────────────────────────────────────────────────
-- One row per sticky note. `kind` is 'note' (free text) or 'todo' (checklist).
-- For 'todo', `items` holds a JSON array: [{ "text": "...", "done": false }, …].
CREATE TABLE IF NOT EXISTS notes_notes (
  id          TEXT PRIMARY KEY,                                  -- crypto.randomUUID()
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'note',                      -- 'note' | 'todo'
  content     TEXT NOT NULL DEFAULT '',                          -- note body, or todo title
  items       TEXT,                                              -- JSON array of {text,done} for todos; NULL for notes
  pinned      INTEGER NOT NULL DEFAULT 0,                        -- 0/1
  done        INTEGER NOT NULL DEFAULT 0,                        -- 0/1 (the strike-through "DONE" state)
  created_at  INTEGER NOT NULL,                                  -- unix epoch seconds — drives the "May 15 · 9:24 AM" stamp
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_owner       ON notes_notes(owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner_created ON notes_notes(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_owner_pinned  ON notes_notes(owner_id, pinned);

-- ── Tags ───────────────────────────────────────────────────────────────────
-- First-class, per-user tags. Editing a tag's name updates it everywhere it's
-- used; deleting a tag removes the links (via CASCADE on the join table) but
-- leaves the notes intact — exactly the behaviour the inspiration app wanted.
CREATE TABLE IF NOT EXISTS notes_tags (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                                     -- stored WITHOUT the leading '#'
  parent_id   TEXT REFERENCES notes_tags(id) ON DELETE CASCADE,  -- optional sub-tag nesting (e.g. #MINDCHUK ▸ child)
  position    INTEGER NOT NULL DEFAULT 0,                        -- display order in the tag bar
  created_at  INTEGER NOT NULL,
  UNIQUE(owner_id, name, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_tags_owner  ON notes_tags(owner_id);
CREATE INDEX IF NOT EXISTS idx_tags_parent ON notes_tags(parent_id);

-- ── Note ↔ Tag join ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes_note_tags (
  note_id  TEXT NOT NULL REFERENCES notes_notes(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES notes_tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON notes_note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON notes_note_tags(note_id);

-- ── Link-preview cache ─────────────────────────────────────────────────────
-- OpenGraph metadata scraped server-side for generic URLs, cached so we don't
-- re-fetch a page every time a card renders. Keyed by SHA-256 of the URL.
-- Not owner-scoped — link metadata is public and the same for everyone.
CREATE TABLE IF NOT EXISTS notes_link_cache (
  url_hash    TEXT PRIMARY KEY,                                  -- SHA-256 hex of the normalized URL
  url         TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'link',                      -- 'link' | 'image' | 'error'
  title       TEXT,
  description TEXT,
  image       TEXT,
  site_name   TEXT,
  favicon     TEXT,
  fetched_at  INTEGER NOT NULL
);
