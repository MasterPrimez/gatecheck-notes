/**
 * Notes Worker — entry point.  Runs at notes.gatecheck.net.
 *
 * Pages (HTML, requires auth — redirect to gatecheck.net/login if not signed in):
 *   GET  /                         — the sticky-note board
 *   GET  /worldcup                 — the live World Cup 2026 dashboard
 *
 * APIs (JSON, require auth — return 401 if not signed in):
 *   GET    /api/health
 *   GET    /api/worldcup           — World Cup schedule + live scores + standings
 *   GET    /api/notes              — list the user's notes (with tag ids)
 *   POST   /api/notes              — create a note / todo
 *   GET    /api/notes/:id          — get one
 *   PUT    /api/notes/:id          — update (content/items/pin/done/tags)
 *   DELETE /api/notes/:id          — delete
 *   GET    /api/tags               — list tags
 *   POST   /api/tags               — create tag (optionally nested)
 *   PUT    /api/tags/:id           — rename / reorder / reparent
 *   DELETE /api/tags/:id           — delete tag (notes are kept)
 *   GET    /api/preview?url=…      — OpenGraph link preview (cached)
 */
import { Hono } from "hono";
import type { AppEnv } from "./types";
import indexPage from "./pages/index";
import worldcupPage from "./pages/worldcup";
import notesApi from "./routes/notes";
import tagsApi from "./routes/tags";
import previewApi from "./routes/preview";
import uploadsApi from "./routes/uploads";
import worldcupApi from "./routes/worldcup";

const app = new Hono<AppEnv>();

// Health check (no auth)
app.get("/api/health", (c) =>
  c.json({ service: "gatecheck-notes", status: "ok", version: "0.1.0" }),
);

// JSON APIs (each route module mounts its own auth middleware)
app.route("/api/notes", notesApi);
app.route("/api/tags", tagsApi);
app.route("/api/preview", previewApi);
app.route("/api/uploads", uploadsApi);
app.route("/api/worldcup", worldcupApi);

// HTML pages
app.route("/worldcup", worldcupPage);
app.route("/", indexPage);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  return c.text("Not found", 404);
});
app.onError((err, c) => {
  console.error("Worker error:", err);
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Internal server error" }, 500);
  return c.text("Internal server error", 500);
});

export default app;
