/**
 * Link preview API.
 *
 *   GET /api/preview?url=<encoded url>
 *
 * Returns normalized OpenGraph metadata for a generic URL (or a direct image).
 * Results are cached in notes_link_cache keyed by SHA-256 of the URL, so the
 * same link is only scraped once. Auth-gated so this can't be used as an open
 * proxy. YouTube / Vimeo / X are NOT handled here — the client renders real
 * embeds for those from the URL alone.
 */
import { Hono } from "hono";
import type { AppEnv, LinkPreview } from "../types";
import { requireAuthJson } from "../lib/auth";
import { sha256Hex } from "../lib/ids";
import { fetchLinkPreview } from "../lib/preview";

const app = new Hono<AppEnv>();
app.use("*", requireAuthJson);

const OK_TTL = 60 * 60 * 24 * 7; // 7 days
const ERR_TTL = 60 * 60; // 1 hour — retry failed scrapes sooner

interface CacheRow {
  url: string;
  type: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  favicon: string | null;
  fetched_at: number;
}

app.get("/", async (c) => {
  const raw = c.req.query("url");
  if (!raw) return c.json({ error: "Missing url" }, 400);

  const key = await sha256Hex(raw);
  const nowSec = Math.floor(Date.now() / 1000);

  const cached = await c.env.DB.prepare(
    `SELECT url, type, title, description, image, site_name, favicon, fetched_at
       FROM notes_link_cache WHERE url_hash = ?`,
  )
    .bind(key)
    .first<CacheRow>();

  if (cached) {
    const age = nowSec - cached.fetched_at;
    const ttl = cached.type === "error" ? ERR_TTL : OK_TTL;
    if (age < ttl) {
      return c.json({ preview: rowToPreview(cached) });
    }
  }

  const preview = await fetchLinkPreview(raw);

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO notes_link_cache
       (url_hash, url, type, title, description, image, site_name, favicon, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      key,
      preview.url,
      preview.type,
      preview.title,
      preview.description,
      preview.image,
      preview.site_name,
      preview.favicon,
      nowSec,
    )
    .run()
    .catch(() => undefined);

  return c.json({ preview });
});

function rowToPreview(row: CacheRow): LinkPreview {
  return {
    url: row.url,
    type: (row.type as LinkPreview["type"]) ?? "link",
    title: row.title,
    description: row.description,
    image: row.image,
    site_name: row.site_name,
    favicon: row.favicon,
  };
}

export default app;
