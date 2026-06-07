/**
 * GET /worldcup — the live World Cup 2026 dashboard.
 *
 * Server-renders only the static shell (nav, header band, tabs, filters, an
 * empty board). Everything inside #wc-board is rendered + kept live by
 * WORLDCUP_JS, which polls /api/worldcup. Auth-gated like the rest of the app.
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuthPage } from "../lib/auth";
import { escapeHtml } from "../lib/ui";
import { WORLDCUP_JS } from "./worldcup.client";

const app = new Hono<AppEnv>();
app.use("*", requireAuthPage);

const STYLES = `
  *,*::before,*::after{box-sizing:border-box;}
  :root{
    --bg:#050505;--bg-elevated:#0e0e0e;--bg-tile:#0b0b0b;--bg-input:#111;
    --text:#ededed;--text-dim:#9a9a9a;--text-muted:#5e5e5e;
    --border-faint:rgba(255,255,255,0.09);--border-soft:rgba(255,255,255,0.16);
    --green:#5fd684;--green-dim:#3f9c5e;--green-border:rgba(95,214,132,0.40);--green-pill:rgba(95,214,132,0.13);
    --gold:#e0b34a;--gold-border:rgba(224,179,74,0.55);
    --red:#ef5350;--red-pill:rgba(239,83,80,0.14);--red-border:rgba(239,83,80,0.5);
    --blue:#5aa9e6;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace;
  }
  html,body{margin:0;padding:0;}
  body{background-color:var(--bg);background-image:radial-gradient(rgba(255,255,255,0.045) 1px,transparent 1px);
    background-size:24px 24px;color:var(--text);font-family:var(--mono);font-size:14px;line-height:1.5;min-height:100vh;-webkit-font-smoothing:antialiased;}
  a{color:var(--text);text-decoration:none;}
  button{font-family:var(--mono);cursor:pointer;}

  .gc-nav{position:sticky;top:0;z-index:40;padding:14px 0;border-bottom:1px solid var(--border-faint);
    background-color:rgba(5,5,5,0.9);backdrop-filter:saturate(140%) blur(8px);}
  .gc-nav-inner{display:flex;max-width:1320px;margin:0 auto;padding:0 24px;justify-content:space-between;align-items:center;gap:12px;}
  .gc-logo{font-weight:600;font-size:18px;letter-spacing:0.02em;display:flex;align-items:center;gap:9px;}
  .gc-logo .ball{font-size:20px;}
  .gc-nav-right{display:flex;align-items:center;gap:10px;}
  .navlink{color:var(--text-dim);font-size:12px;border:1px solid var(--border-faint);padding:7px 12px;border-radius:8px;}
  .navlink:hover{color:var(--text);border-color:var(--border-soft);}
  .hint{color:var(--text-muted);font-size:12px;}
  .icon-btn{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;background:transparent;
    color:var(--text-dim);border:1px solid var(--border-faint);border-radius:8px;font-size:16px;}
  .icon-btn:hover{color:var(--text);border-color:var(--border-soft);}

  .wrap{max-width:1320px;margin:0 auto;padding:24px 24px 90px;}

  /* header band */
  .hero{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;
    border:1px solid var(--border-faint);border-radius:16px;background:
    radial-gradient(120% 140% at 0% 0%,rgba(95,214,132,0.10),transparent 55%),
    radial-gradient(120% 140% at 100% 0%,rgba(90,169,230,0.10),transparent 55%),var(--bg-elevated);
    padding:22px 24px;margin-bottom:20px;}
  .hero h1{margin:0 0 6px;font-size:23px;letter-spacing:0.01em;}
  .hero .sub{color:var(--text-dim);font-size:13px;}
  .hero .sub b{color:var(--text);font-weight:600;}
  .hero-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}
  .src{font-size:11px;letter-spacing:0.14em;padding:6px 12px;border-radius:999px;border:1px solid var(--border-soft);color:var(--text-dim);}
  .src.live{color:var(--green);border-color:var(--green-border);background:var(--green-pill);}
  .src.demo{color:var(--gold);border-color:var(--gold-border);background:rgba(224,179,74,0.10);}
  .src.schedule{color:var(--blue);border-color:rgba(90,169,230,0.4);background:rgba(90,169,230,0.08);}
  #wc-updated{color:var(--text-muted);font-size:11px;}

  /* tabs + filters */
  .tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
  .tab{padding:9px 16px;border-radius:9px;font-size:13px;background:transparent;border:1px solid var(--border-faint);color:var(--text-dim);}
  .tab.on{background:rgba(255,255,255,0.06);color:var(--text);border-color:var(--border-soft);}
  .tab:hover{color:var(--text);}
  .filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:22px;}
  .chip{padding:7px 13px;border-radius:999px;background:transparent;border:1px solid var(--border-faint);color:var(--text-dim);font-size:12px;letter-spacing:0.03em;}
  .chip.on{background:var(--green-pill);color:var(--green);border-color:var(--green-border);}
  .chip:hover{color:var(--text);}
  .filters .spacer{flex:1;}
  #wc-q{background:var(--bg-input);border:1px solid var(--border-faint);border-radius:9px;color:var(--text);
    font-family:var(--mono);font-size:13px;padding:9px 12px;min-width:170px;}
  #wc-q:focus{outline:none;border-color:var(--border-soft);}
  #wc-group{background:var(--bg-input);border:1px solid var(--border-faint);border-radius:9px;color:var(--text);
    font-family:var(--mono);font-size:13px;padding:9px 10px;}
  #wc-group:focus{outline:none;border-color:var(--border-soft);}

  /* day grouping */
  .day-head{color:var(--text-muted);font-size:11px;letter-spacing:0.2em;text-transform:uppercase;
    margin:24px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--border-faint);display:flex;align-items:center;gap:10px;}
  .day-head:first-child{margin-top:0;}
  .day-live{color:var(--red);background:var(--red-pill);border:1px solid var(--red-border);border-radius:999px;
    padding:2px 9px;font-size:10px;letter-spacing:0.1em;text-transform:none;}
  .day-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;}

  /* match card */
  .match{border:1px solid var(--border-faint);border-radius:13px;background:var(--bg-tile);padding:14px 15px;
    display:flex;flex-direction:column;gap:11px;transition:border-color 140ms,box-shadow 140ms;}
  .match:hover{border-color:var(--border-soft);}
  .match.islive{border-color:var(--red-border);box-shadow:0 0 0 1px rgba(239,83,80,0.12),0 6px 20px rgba(0,0,0,0.4);}
  .match.isdone{opacity:0.86;}
  .m-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .grp{color:var(--text-muted);font-size:11px;letter-spacing:0.08em;}
  .pill{font-size:10.5px;letter-spacing:0.08em;padding:4px 9px;border-radius:999px;border:1px solid var(--border-faint);color:var(--text-dim);white-space:nowrap;}
  .pill.live{color:var(--red);background:var(--red-pill);border-color:var(--red-border);animation:pulse 1.6s ease-in-out infinite;}
  .pill.ft{color:var(--green);border-color:var(--green-border);background:var(--green-pill);}
  .pill.soon{color:var(--blue);border-color:rgba(90,169,230,0.35);}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.55;}}

  .m-teams{display:flex;flex-direction:column;gap:7px;}
  .team{display:flex;align-items:center;gap:10px;}
  .team .flag{font-size:19px;width:24px;text-align:center;flex:none;}
  .team .tname{flex:1;font-size:15px;color:var(--text-dim);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .team.lead .tname{color:var(--text);font-weight:600;}
  .team .score{font-size:18px;font-weight:600;color:var(--text-dim);min-width:20px;text-align:right;}
  .team .score.lead{color:var(--green);}
  .team .score.dash{color:var(--text-muted);font-weight:400;}
  .match.win-h .home .tname,.match.win-a .away .tname{color:var(--green);}

  .m-meta{display:flex;flex-direction:column;gap:4px;color:var(--text-muted);font-size:11.5px;}
  .m-meta .venue{color:var(--text-dim);}
  .prov{color:var(--gold);font-size:10px;}
  .m-watch{display:flex;flex-wrap:wrap;gap:6px;}
  .watch{font-size:10.5px;letter-spacing:0.02em;color:var(--text-dim);background:rgba(255,255,255,0.04);
    border:1px solid var(--border-faint);border-radius:6px;padding:3px 8px;}
  .watch.stream{color:var(--blue);border-color:rgba(90,169,230,0.3);}
  .watch.free{color:var(--gold);border-color:var(--gold-border);background:rgba(224,179,74,0.08);}

  /* standings */
  .std-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px;}
  .std-card{border:1px solid var(--border-faint);border-radius:13px;background:var(--bg-tile);padding:14px 16px;}
  .std-title{font-size:13px;letter-spacing:0.1em;color:var(--text);margin-bottom:10px;}
  table.std{width:100%;border-collapse:collapse;font-size:12px;}
  table.std th{color:var(--text-muted);font-weight:400;text-align:center;padding:5px 4px;font-size:10.5px;letter-spacing:0.04em;border-bottom:1px solid var(--border-faint);}
  table.std th.tm,table.std td.tm{text-align:left;}
  table.std td{text-align:center;padding:7px 4px;border-bottom:1px solid var(--border-faint);color:var(--text-dim);}
  table.std tr:last-child td{border-bottom:none;}
  table.std td.tm{color:var(--text);}
  table.std td.pos{color:var(--text-muted);width:18px;}
  table.std td.pts{color:var(--text);font-weight:600;}
  table.std .flag{font-size:15px;margin-right:4px;}
  .pos-gd{color:var(--green);}.neg-gd{color:var(--red);}
  tr.q-yes td.pos{color:var(--green);border-left:2px solid var(--green);}
  tr.q-maybe td.pos{color:var(--gold);border-left:2px solid var(--gold);}
  tr.q-no td.pos{border-left:2px solid transparent;}
  .std-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:18px;color:var(--text-muted);font-size:11.5px;}
  .std-legend .dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px;}
  .dot.q-yes{background:var(--green);}.dot.q-maybe{background:var(--gold);}.dot.q-no{background:var(--text-muted);}

  /* info */
  .info-wrap{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
  .info-sec{border:1px solid var(--border-faint);border-radius:13px;background:var(--bg-tile);padding:18px 20px;}
  .info-sec h3{margin:0 0 14px;font-size:14px;}
  .venue-row{display:grid;grid-template-columns:1.1fr 1.4fr auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-faint);font-size:12.5px;}
  .venue-row:last-child{border-bottom:none;}
  .vcity{color:var(--text);}.vstad{color:var(--text-dim);}.vctry{color:var(--text-muted);font-size:11px;}
  .bc-row{display:grid;grid-template-columns:auto auto 1fr;gap:10px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--border-faint);font-size:12.5px;}
  .bc-row:last-child{border-bottom:none;}
  .bc-name{color:var(--text);font-weight:600;}
  .bc-name.free{color:var(--gold);}
  .bc-tag{color:var(--text-muted);font-size:11px;}
  .bc-note{color:var(--text-dim);font-size:11.5px;}

  .empty{text-align:center;padding:70px 20px;color:var(--text-dim);border:1px dashed var(--border-faint);border-radius:12px;}

  @media (max-width:760px){
    .info-wrap{grid-template-columns:1fr;}
    .day-grid{grid-template-columns:1fr;}
    .wrap{padding:18px 14px 80px;}
    .hero{flex-direction:column;align-items:flex-start;}
    .hero-right{align-items:flex-start;}
  }
`;

app.get("/", async (c) => {
  const user = c.get("user");
  const greeting = user.name || user.email;

  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>World Cup 2026 — Live Dashboard · GateCheck</title>
  <style>${STYLES}</style>
</head>
<body>
  <nav class="gc-nav">
    <div class="gc-nav-inner">
      <div class="gc-logo"><span class="ball">⚽</span> World Cup 2026 <span class="hint" style="font-weight:400">· Live</span></div>
      <div class="gc-nav-right">
        <a class="navlink" href="/">← Notes</a>
        <span class="hint" title="${escapeHtml(greeting)}">${escapeHtml(greeting)}</span>
        <button class="icon-btn" id="signout-btn" title="Sign out" aria-label="Sign out">⏻</button>
      </div>
    </div>
  </nav>

  <main class="wrap">
    <div class="hero">
      <div>
        <h1>FIFA World Cup 2026 ⚽ Live Dashboard</h1>
        <div class="sub"><b>United States · Canada · Mexico</b> &nbsp;·&nbsp; 11 Jun – 19 Jul 2026 &nbsp;·&nbsp; 48 teams · 12 groups · 16 venues</div>
      </div>
      <div class="hero-right">
        <span class="src schedule" id="wc-source">◷ SCHEDULE</span>
        <span id="wc-updated">loading…</span>
      </div>
    </div>

    <div class="tabs">
      <button class="tab on" data-tab="matches">Matches</button>
      <button class="tab" data-tab="standings">Standings</button>
      <button class="tab" data-tab="info">Venues &amp; TV</button>
    </div>

    <div class="filters">
      <button class="chip on" data-filter="all">All</button>
      <button class="chip" data-filter="today">Today</button>
      <button class="chip" data-filter="live">● Live now</button>
      <button class="chip" data-filter="upcoming">Upcoming</button>
      <button class="chip" data-filter="finished">Finished</button>
      <span class="spacer"></span>
      <select id="wc-group" aria-label="Filter by group">
        <option value="all">All groups</option>
        <option value="A">Group A</option><option value="B">Group B</option><option value="C">Group C</option>
        <option value="D">Group D</option><option value="E">Group E</option><option value="F">Group F</option>
        <option value="G">Group G</option><option value="H">Group H</option><option value="I">Group I</option>
        <option value="J">Group J</option><option value="K">Group K</option><option value="L">Group L</option>
      </select>
      <input id="wc-q" placeholder="Search team / city…" autocomplete="off" />
    </div>

    <div id="wc-board"><div class="empty">Loading matches…</div></div>
  </main>

  <script>
    document.getElementById('signout-btn').addEventListener('click', async function(){
      try { await fetch('https://auth.gatecheck.net/api/logout', { method:'POST', credentials:'include' }); } catch(e){}
      window.location.href = 'https://gatecheck.net/login';
    });
  </script>
  <script>${WORLDCUP_JS}</script>
</body>
</html>`;

  return c.html(body);
});

export default app;
