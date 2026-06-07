/**
 * Page chrome + the full stylesheet for the notes board.
 *
 * v1 ships plain HTML + vanilla JS (no framework, no build step) — same as the
 * other GateCheck Workers. The visual language follows the inspiration board:
 * near-black canvas, monospace type throughout, soft green-glow card borders,
 * gold accent for pinned cards, green tag pills.
 */
import type { User } from "../types";

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #050505;
    --bg-elevated: #0e0e0e;
    --bg-tile: #0b0b0b;
    --bg-input: #111;
    --text: #ededed;
    --text-dim: #9a9a9a;
    --text-muted: #5e5e5e;
    --border-faint: rgba(255,255,255,0.09);
    --border-soft: rgba(255,255,255,0.16);
    --green: #5fd684;
    --green-dim: #3f9c5e;
    --green-border: rgba(95,214,132,0.40);
    --green-glow: rgba(95,214,132,0.10);
    --green-pill-bg: rgba(95,214,132,0.13);
    --gold: #e0b34a;
    --gold-border: rgba(224,179,74,0.55);
    --gold-glow: rgba(224,179,74,0.10);
    --danger: #ef5350;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  html, body { margin: 0; padding: 0; }
  body {
    background-color: var(--bg);
    background-image: radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px);
    background-size: 24px 24px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--text); }
  button { font-family: var(--mono); cursor: pointer; }

  /* ── Top nav ─────────────────────────────────────────────── */
  .gc-nav {
    position: sticky; top: 0; z-index: 40;
    padding: 14px 0;
    border-bottom: 1px solid var(--border-faint);
    background-color: rgba(5,5,5,0.88);
    backdrop-filter: saturate(140%) blur(8px);
  }
  .gc-nav-inner {
    display: flex; max-width: 1320px; margin: 0 auto;
    padding: 0 24px; justify-content: space-between; align-items: center;
  }
  .gc-logo {
    color: var(--text); font-weight: 600; font-size: 18px;
    letter-spacing: 0.02em; text-decoration: none;
  }
  .gc-nav-right { display: flex; align-items: center; gap: 8px; }
  .icon-btn {
    width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: var(--text-dim);
    border: 1px solid var(--border-faint); border-radius: 8px;
    font-size: 16px; line-height: 1;
  }
  .icon-btn:hover { color: var(--text); border-color: var(--border-soft); background: rgba(255,255,255,0.03); }

  .wrap { max-width: 1320px; margin: 0 auto; padding: 26px 24px 80px; }

  /* ── Search + add ────────────────────────────────────────── */
  .searchbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
  .search-field { position: relative; flex: 1; }
  .search-field .mag {
    position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
    color: var(--text-muted); pointer-events: none; font-size: 15px;
  }
  .search-input {
    width: 100%; padding: 14px 16px 14px 44px;
    background: var(--bg-elevated); color: var(--text);
    border: 1px solid var(--border-faint); border-radius: 12px;
    font-family: var(--mono); font-size: 14px;
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-input:focus { outline: none; border-color: var(--border-soft); }
  .add-big {
    width: 50px; height: 50px; flex: none; border-radius: 12px;
    background: var(--bg-elevated); border: 1px solid var(--border-faint);
    color: var(--text); font-size: 24px; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .add-big:hover { border-color: var(--green-border); color: var(--green); }

  /* ── Tag bar ─────────────────────────────────────────────── */
  .tagbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 22px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 13px; border-radius: 999px;
    background: transparent; border: 1px solid var(--border-faint);
    color: var(--text-dim); font-size: 12px; letter-spacing: 0.04em;
    white-space: nowrap; transition: all 140ms;
  }
  .chip:hover { border-color: var(--border-soft); color: var(--text); }
  .chip.tag { color: var(--green); border-color: var(--green-border); }
  .chip.tag.active { background: var(--green-pill-bg); color: var(--green); border-color: var(--green-border); box-shadow: 0 0 0 1px var(--green-border); }
  .chip.ghost { color: var(--text-muted); }
  .chip .caret { font-size: 9px; opacity: 0.7; }
  .chip-sub { margin-left: 2px; }

  /* ── Composer ────────────────────────────────────────────── */
  .composer {
    border: 1px solid var(--border-soft); border-radius: 14px;
    background: var(--bg-elevated); margin-bottom: 26px; overflow: hidden;
  }
  .composer.collapsed { cursor: text; }
  .composer-collapsed-row { padding: 16px 18px; color: var(--text-muted); font-size: 14px; }
  .composer-open { display: none; }
  .composer.open .composer-open { display: block; }
  .composer.open .composer-collapsed-row { display: none; }
  .composer-head { display: flex; gap: 8px; padding: 14px 16px 0; }
  .seg {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 8px; font-size: 12px;
    background: transparent; border: 1px solid var(--border-faint); color: var(--text-dim);
  }
  .seg.active { background: rgba(255,255,255,0.06); color: var(--text); border-color: var(--border-soft); }
  .composer-body { padding: 14px 16px 0; }
  .note-area {
    width: 100%; min-height: 90px; resize: vertical;
    background: transparent; border: none; color: var(--text);
    font-family: var(--mono); font-size: 15px; line-height: 1.55;
  }
  .note-area:focus { outline: none; }
  .note-area::placeholder { color: var(--text-muted); }

  .todo-items { display: flex; flex-direction: column; gap: 8px; }
  .todo-row { display: flex; align-items: center; gap: 10px; }
  .todo-row input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--green-dim); flex: none; }
  .todo-row input[type=text] {
    flex: 1; background: transparent; border: none; border-bottom: 1px solid transparent;
    color: var(--text); font-family: var(--mono); font-size: 14px; padding: 4px 0;
  }
  .todo-row input[type=text]:focus { outline: none; border-bottom-color: var(--border-faint); }
  .todo-row .del-item { color: var(--text-muted); background: none; border: none; font-size: 14px; opacity: 0; }
  .todo-row:hover .del-item { opacity: 1; }
  .add-item-btn { background: none; border: none; color: var(--text-muted); font-size: 13px; padding: 6px 0; text-align: left; }
  .add-item-btn:hover { color: var(--text); }

  .composer-tagrow { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 16px; }
  .composer-foot {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-top: 1px solid var(--border-faint);
  }
  .hint { color: var(--text-muted); font-size: 12px; }
  .foot-actions { display: flex; gap: 12px; align-items: center; }
  .foot-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .icon-pill {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    padding: 7px 12px; border-radius: 8px; font-size: 12px;
    background: transparent; border: 1px solid var(--border-faint); color: var(--text-dim);
  }
  .icon-pill:hover { color: var(--text); border-color: var(--border-soft); background: rgba(255,255,255,0.03); }

  /* composer image thumbnails */
  .composer-images { display: flex; flex-wrap: wrap; gap: 10px; padding: 0 16px; }
  .composer-images:empty { padding: 0; }
  .composer-images .thumb {
    position: relative; width: 92px; height: 92px; border-radius: 8px; overflow: hidden;
    border: 1px solid var(--border-faint); background: #000;
  }
  .composer-images .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .composer-images .thumb .rm {
    position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border-radius: 50%;
    background: rgba(0,0,0,0.7); color: #fff; border: none; font-size: 11px; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  }
  .composer-images .thumb .rm:hover { background: var(--danger); }
  .composer-images .thumb.uploading { display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 10px; }

  /* composer drag-over highlight */
  .composer.dragging { border-color: var(--green); box-shadow: 0 0 0 2px var(--green-glow); }

  /* full-window drop overlay */
  .drop-overlay {
    position: fixed; inset: 0; z-index: 70; display: none;
    background: rgba(5,5,5,0.82); backdrop-filter: blur(3px);
    align-items: center; justify-content: center; padding: 40px;
  }
  .drop-overlay.show { display: flex; }
  .drop-overlay-inner {
    border: 2px dashed var(--green-border); border-radius: 18px; color: var(--green);
    padding: 60px 80px; font-size: 18px; letter-spacing: 0.04em; text-align: center;
    background: rgba(95,214,132,0.04);
  }

  /* uploaded images on a card */
  .note-images { display: grid; gap: 6px; margin-top: 12px; }
  .note-images img { width: 100%; border-radius: 8px; display: block; border: 1px solid var(--border-faint); object-fit: cover; }
  .note-images.multi img { aspect-ratio: 1 / 1; }

  /* lightbox (click an image to zoom) */
  .lightbox { position: fixed; inset: 0; z-index: 90; display: none; background: rgba(0,0,0,0.92); align-items: center; justify-content: center; }
  .lightbox.show { display: flex; }
  .lightbox img { max-width: 92vw; max-height: 88vh; object-fit: contain; border-radius: 6px; box-shadow: 0 12px 60px rgba(0,0,0,0.6); }
  .lb-close { position: absolute; top: 16px; right: 20px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.08); color: #fff; border: none; font-size: 16px; cursor: pointer; }
  .lb-close:hover { background: rgba(255,255,255,0.18); }
  .lb-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,0.08); color: #fff; border: none; font-size: 26px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .lb-nav:hover { background: rgba(255,255,255,0.18); }
  .lb-prev { left: 18px; }
  .lb-next { right: 18px; }
  .lb-count { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); color: var(--text-dim); font-size: 12px; letter-spacing: 0.1em; }

  .btn {
    padding: 9px 18px; border-radius: 8px; font-size: 12px; letter-spacing: 0.04em;
    border: 1px solid transparent; background: transparent; color: var(--text);
  }
  .btn-primary { background: var(--text); color: #000; font-weight: 600; }
  .btn-primary:hover { opacity: 0.9; }
  .btn-link { background: none; border: none; color: var(--text-dim); }
  .btn-link:hover { color: var(--text); }

  /* ── Board (masonry via CSS columns) ─────────────────────── */
  .board { column-width: 300px; column-gap: 16px; }
  .group-label {
    column-span: all; color: var(--text-muted);
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
    margin: 26px 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border-faint);
  }
  .group-label:first-child { margin-top: 0; }

  .note-card {
    break-inside: avoid; -webkit-column-break-inside: avoid;
    margin: 0 0 16px;
    border: 1px solid var(--green-border); border-radius: 12px;
    background: var(--bg-tile); padding: 16px 16px 14px;
    box-shadow: 0 0 0 1px var(--green-glow), 0 6px 18px rgba(0,0,0,0.4);
    position: relative; transition: border-color 140ms, box-shadow 140ms, transform 140ms;
  }
  .note-card:hover { border-color: var(--green); box-shadow: 0 0 0 1px var(--green-glow), 0 8px 26px rgba(0,0,0,0.55); }
  .note-card.pinned { border-color: var(--gold-border); box-shadow: 0 0 0 1px var(--gold-glow), 0 6px 18px rgba(0,0,0,0.45); }
  .note-card.done { opacity: 0.6; border-color: var(--border-faint); box-shadow: none; }
  .note-card.compact { padding: 11px 13px; }

  .card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .pin-flag { color: var(--gold); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; display: inline-flex; gap: 5px; align-items: center; }
  .done-flag { color: var(--green-dim); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
  .card-date { color: var(--text-muted); font-size: 11px; letter-spacing: 0.05em; }
  .progress { color: var(--text-dim); font-size: 11px; }

  .card-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 120ms; }
  .note-card:hover .card-actions, .note-card:focus-within .card-actions { opacity: 1; }
  .act {
    width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); border-radius: 6px; font-size: 13px;
  }
  .act:hover { color: var(--text); background: rgba(255,255,255,0.06); }
  .act.on { color: var(--gold); }
  .act.danger:hover { color: var(--danger); }

  .card-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 9px; }
  .tag-pill {
    font-size: 10.5px; letter-spacing: 0.05em; color: var(--green);
    background: var(--green-pill-bg); padding: 3px 8px; border-radius: 5px;
  }
  .card-body { font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .card-body a { color: var(--green); text-decoration: none; word-break: break-all; }
  .card-body a:hover { text-decoration: underline; }
  .note-card.done .card-body { text-decoration: line-through; }
  .card-title-line { font-weight: 600; margin-bottom: 8px; }

  .card-todo { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 7px; }
  .card-todo li { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; line-height: 1.45; }
  .card-todo input[type=checkbox] { width: 15px; height: 15px; margin-top: 2px; accent-color: var(--green-dim); flex: none; }
  .card-todo li.checked span { text-decoration: line-through; color: var(--text-muted); }

  /* ── Media previews ──────────────────────────────────────── */
  .media { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
  .media img.inline-img { width: 100%; border-radius: 8px; display: block; border: 1px solid var(--border-faint); }
  .embed { position: relative; width: 100%; padding-top: 56.25%; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-faint); background: #000; }
  .embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .embed.twitter { padding-top: 0; }
  .twitter-holder { width: 100%; }
  .linkcard {
    display: block; border: 1px solid var(--border-faint); border-radius: 8px;
    overflow: hidden; text-decoration: none; color: var(--text); background: var(--bg-elevated);
  }
  .linkcard:hover { border-color: var(--border-soft); }
  .linkcard .lc-img { width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; display: block; background: #000; border-bottom: 1px solid var(--border-faint); }
  .linkcard .lc-meta { padding: 11px 13px; }
  .linkcard .lc-site { display: flex; align-items: center; gap: 7px; color: var(--text-muted); font-size: 11px; margin-bottom: 5px; }
  .linkcard .lc-site img { width: 14px; height: 14px; border-radius: 3px; }
  .linkcard .lc-title { font-size: 13px; font-weight: 600; line-height: 1.35; margin-bottom: 4px; }
  .linkcard .lc-desc { font-size: 12px; color: var(--text-dim); line-height: 1.4; max-height: 3.4em; overflow: hidden; }
  .linkcard.loading { padding: 14px; color: var(--text-muted); font-size: 12px; }

  /* ── Dropdown (view options) ─────────────────────────────── */
  .menu {
    position: absolute; right: 0; top: 46px; z-index: 50;
    min-width: 250px; background: var(--bg-elevated);
    border: 1px solid var(--border-soft); border-radius: 12px; padding: 8px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.6); display: none;
  }
  .menu.open { display: block; }
  .menu-title { color: var(--text-muted); font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; padding: 8px 10px 10px; }
  .menu-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 11px 10px; border-radius: 8px; font-size: 13px; color: var(--text); cursor: pointer;
  }
  .menu-item:hover { background: rgba(255,255,255,0.05); }
  .menu-check { width: 18px; height: 18px; border: 1px solid var(--border-soft); border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: #000; }
  .menu-item.on .menu-check { background: var(--green); border-color: var(--green); }
  .menu-foot { padding: 12px 10px 6px; color: var(--text-muted); font-size: 11px; border-top: 1px solid var(--border-faint); margin-top: 6px; }
  .nav-menu-anchor { position: relative; }

  /* ── Modal (edit tags) ───────────────────────────────────── */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 60; display: none; align-items: flex-start; justify-content: center; padding-top: 12vh; }
  .modal-backdrop.open { display: flex; }
  .modal { width: 440px; max-width: 92vw; background: var(--bg-elevated); border: 1px solid var(--border-soft); border-radius: 14px; padding: 22px; }
  .modal h2 { margin: 0 0 4px; font-size: 16px; }
  .modal p.sub { margin: 0 0 18px; color: var(--text-dim); font-size: 12px; }
  .tag-edit-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-faint); }
  .tag-edit-row input { flex: 1; background: var(--bg-input); border: 1px solid var(--border-faint); border-radius: 7px; color: var(--text); font-family: var(--mono); font-size: 13px; padding: 8px 10px; }
  .tag-edit-row input:focus { outline: none; border-color: var(--border-soft); }
  .tag-edit-row .grip { color: var(--text-muted); font-size: 12px; width: 12px; text-align: center; }
  #tag-edit-list { max-height: 46vh; overflow-y: auto; margin: 4px -4px; padding: 0 4px; }
  .reorder { display: flex; flex-direction: column; flex: none; }
  .reorder button { width: 18px; height: 12px; line-height: 1; font-size: 8px; padding: 0; color: var(--text-muted); background: none; border: none; }
  .reorder button:hover { color: var(--text); }
  .reorder button:disabled { opacity: 0.22; cursor: default; }
  .tag-count { flex: none; color: var(--text-muted); font-size: 10px; background: rgba(255,255,255,0.05); border-radius: 999px; padding: 2px 8px; min-width: 24px; text-align: center; }
  .subadd-row { display: flex; gap: 8px; padding: 2px 0 8px 30px; }
  .subadd-row input { flex: 1; background: var(--bg-input); border: 1px solid var(--border-faint); border-radius: 7px; color: var(--text); font-family: var(--mono); font-size: 12px; padding: 8px 10px; }
  .subadd-row input:focus { outline: none; border-color: var(--green-border); }
  .new-tag-row { display: flex; gap: 8px; margin-top: 16px; }
  .new-tag-row input { flex: 1; background: var(--bg-input); border: 1px solid var(--border-faint); border-radius: 7px; color: var(--text); font-family: var(--mono); font-size: 13px; padding: 10px 12px; }
  .new-tag-row input:focus { outline: none; border-color: var(--border-soft); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

  .empty { text-align: center; padding: 80px 20px; color: var(--text-dim); border: 1px dashed var(--border-faint); border-radius: 12px; }
  .empty strong { color: var(--text); }
  .loading-board { text-align: center; padding: 60px; color: var(--text-muted); }

  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--bg-elevated); border: 1px solid var(--border-soft); color: var(--text); padding: 11px 18px; border-radius: 10px; font-size: 13px; z-index: 80; opacity: 0; transition: opacity 160ms; pointer-events: none; }
  .toast.show { opacity: 1; }

  @media (max-width: 640px) {
    .board { column-width: 100%; }
    .wrap { padding: 18px 14px 80px; }
  }
`;

export function layout(opts: { title: string; user: User; body: string; inlineScript?: string }): string {
  const greeting = opts.user.name || opts.user.email;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${escapeHtml(opts.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <nav class="gc-nav">
    <div class="gc-nav-inner">
      <a class="gc-logo" href="/">Notes</a>
      <div class="gc-nav-right nav-menu-anchor">
        <span class="hint" style="margin-right:8px" title="${escapeHtml(greeting)}">${escapeHtml(greeting)}</span>
        <button class="icon-btn" id="view-menu-btn" title="View options" aria-label="View options">⋯</button>
        <button class="icon-btn" id="signout-btn" title="Sign out" aria-label="Sign out">⏻</button>
        <div class="menu" id="view-menu">
          <div class="menu-title">View options</div>
          <div class="menu-item" data-view="group"><span>Group by time frame</span><span class="menu-check">✓</span></div>
          <div class="menu-item" data-view="compact"><span>Compact view</span><span class="menu-check">✓</span></div>
          <div class="menu-item" data-view="oldest"><span>Sort: oldest first</span><span class="menu-check">✓</span></div>
          <div class="menu-foot">All notes are private to your account.</div>
        </div>
      </div>
    </div>
  </nav>
  <main class="wrap">
    ${opts.body}
  </main>
  <div class="toast" id="toast"></div>
  <script>
    document.getElementById('signout-btn').addEventListener('click', async function(){
      try { await fetch('https://auth.gatecheck.net/api/logout', { method:'POST', credentials:'include' }); } catch(e){}
      window.location.href = 'https://gatecheck.net/login';
    });
  </script>
  ${opts.inlineScript ? `<script>${opts.inlineScript}</script>` : ""}
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
