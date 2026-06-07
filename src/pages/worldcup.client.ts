/**
 * World Cup dashboard — browser app (vanilla JS, shipped as a string).
 *
 * Polls /api/worldcup every 15s and re-renders; a 1s ticker keeps countdowns
 * and live minutes moving between polls by re-deriving status from each match's
 * kick-off time (mirrors the server's clock logic) while trusting server scores.
 */
export const WORLDCUP_JS = String.raw`
(function () {
  var POLL_MS = 15000;
  var demo = new URLSearchParams(location.search).get('demo') === '1';
  var DATA = null;
  var state = { tab: 'matches', filter: 'all', q: '', group: 'all' };
  var lastFetch = 0;
  var failed = false;

  var $ = function (id) { return document.getElementById(id); };
  var board = $('wc-board');
  var statusEl = $('wc-source');
  var updatedEl = $('wc-updated');

  // ── status / time helpers (mirror lib/worldcup) ──────────────────────────
  var REG = 105 * 60000, FINAL = 118 * 60000;
  function clockStatus(kickoffMs, now) {
    if (now < kickoffMs) return { status: 'upcoming', minute: null };
    var e = now - kickoffMs;
    if (e >= FINAL) return { status: 'finished', minute: null };
    var min = Math.floor(e / 60000);
    if (min >= 45 && min < 60) return { status: 'halftime', minute: 45 };
    if (e >= REG) return { status: 'live', minute: 90 };
    return { status: 'live', minute: Math.max(1, min > 45 ? min - 15 : min) };
  }

  function fmtTime(d) {
    try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d); }
    catch (e) { return d.toLocaleTimeString(); }
  }
  function fmtTz(d) {
    try {
      var parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') return parts[i].value;
    } catch (e) {}
    return '';
  }
  function dayKey(d) {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function dayLabel(d) {
    var today = new Date(); var t0 = dayKey(today);
    var tomorrow = new Date(today.getTime() + 86400000);
    if (dayKey(d) === t0) return 'Today';
    if (dayKey(d) === dayKey(tomorrow)) return 'Tomorrow';
    try { return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(d); }
    catch (e) { return d.toDateString(); }
  }
  function countdown(ms) {
    if (ms <= 0) return 'now';
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60);
    if (d > 0) return 'in ' + d + 'd ' + h + 'h';
    if (h > 0) return 'in ' + h + 'h ' + m + 'm';
    if (m > 0) return 'in ' + m + 'm';
    return 'kicking off';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Merge server scores with a freshly-derived clock status (smooth between polls)
  function liveView(m, now) {
    var k = Date.parse(m.kickoff);
    var cs = clockStatus(k, now);
    var status = m.live ? m.status : cs.status;        // trust feed status when live
    var minute = m.status === 'live' || cs.status === 'live'
      ? (cs.status === 'live' ? cs.minute : m.minute) : null;
    if (m.status === 'halftime') status = 'halftime';
    return { status: status, minute: minute, kickMs: k };
  }

  function statusPill(m, lv) {
    if (lv.status === 'live') return '<span class="pill live">● LIVE ' + (lv.minute || '') + "'</span>";
    if (lv.status === 'halftime') return '<span class="pill live">HALF-TIME</span>';
    if (lv.status === 'finished') return '<span class="pill ft">FULL-TIME</span>';
    var ms = lv.kickMs - Date.now();
    return '<span class="pill soon" data-kick="' + lv.kickMs + '">' + countdown(ms) + '</span>';
  }

  function scoreCell(team, other, lv, side) {
    var sc = team.score;
    var has = sc !== null && sc !== undefined;
    var lead = has && other.score !== null && sc > other.score;
    var cls = 'team ' + side + (lead ? ' lead' : '');
    var scoreHtml = has
      ? '<span class="score' + (lead ? ' lead' : '') + '">' + sc + '</span>'
      : (lv.status === 'upcoming' || lv.status === 'finished' && !has ? '<span class="score dash">–</span>' : '<span class="score dash">0</span>');
    return '<div class="' + cls + '">' +
      '<span class="flag">' + team.flag + '</span>' +
      '<span class="tname">' + esc(team.name) + '</span>' +
      scoreHtml + '</div>';
  }

  function watchChips(m) {
    return m.watch.map(function (w) {
      var cls = 'watch' + (w.free ? ' free' : '') + (w.kind === 'Stream' ? ' stream' : '');
      var icon = w.kind === 'Stream' ? '▷' : '📺';
      return '<span class="' + cls + '" title="' + esc(w.lang + ' · ' + w.kind) + '">' + icon + ' ' + esc(w.label) + '</span>';
    }).join('');
  }

  function matchCard(m, now) {
    var lv = liveView(m, now);
    var d = new Date(m.kickoff);
    var winnerCls = m.winner === 'home' ? ' win-h' : m.winner === 'away' ? ' win-a' : '';
    var cardCls = 'match' + (lv.status === 'live' || lv.status === 'halftime' ? ' islive' : '') +
      (lv.status === 'finished' ? ' isdone' : '') + winnerCls;
    return '<div class="' + cardCls + '" data-id="' + m.id + '">' +
      '<div class="m-top">' +
        '<span class="grp">Group ' + m.group + ' · MD' + m.matchday + '</span>' +
        statusPill(m, lv) +
      '</div>' +
      '<div class="m-teams">' +
        scoreCell(m.home, m.away, lv, 'home') +
        scoreCell(m.away, m.home, lv, 'away') +
      '</div>' +
      '<div class="m-meta">' +
        '<span class="kick" data-kick="' + lv.kickMs + '">🕑 ' + fmtTime(d) + ' ' + fmtTz(d) + '</span>' +
        '<span class="venue">📍 ' + esc(m.venue.stadium) + ', ' + esc(m.venue.city) +
          (m.confirmed ? '' : ' <span class="prov" title="Kick-off & venue provisional until confirmed; results update live">~prov</span>') +
        '</span>' +
      '</div>' +
      '<div class="m-watch">' + watchChips(m) + '</div>' +
    '</div>';
  }

  function passesFilter(m, lv, now) {
    if (state.group !== 'all' && m.group !== state.group) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      if (m.home.name.toLowerCase().indexOf(q) < 0 && m.away.name.toLowerCase().indexOf(q) < 0 &&
          ('group ' + m.group).toLowerCase().indexOf(q) < 0 && m.venue.city.toLowerCase().indexOf(q) < 0) return false;
    }
    if (state.filter === 'live') return lv.status === 'live' || lv.status === 'halftime';
    if (state.filter === 'upcoming') return lv.status === 'upcoming';
    if (state.filter === 'finished') return lv.status === 'finished';
    if (state.filter === 'today') return dayKey(new Date(m.kickoff)) === dayKey(now);
    return true;
  }

  function renderMatches() {
    var now = new Date();
    var rows = DATA.matches.map(function (m) { return { m: m, lv: liveView(m, now.getTime()) }; })
      .filter(function (x) { return passesFilter(x.m, x.lv, now); });

    if (!rows.length) {
      return '<div class="empty">No matches match this filter.</div>';
    }

    // group by local day
    var byDay = {}, order = [];
    rows.forEach(function (x) {
      var d = new Date(x.m.kickoff); var k = dayKey(d);
      if (!byDay[k]) { byDay[k] = { date: d, items: [] }; order.push(k); }
      byDay[k].items.push(x.m);
    });
    order.sort();

    return order.map(function (k) {
      var grp = byDay[k];
      var liveCount = grp.items.filter(function (m) {
        var s = liveView(m, Date.now()).status; return s === 'live' || s === 'halftime';
      }).length;
      return '<div class="day-head">' + esc(dayLabel(grp.date)) +
        (liveCount ? ' <span class="day-live">' + liveCount + ' live</span>' : '') + '</div>' +
        '<div class="day-grid">' + grp.items.map(function (m) { return matchCard(m, Date.now()); }).join('') + '</div>';
    }).join('');
  }

  function standRow(r, i) {
    var pos = i + 1;
    var cls = pos <= 2 ? 'q-yes' : pos === 3 ? 'q-maybe' : 'q-no';
    return '<tr class="' + cls + '">' +
      '<td class="pos">' + pos + '</td>' +
      '<td class="tm"><span class="flag">' + r.flag + '</span> ' + esc(r.name) + '</td>' +
      '<td>' + r.played + '</td>' +
      '<td>' + r.won + '</td>' +
      '<td>' + r.drawn + '</td>' +
      '<td>' + r.lost + '</td>' +
      '<td>' + r.gf + ':' + r.ga + '</td>' +
      '<td class="' + (r.gd > 0 ? 'pos-gd' : r.gd < 0 ? 'neg-gd' : '') + '">' + (r.gd > 0 ? '+' : '') + r.gd + '</td>' +
      '<td class="pts">' + r.points + '</td>' +
    '</tr>';
  }

  function renderStandings() {
    var groups = state.group === 'all' ? DATA.groups : DATA.groups.filter(function (g) { return g.letter === state.group; });
    return '<div class="std-grid">' + groups.map(function (g) {
      return '<div class="std-card">' +
        '<div class="std-title">Group ' + g.letter + '</div>' +
        '<table class="std"><thead><tr>' +
          '<th></th><th class="tm">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF:GA</th><th>GD</th><th>Pts</th>' +
        '</tr></thead><tbody>' +
        g.table.map(standRow).join('') +
        '</tbody></table>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="std-legend"><span class="dot q-yes"></span>Advance (top 2)' +
      '<span class="dot q-maybe"></span>3rd — best-thirds race' +
      '<span class="dot q-no"></span>Eliminated zone · standings fill in as results go final</div>';
  }

  function renderInfo() {
    var venues = '<div class="info-sec"><h3>16 Host Venues</h3><div class="venue-list">' +
      DATA.venues.map(function (v) {
        return '<div class="venue-row"><span class="vcity">' + esc(v.city) + '</span>' +
          '<span class="vstad">' + esc(v.stadium) + '</span>' +
          '<span class="vctry">' + esc(v.country) + '</span></div>';
      }).join('') + '</div></div>';
    var tv = '<div class="info-sec"><h3>Where to Watch (US)</h3><div class="bc-list">' +
      DATA.broadcasters.map(function (b) {
        return '<div class="bc-row"><span class="bc-name' + (b.free ? ' free' : '') + '">' +
          (b.kind === 'Stream' ? '▷ ' : '📺 ') + esc(b.name) + '</span>' +
          '<span class="bc-tag">' + esc(b.lang) + '</span>' +
          '<span class="bc-note">' + esc(b.note) + '</span></div>';
      }).join('') + '</div></div>';
    return '<div class="info-wrap">' + tv + venues + '</div>';
  }

  function render() {
    if (!DATA) { board.innerHTML = '<div class="empty">' + (failed ? 'Could not load the dashboard. Retrying…' : 'Loading matches…') + '</div>'; return; }
    if (state.tab === 'standings') board.innerHTML = renderStandings();
    else if (state.tab === 'info') board.innerHTML = renderInfo();
    else board.innerHTML = renderMatches();
  }

  // Per-second: keep countdowns + live pills moving without a full refetch
  function tick() {
    if (!DATA) return;
    var now = Date.now();
    var kicks = board.querySelectorAll('[data-kick]');
    for (var i = 0; i < kicks.length; i++) {
      var el = kicks[i];
      if (el.classList.contains('pill')) {
        var ms = parseInt(el.getAttribute('data-kick'), 10) - now;
        if (ms <= 0) { render(); return; } // crossed kickoff → re-render to flip to LIVE
        el.textContent = countdown(ms);
      }
    }
    // advance live minutes
    var live = board.querySelectorAll('.match.islive .pill.live');
    if (live.length && state.tab === 'matches') {
      // cheap: re-render matches view so minutes tick up
      board.innerHTML = renderMatches();
    }
  }

  function setSource() {
    if (!DATA) return;
    var s = DATA.source;
    var label = s === 'live' ? '● LIVE FEED' : s === 'demo' ? '◆ DEMO SCORES' : '◷ SCHEDULE';
    statusEl.className = 'src ' + s;
    statusEl.textContent = label;
    var t = new Date(DATA.generatedAt);
    updatedEl.textContent = 'updated ' + fmtTime(t);
  }

  function load() {
    fetch('/api/worldcup' + (demo ? '?demo=1' : ''), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { DATA = d; failed = false; lastFetch = Date.now(); setSource(); render(); })
      .catch(function () { failed = true; if (!DATA) render(); });
  }

  // ── controls ──────────────────────────────────────────────────────────────
  function wireTabs() {
    var tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        state.tab = t.getAttribute('data-tab');
        tabs.forEach(function (x) { x.classList.toggle('on', x === t); });
        document.querySelectorAll('.filters').forEach(function (f) {
          f.style.display = state.tab === 'matches' ? '' : 'none';
        });
        render();
      });
    });
    document.querySelectorAll('[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.filter = b.getAttribute('data-filter');
        document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('on', x === b); });
        render();
      });
    });
    var sel = $('wc-group');
    if (sel) sel.addEventListener('change', function () { state.group = sel.value; render(); });
    var q = $('wc-q');
    if (q) q.addEventListener('input', function () { state.q = q.value.trim(); render(); });
  }

  wireTabs();
  load();
  setInterval(load, POLL_MS);
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - lastFetch > 5000) load();
  });
})();
`;
