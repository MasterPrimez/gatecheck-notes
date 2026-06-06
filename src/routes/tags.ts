/**
 * Tags CRUD API.
 *
 *   GET    /api/tags         — list the user's tags (ordered for the tag bar)
 *   POST   /api/tags         — create a tag (optionally nested under a parent)
 *   PUT    /api/tags/:id      — rename / reorder / reparent
 *   DELETE /api/tags/:id      — delete the tag everywhere; notes are kept
 *
 * Tags are stored WITHOUT the leading '#'. Renaming a tag updates it across
 * every note automatically (the notes reference it by id). Deleting removes the
 * note↔tag links via ON DELETE CASCADE but never touches the notes themselves.
 */
import { Hono } from "hono";
import type { AppEnv, TagRow, TagDTO } from "../types";
import { uuid } from "../lib/ids";
import { requireAuthJson } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAuthJson);

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function toDTO(row: TagRow): TagDTO {
  return { id: row.id, name: row.name, parent_id: row.parent_id, position: row.position };
}

// ── list ─────────────────────────────────────────────────────────────────
app.get("/", async (c) => {
  const user = c.get("user");
  const res = await c.env.DB.prepare(
    `SELECT * FROM notes_tags WHERE owner_id = ? ORDER BY position ASC, name COLLATE NOCASE ASC`,
  )
    .bind(user.id)
    .all<TagRow>();
  return c.json({ tags: (res.results ?? []).map(toDTO) });
});

// ── create ───────────────────────────────────────────────────────────────
app.post("/", async (c) => {
  const user = c.get("user");
  let body: { name?: string; parent_id?: string | null; position?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const name = normalizeName(body.name);
  if (!name) return c.json({ error: "Tag name is required" }, 400);

  // Validate parent belongs to this user (one level of nesting).
  let parentId: string | null = null;
  if (body.parent_id) {
    const parent = await c.env.DB.prepare(
      `SELECT id FROM notes_tags WHERE id = ? AND owner_id = ? AND parent_id IS NULL`,
    )
      .bind(body.parent_id, user.id)
      .first<{ id: string }>();
    if (!parent) return c.json({ error: "Parent tag not found" }, 400);
    parentId = parent.id;
  }

  // Return the existing tag if it's a duplicate (idempotent create).
  const dupe = await c.env.DB.prepare(
    `SELECT * FROM notes_tags WHERE owner_id = ? AND name = ? COLLATE NOCASE AND ${parentId ? "parent_id = ?" : "parent_id IS NULL"}`,
  )
    .bind(...(parentId ? [user.id, name, parentId] : [user.id, name]))
    .first<TagRow>();
  if (dupe) return c.json({ tag: toDTO(dupe) });

  const id = uuid();
  const position = Number.isFinite(body.position) ? Number(body.position) : now();
  const row: TagRow = {
    id,
    owner_id: user.id,
    name,
    parent_id: parentId,
    position,
    created_at: now(),
  };
  await c.env.DB.prepare(
    `INSERT INTO notes_tags (id, owner_id, name, parent_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, name, parentId, position, row.created_at)
    .run();
  return c.json({ tag: toDTO(row) });
});

// ── update ───────────────────────────────────────────────────────────────
app.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: { name?: string; parent_id?: string | null; position?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT * FROM notes_tags WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, user.id)
    .first<TagRow>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) return c.json({ error: "Tag name is required" }, 400);
    updates.push("name = ?");
    values.push(name);
  }
  if (body.parent_id !== undefined) {
    let parentId: string | null = null;
    if (body.parent_id) {
      if (body.parent_id === id) return c.json({ error: "A tag cannot be its own parent" }, 400);
      const parent = await c.env.DB.prepare(
        `SELECT id FROM notes_tags WHERE id = ? AND owner_id = ? AND parent_id IS NULL`,
      )
        .bind(body.parent_id, user.id)
        .first<{ id: string }>();
      if (!parent) return c.json({ error: "Parent tag not found" }, 400);
      parentId = parent.id;
    }
    updates.push("parent_id = ?");
    values.push(parentId);
  }
  if (body.position !== undefined && Number.isFinite(body.position)) {
    updates.push("position = ?");
    values.push(Number(body.position));
  }

  if (updates.length === 0) return c.json({ tag: toDTO(existing) });
  values.push(id, user.id);
  await c.env.DB.prepare(
    `UPDATE notes_tags SET ${updates.join(", ")} WHERE id = ? AND owner_id = ?`,
  )
    .bind(...values)
    .run();

  const fresh = await c.env.DB.prepare(`SELECT * FROM notes_tags WHERE id = ?`).bind(id).first<TagRow>();
  return c.json({ tag: toDTO(fresh!) });
});

// ── delete ───────────────────────────────────────────────────────────────
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    `SELECT id FROM notes_tags WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, user.id)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "Not found" }, 404);
  // note_tags rows + any child tags cascade; the notes themselves are untouched.
  await c.env.DB.prepare(`DELETE FROM notes_tags WHERE id = ? AND owner_id = ?`).bind(id, user.id).run();
  return c.json({ ok: true });
});

export default app;
