/**
 * Image upload API — backs drag-and-drop / paste / file-pick of images.
 *
 *   POST /api/uploads        — multipart form, field `file`; stores the image in
 *                              R2 and returns { id, url, name, content_type }.
 *                              `url` is /api/uploads/:id — the client uses it
 *                              directly as an <img src>.
 *   GET  /api/uploads/:id     — streams the image bytes from R2, but only to the
 *                              owner (ownership re-checked against notes_uploads).
 *
 * Bytes live in R2 (binding FILES) under users/{ownerId}/notes/{id}.{ext}; the
 * notes_uploads row maps the public id → that key + owner. Notes reference
 * images by id in their `images` JSON; note deletion cleans up R2 + rows.
 */
import { Hono } from "hono";
import type { AppEnv, UploadRow } from "../types";
import { uuid } from "../lib/ids";
import { requireAuthJson } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAuthJson);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per image

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

function sanitizeName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "image"
  );
}

// ── upload ───────────────────────────────────────────────────────────────
app.post("/", async (c) => {
  const user = c.get("user");

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart form data" }, 400);
  }
  // workers-types types FormData.get() without the File member, so cast to the
  // minimal shape we actually use.
  const entry = form.get("file");
  if (!entry || typeof entry === "string") {
    return c.json({ error: "No file provided" }, 400);
  }
  const file = entry as unknown as { type: string; name: string; arrayBuffer(): Promise<ArrayBuffer> };

  const contentType = (file.type || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    return c.json({ error: "Only image files are allowed" }, 415);
  }
  const ext = EXT_BY_TYPE[contentType] || "bin";

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) return c.json({ error: "Empty file" }, 400);
  if (bytes.byteLength > MAX_BYTES) {
    return c.json({ error: "Image is too large (max 10 MB)" }, 413);
  }

  const id = uuid();
  const r2Key = `users/${user.id}/notes/${id}.${ext}`;
  const name = sanitizeName(file.name || `image.${ext}`);
  const now = Math.floor(Date.now() / 1000);

  await c.env.FILES.put(r2Key, bytes, {
    httpMetadata: { contentType },
  });

  await c.env.DB.prepare(
    `INSERT INTO notes_uploads (id, owner_id, r2_key, content_type, name, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, r2Key, contentType, name, bytes.byteLength, now)
    .run();

  return c.json({ id, url: `/api/uploads/${id}`, name, content_type: contentType });
});

// ── serve ────────────────────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT * FROM notes_uploads WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, user.id)
    .first<UploadRow>();
  if (!row) return c.json({ error: "Not found" }, 404);

  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) return c.json({ error: "File missing" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": row.content_type || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(row.size_bytes || obj.size),
    },
  });
});

export default app;
