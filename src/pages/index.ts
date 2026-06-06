/**
 * GET / — the notes board.
 *
 * We server-render only the static shell (nav, search, tag bar, composer,
 * board container, tag-editor modal). The board itself is rendered client-side
 * by APP_JS, which fetches /api/notes + /api/tags on load. Keeping one render
 * path (the client) avoids duplicating card markup on the server.
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { layout } from "../lib/ui";
import { requireAuthPage } from "../lib/auth";
import { APP_JS } from "./app.client";

const app = new Hono<AppEnv>();
app.use("*", requireAuthPage);

app.get("/", async (c) => {
  const user = c.get("user");

  const body = `
    <div class="searchbar">
      <div class="search-field">
        <span class="mag">⌕</span>
        <input id="search" class="search-input" placeholder="Search by text or date…" autocomplete="off" />
      </div>
      <button id="add-note-btn" class="add-big" title="New note" aria-label="New note">+</button>
    </div>

    <div class="tagbar" id="tagbar"></div>

    <div class="composer collapsed" id="composer">
      <div class="composer-collapsed-row" id="composer-collapsed">type your note here…</div>
      <div class="composer-open">
        <div class="composer-head">
          <button class="seg active" id="seg-note" type="button">📝 Note</button>
          <button class="seg" id="seg-todo" type="button">☑ To-Do List</button>
        </div>
        <div class="composer-body" id="composer-body"></div>
        <div class="composer-tagrow" id="composer-tagrow"></div>
        <div class="composer-foot">
          <span class="hint">⌘↵ to save · Esc to close</span>
          <div class="foot-actions">
            <button class="btn-link" id="composer-close" type="button">✕ Close</button>
            <button class="btn btn-primary" id="composer-save" type="button">Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="board" id="board"><div class="loading-board">Loading your notes…</div></div>

    <div class="modal-backdrop" id="tag-modal">
      <div class="modal">
        <h2>Edit tags</h2>
        <p class="sub">Renaming a tag updates it on every note. Deleting removes it from notes but keeps the notes.</p>
        <div id="tag-edit-list"></div>
        <div class="new-tag-row">
          <input id="new-tag-input" placeholder="New tag name (e.g. MINDCHUK)" maxlength="40" autocomplete="off" />
          <button class="btn btn-primary" id="new-tag-add" type="button">Add</button>
        </div>
        <div class="modal-actions">
          <button class="btn-link" id="tag-modal-close" type="button">Done</button>
        </div>
      </div>
    </div>
  `;

  return c.html(layout({ title: "Notes — GateCheck", user, body, inlineScript: APP_JS }));
});

export default app;
