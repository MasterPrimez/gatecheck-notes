/**
 * Notes CRUD API.
 *
 *   GET    /api/notes            — list all of the user's notes (with tag ids)
 *   POST   /api/notes            — create a note or todo
 *   GET    /api/notes/:id        — get one
 *   PUT    /api/notes/:id        — update (any subset of fields, incl. tags)
 *   DELETE /api/notes/:id        — delete (note_tags rows cascade)
 *
 * Everything is scoped `WHERE owner_id = user.id`.
 */
import { Hono } from "hono";
import type { AppEnv, NoteDTO, NoteRow, NoteKind, TodoItem, NoteImage } from "../types";
import { uuid } from "../lib/ids";
import { requireAuthJson } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAuthJson);

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function parseItems(raw: string | null): TodoItem[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((x) => x && typeof x.text === "string")
      .map((x) => ({ text: String(x.text), done: !!x.done }));
  } catch {
    return null;
  }
}

function sanitizeItems(input: unknown): TodoItem[] | null {
  if (!Array.isArray(input)) return null;
  // Keep empty rows too — the user may add a blank item then fill it in.
  return input
    .filter((x): x is { text: unknown; done?: unknown } => !!x && typeof x === "object")
    .map((x) => ({
      text: String((x as { text: unknown }).text ?? "").slice(0, 2000),
      done: !!(x as { done?: unknown }).done,
    }));
}

function parseImages(raw: string | null): NoteImage[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.id === "string")
      .map((x) => ({ id: String(x.id), url: `/api/uploads/${String(x.id)}`, name: String(x.name ?? "") }));
  } catch {
    return [];
  }
}

function toDTO(row: NoteRow, tagIds: string[]): NoteDTO {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    items: parseItems(row.items),
    images: parseImages(row.images),
    pinned: !!row.pinned,
    done: !!row.done,
    archived: !!row.archived,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tag_ids: tagIds,
  };
}

type Ctx = { env: AppEnv["Bindings"] };

/** Keep only tag ids that actually belong to this user. */
async function filterOwnedTagIds(c: Ctx, ownerId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x))];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const res = await c.env.DB.prepare(
    `SELECT id FROM notes_tags WHERE owner_id = ? AND id IN (${placeholders})`,
  )
    .bind(ownerId, ...unique)
    .all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}

/**
 * Validate a note's `images` payload: keep only upload ids that belong to this
 * user (so a note can't reference someone else's image), preserving order, and
 * re-derive the canonical url + a clean name. Returns the JSON string to store
 * (or null if there are no valid images).
 */
async function ownedImagesJson(c: Ctx, ownerId: string, input: unknown): Promise<string | null> {
  if (!Array.isArray(input) || input.length === 0) return null;
  const ids: string[] = [];
  const nameById: Record<string, string> = {};
  for (const x of input) {
    if (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") {
      const id = String((x as { id: string }).id);
      ids.push(id);
      nameById[id] = String((x as { name?: unknown }).name ?? "").slice(0, 200);
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  const placeholders = unique.map(() => "?").join(",");
  const res = await c.env.DB.prepare(
    `SELECT id, name FROM notes_uploads WHERE owner_id = ? AND id IN (${placeholders})`,
  )
    .bind(ownerId, ...unique)
    .all<{ id: string; name: string | null }>();
  const ownedNames = new Map<string, string | null>();
  for (const r of res.results ?? []) ownedNames.set(r.id, r.name);
  // keep original order, only owned ids, dedup
  const seen = new Set<string>();
  const out: NoteImage[] = [];
  for (const id of ids) {
    if (!ownedNames.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url: `/api/uploads/${id}`, name: nameById[id] || ownedNames.get(id) || "" });
  }
  return out.length ? JSON.stringify(out) : null;
}

/** Best-effort: delete the R2 objects + rows for a set of upload ids owned by the user. */
async function deleteUploads(c: Ctx, ownerId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x))];
  if (unique.length === 0) return;
  const placeholders = unique.map(() => "?").join(",");
  const res = await c.env.DB.prepare(
    `SELECT id, r2_key FROM notes_uploads WHERE owner_id = ? AND id IN (${placeholders})`,
  )
    .bind(ownerId, ...unique)
    .all<{ id: string; r2_key: string }>();
  const rows = res.results ?? [];
  for (const r of rows) {
    await c.env.FILES.delete(r.r2_key).catch(() => undefined);
  }
  if (rows.length) {
    const ph = rows.map(() => "?").join(",");
    await c.env.DB.prepare(`DELETE FROM notes_uploads WHERE owner_id = ? AND id IN (${ph})`)
      .bind(ownerId, ...rows.map((r) => r.id))
      .run()
      .catch(() => undefined);
  }
}

function imageIdsOf(raw: string | null): string[] {
  return parseImages(raw).map((i) => i.id);
}

async function setNoteTags(c: Ctx, noteId: string, tagIds: string[]): Promise<void> {
  await c.env.DB.prepare(`DELETE FROM notes_note_tags WHERE note_id = ?`).bind(noteId).run();
  if (tagIds.length === 0) return;
  const stmts = tagIds.map((tagId) =>
    c.env.DB.prepare(`INSERT OR IGNORE INTO notes_note_tags (note_id, tag_id) VALUES (?, ?)`).bind(noteId, tagId),
  );
  await c.env.DB.batch(stmts);
}

// ── list ─────────────────────────────────────────────────────────────────
app.get("/", async (c) => {
  const user = c.get("user");
  const notesRes = await c.env.DB.prepare(
    `SELECT * FROM notes_notes WHERE owner_id = ? ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all<NoteRow>();
  const notes = notesRes.results ?? [];

  const linksRes = await c.env.DB.prepare(
    `SELECT nt.note_id, nt.tag_id
       FROM notes_note_tags nt
       JOIN notes_notes n ON n.id = nt.note_id
      WHERE n.owner_id = ?`,
  )
    .bind(user.id)
    .all<{ note_id: string; tag_id: string }>();

  const byNote = new Map<string, string[]>();
  for (const row of linksRes.results ?? []) {
    const list = byNote.get(row.note_id) ?? [];
    list.push(row.tag_id);
    byNote.set(row.note_id, list);
  }

  return c.json({ notes: notes.map((n) => toDTO(n, byNote.get(n.id) ?? [])) });
});

// ── create ───────────────────────────────────────────────────────────────
app.post("/", async (c) => {
  const user = c.get("user");
  let body: {
    kind?: string;
    content?: string;
    items?: unknown;
    images?: unknown;
    tag_ids?: string[];
    pinned?: boolean;
    done?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const kind: NoteKind = body.kind === "todo" ? "todo" : "note";
  const content = (body.content ?? "").toString().slice(0, 20000);
  const items = kind === "todo" ? sanitizeItems(body.items) : null;
  const imagesJson = await ownedImagesJson(c, user.id, body.images);

  // A note is non-empty if it has text, todo items, OR at least one image.
  if (kind === "note" && !content.trim() && !imagesJson) {
    return c.json({ error: "Note is empty" }, 400);
  }
  if (kind === "todo" && !content.trim() && (!items || items.length === 0) && !imagesJson) {
    return c.json({ error: "Todo is empty" }, 400);
  }

  const id = uuid();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO notes_notes (id, owner_id, kind, content, items, images, pinned, done, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      kind,
      content,
      items ? JSON.stringify(items) : null,
      imagesJson,
      body.pinned ? 1 : 0,
      body.done ? 1 : 0,
      ts,
      ts,
    )
    .run();

  const tagIds = await filterOwnedTagIds(c, user.id, body.tag_ids ?? []);
  await setNoteTags(c, id, tagIds);

  const row: NoteRow = {
    id,
    owner_id: user.id,
    kind,
    content,
    items: items ? JSON.stringify(items) : null,
    images: imagesJson,
    pinned: body.pinned ? 1 : 0,
    done: body.done ? 1 : 0,
    archived: 0,
    archived_at: null,
    created_at: ts,
    updated_at: ts,
  };
  return c.json({ note: toDTO(row, tagIds) });
});

// ── get one ──────────────────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT * FROM notes_notes WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, user.id)
    .first<NoteRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const tags = await c.env.DB.prepare(`SELECT tag_id FROM notes_note_tags WHERE note_id = ?`)
    .bind(id)
    .all<{ tag_id: string }>();
  return c.json({ note: toDTO(row, (tags.results ?? []).map((t) => t.tag_id)) });
});

// ── update ───────────────────────────────────────────────────────────────
app.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: {
    kind?: string;
    content?: string;
    items?: unknown;
    images?: unknown;
    tag_ids?: string[];
    pinned?: boolean;
    done?: boolean;
    archived?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT * FROM notes_notes WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, user.id)
    .first<NoteRow>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  let removedImageIds: string[] = [];

  let kind: NoteKind = existing.kind;
  if (body.kind === "todo" || body.kind === "note") {
    kind = body.kind;
    updates.push("kind = ?");
    values.push(kind);
  }
  if (body.content !== undefined) {
    updates.push("content = ?");
    values.push(body.content.toString().slice(0, 20000));
  }
  if (body.items !== undefined) {
    const items = sanitizeItems(body.items);
    updates.push("items = ?");
    values.push(items ? JSON.stringify(items) : null);
  }
  if (body.images !== undefined) {
    const imagesJson = await ownedImagesJson(c, user.id, body.images);
    const keptIds = new Set(imageIdsOf(imagesJson));
    removedImageIds = imageIdsOf(existing.images).filter((iid) => !keptIds.has(iid));
    updates.push("images = ?");
    values.push(imagesJson);
  }
  if (body.pinned !== undefined) {
    updates.push("pinned = ?");
    values.push(body.pinned ? 1 : 0);
  }
  if (body.done !== undefined) {
    updates.push("done = ?");
    values.push(body.done ? 1 : 0);
  }
  if (body.archived !== undefined) {
    updates.push("archived = ?");
    values.push(body.archived ? 1 : 0);
    updates.push("archived_at = ?");
    values.push(body.archived ? now() : null);
  }

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    values.push(now());
    values.push(id, user.id);
    await c.env.DB.prepare(
      `UPDATE notes_notes SET ${updates.join(", ")} WHERE id = ? AND owner_id = ?`,
    )
      .bind(...values)
      .run();
  }

  // Clean up R2 objects for images removed during this edit.
  if (removedImageIds.length) await deleteUploads(c, user.id, removedImageIds);

  let tagIds: string[] | undefined;
  if (body.tag_ids !== undefined) {
    tagIds = await filterOwnedTagIds(c, user.id, body.tag_ids ?? []);
    await setNoteTags(c, id, tagIds);
  }

  // Return the fresh state.
  const fresh = await c.env.DB.prepare(`SELECT * FROM notes_notes WHERE id = ?`).bind(id).first<NoteRow>();
  const tagRows = await c.env.DB.prepare(`SELECT tag_id FROM notes_note_tags WHERE note_id = ?`)
    .bind(id)
    .all<{ tag_id: string }>();
  return c.json({ note: toDTO(fresh!, (tagRows.results ?? []).map((t) => t.tag_id)) });
});

// ── delete ───────────────────────────────────────────────────────────────
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    `SELECT id, images FROM notes_notes WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, user.id)
    .first<{ id: string; images: string | null }>();
  if (!existing) return c.json({ error: "Not found" }, 404);
  // Best-effort cleanup of the note's uploaded images (R2 objects + rows).
  await deleteUploads(c, user.id, imageIdsOf(existing.images));
  await c.env.DB.prepare(`DELETE FROM notes_notes WHERE id = ? AND owner_id = ?`).bind(id, user.id).run();
  return c.json({ ok: true });
});

export default app;
