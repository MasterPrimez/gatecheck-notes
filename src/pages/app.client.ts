/**
 * The board client app — plain browser JS, shipped as a string and injected
 * into the page by src/pages/index.ts.
 *
 * IMPORTANT (authoring constraint): this is a TS template literal, so inside it
 * we never use backticks, never the dollar-brace sequence, and write every
 * backslash that must reach the browser as a double backslash. User content is
 * always rendered via textContent (the el() helper), never innerHTML — only
 * trusted, app-built markup (iframes, the tweet blockquote) uses innerHTML.
 */
export const APP_JS = `
(function(){
  'use strict';

  // ── tiny DOM helper ──────────────────────────────────────
  function qs(id){ return document.getElementById(id); }
  function el(tag, props){
    var node = document.createElement(tag);
    if(props){
      for(var k in props){
        var v = props[k];
        if(v === null || v === undefined || v === false) continue;
        if(k === 'class') node.className = v;
        else if(k === 'text') node.textContent = v;
        else if(k === 'html') node.innerHTML = v;
        else if(k === 'style') node.setAttribute('style', v);
        else if(k.slice(0,2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    for(var i=2;i<arguments.length;i++){
      var ch = arguments[i];
      if(ch === null || ch === undefined || ch === false) continue;
      if(typeof ch === 'string' || typeof ch === 'number') node.appendChild(document.createTextNode(String(ch)));
      else node.appendChild(ch);
    }
    return node;
  }
  function escAttr(s){
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function toast(msg){
    var t = qs('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }

  // ── API ──────────────────────────────────────────────────
  function api(path, opts){
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'Content-Type':'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(body){
        if(!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
        return body;
      });
    });
  }

  // ── state ────────────────────────────────────────────────
  var state = {
    notes: [], tags: [],
    tagById: {}, childMap: {}, topTags: [],
    filter: null, search: '',
    composer: { kind:'note', content:'', items:[{text:'',done:false}], tagIds:{}, editingId:null },
    view: loadView()
  };

  function loadView(){
    try { var v = JSON.parse(localStorage.getItem('gc-notes-view') || '{}');
      return { group: !!v.group, compact: !!v.compact, oldest: !!v.oldest }; }
    catch(e){ return { group:false, compact:false, oldest:false }; }
  }
  function saveView(){ try { localStorage.setItem('gc-notes-view', JSON.stringify(state.view)); } catch(e){} }

  // ── tags model ───────────────────────────────────────────
  function setTags(tags){
    state.tags = tags;
    state.tagById = {}; state.childMap = {}; state.topTags = [];
    tags.forEach(function(t){ state.tagById[t.id] = t; });
    tags.forEach(function(t){
      if(t.parent_id){ (state.childMap[t.parent_id] = state.childMap[t.parent_id] || []).push(t); }
      else { state.topTags.push(t); }
    });
  }

  // ── date helpers ─────────────────────────────────────────
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function formatStamp(sec){
    var d = new Date(sec*1000);
    var h = d.getHours(); var ap = h < 12 ? 'AM' : 'PM'; var hr = h % 12; if(hr === 0) hr = 12;
    var m = d.getMinutes(); var mm = m < 10 ? '0'+m : ''+m;
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' · ' + hr + ':' + mm + ' ' + ap;
  }
  function isoDate(sec){ try { return new Date(sec*1000).toISOString().slice(0,10); } catch(e){ return ''; } }
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function groupFor(sec){
    var t = sec*1000; var s = startOfDay(new Date()); var day = 86400000;
    if(t >= s) return 'Today';
    if(t >= s - day) return 'Yesterday';
    if(t >= s - 7*day) return 'Earlier this week';
    if(t >= s - 30*day) return 'Earlier this month';
    return 'Older';
  }

  // ── URL / media classification ───────────────────────────
  function extractUrls(text){
    var re = new RegExp('https?://[^\\\\s]+', 'gi');
    var out = [], seen = {}, m;
    while((m = re.exec(text))){
      var u = trimUrl(m[0]);
      if(u && !seen[u]){ seen[u] = 1; out.push(u); }
    }
    return out;
  }
  function trimUrl(u){
    while(u.length){ var c = u.charAt(u.length-1); if(').,;:!?]>'.indexOf(c) >= 0) u = u.slice(0,-1); else break; }
    return u;
  }
  function hostOf(u){ var h = u.hostname.toLowerCase(); if(h.indexOf('www.') === 0) h = h.slice(4); return h; }
  function isDigits(s){ return s.length > 0 && new RegExp('^[0-9]+$').test(s); }
  var IMG_EXT = ['.png','.jpg','.jpeg','.gif','.webp','.avif','.svg','.bmp'];
  function isImageUrl(u){ var p = u.pathname.toLowerCase(); for(var i=0;i<IMG_EXT.length;i++){ if(p.indexOf(IMG_EXT[i], p.length - IMG_EXT[i].length) !== -1) return true; } return false; }

  function ytId(u, host){
    if(host === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    if(u.pathname.indexOf('/shorts/') === 0) return u.pathname.split('/')[2];
    if(u.pathname.indexOf('/embed/') === 0) return u.pathname.split('/')[2];
    return u.searchParams.get('v');
  }
  function vimeoId(u){
    var parts = u.pathname.split('/').filter(function(p){ return !!p; });
    for(var i = parts.length-1; i >= 0; i--){ if(isDigits(parts[i])) return parts[i]; }
    return null;
  }
  function safeId(id){ return id && new RegExp('^[A-Za-z0-9_-]+$').test(id) ? id : null; }

  function buildEmbed(src){
    var box = el('div', { class:'embed' });
    box.innerHTML = '<iframe src="' + escAttr(src) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>';
    return box;
  }

  // twitter / x embeds
  var twLoading = false, twCbs = [];
  function loadTwitter(cb){
    if(window.twttr && window.twttr.widgets){ cb(); return; }
    twCbs.push(cb);
    if(twLoading) return; twLoading = true;
    var s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js'; s.async = true; s.charset = 'utf-8';
    s.onload = function(){ var c = twCbs.slice(); twCbs = []; c.forEach(function(f){ try{ f(); }catch(e){} }); };
    document.head.appendChild(s);
  }
  function buildTweet(url){
    var holder = el('div', { class:'twitter-holder' });
    holder.innerHTML = '<blockquote class="twitter-tweet" data-theme="dark" data-dnt="true"><a href="' + escAttr(url) + '"></a></blockquote>';
    loadTwitter(function(){ if(window.twttr && window.twttr.widgets) window.twttr.widgets.load(holder); });
    return holder;
  }

  // generic link cards (server-scraped OG data, cached)
  var previewCache = {};
  function fetchPreview(url, cb){
    if(previewCache[url]){ cb(previewCache[url]); return; }
    api('/api/preview?url=' + encodeURIComponent(url)).then(function(b){
      previewCache[url] = b.preview; cb(b.preview);
    }).catch(function(){ cb(null); });
  }
  function domainOf(url){ try { return hostOf(new URL(url)); } catch(e){ return url; } }
  function simpleLink(card, url){
    var meta = el('div', { class:'lc-meta' });
    meta.appendChild(el('div', { class:'lc-site' }, el('span', { text: domainOf(url) })));
    meta.appendChild(el('div', { class:'lc-title', text: url }));
    card.appendChild(meta);
  }
  function buildLinkCard(url){
    var card = el('a', { class:'linkcard loading', href:url, target:'_blank', rel:'noopener noreferrer' }, 'Loading preview…');
    fetchPreview(url, function(p){
      card.classList.remove('loading'); card.textContent = '';
      if(!p || p.type === 'error'){ simpleLink(card, url); return; }
      if(p.type === 'image' && p.image){ card.appendChild(el('img', { class:'lc-img', src:p.image, loading:'lazy', alt:'' })); return; }
      if(p.image) card.appendChild(el('img', { class:'lc-img', src:p.image, loading:'lazy', alt:'' }));
      var meta = el('div', { class:'lc-meta' });
      var site = el('div', { class:'lc-site' });
      if(p.favicon) site.appendChild(el('img', { src:p.favicon, alt:'', loading:'lazy' }));
      site.appendChild(el('span', { text: p.site_name || domainOf(url) }));
      meta.appendChild(site);
      if(p.title) meta.appendChild(el('div', { class:'lc-title', text:p.title }));
      if(p.description) meta.appendChild(el('div', { class:'lc-desc', text:p.description }));
      card.appendChild(meta);
    });
    return card;
  }

  function buildMediaNode(rawUrl){
    var u; try { u = new URL(rawUrl); } catch(e){ return null; }
    var host = hostOf(u);
    try {
      if(host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com'){
        var id = safeId(ytId(u, host));
        if(id) return buildEmbed('https://www.youtube-nocookie.com/embed/' + id);
      }
      if(host === 'vimeo.com' || host === 'player.vimeo.com'){
        var vid = vimeoId(u);
        if(vid) return buildEmbed('https://player.vimeo.com/video/' + vid);
      }
      if((host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') && u.pathname.indexOf('/status/') >= 0){
        return buildTweet(rawUrl);
      }
      if(isImageUrl(u)){
        return el('img', { class:'inline-img', src:rawUrl, loading:'lazy', alt:'' });
      }
      return buildLinkCard(rawUrl);
    } catch(e){ return null; }
  }

  function buildMedia(note){
    var text = note.content || '';
    if(note.items){ note.items.forEach(function(it){ text += '  ' + (it.text || ''); }); }
    var urls = extractUrls(text);
    if(!urls.length) return null;
    var media = el('div', { class:'media' });
    var count = 0;
    urls.forEach(function(u){ if(count >= 5) return; var n = buildMediaNode(u); if(n){ media.appendChild(n); count++; } });
    return count ? media : null;
  }

  // ── card body ────────────────────────────────────────────
  function linkifyInto(node, text){
    var re = new RegExp('https?://[^\\\\s]+', 'gi');
    var last = 0, m;
    while((m = re.exec(text))){
      var start = m.index;
      if(start > last) node.appendChild(document.createTextNode(text.slice(last, start)));
      var raw = m[0]; var url = trimUrl(raw); var tail = raw.slice(url.length);
      node.appendChild(el('a', { href:url, target:'_blank', rel:'noopener noreferrer', text:url }));
      if(tail) node.appendChild(document.createTextNode(tail));
      last = start + raw.length;
    }
    if(last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  // ── one card ─────────────────────────────────────────────
  function buildCard(note){
    var card = el('div', { class:'note-card' + (note.pinned?' pinned':'') + (note.done?' done':'') + (state.view.compact?' compact':'') });

    // top row: flag/date + actions
    var top = el('div', { class:'card-top' });
    var leftWrap = el('div', { style:'display:flex;align-items:center;gap:8px;min-width:0;' });
    if(note.pinned) leftWrap.appendChild(el('span', { class:'pin-flag' }, '📌 Pinned'));
    else if(note.done) leftWrap.appendChild(el('span', { class:'done-flag' }, '✓ Done'));
    leftWrap.appendChild(el('span', { class:'card-date', text: formatStamp(note.created_at) }));

    var progressSpan = null;
    if(note.kind === 'todo' && note.items){
      progressSpan = el('span', { class:'progress', text: todoProgress(note) });
      leftWrap.appendChild(progressSpan);
    }
    top.appendChild(leftWrap);

    var actions = el('div', { class:'card-actions' });
    actions.appendChild(el('button', { class:'act' + (note.pinned?' on':''), title:'Pin', onclick: function(e){ e.stopPropagation(); togglePin(note); } }, note.pinned ? '📌' : '📍'));
    actions.appendChild(el('button', { class:'act', title:'Mark done', onclick: function(e){ e.stopPropagation(); toggleDone(note, card); } }, '✓'));
    actions.appendChild(el('button', { class:'act', title:'Edit', onclick: function(e){ e.stopPropagation(); editNote(note); } }, '✎'));
    actions.appendChild(el('button', { class:'act danger', title:'Delete', onclick: function(e){ e.stopPropagation(); deleteNote(note); } }, '🗑'));
    top.appendChild(actions);
    card.appendChild(top);

    // tags
    if(note.tag_ids && note.tag_ids.length){
      var tagRow = el('div', { class:'card-tags' });
      note.tag_ids.forEach(function(tid){
        var t = state.tagById[tid]; if(!t) return;
        tagRow.appendChild(el('span', { class:'tag-pill', text:'#' + t.name }));
      });
      if(tagRow.childNodes.length) card.appendChild(tagRow);
    }

    // body
    var body = el('div', { class:'card-body' });
    if(note.kind === 'todo'){
      if(note.content) body.appendChild(el('div', { class:'card-title-line', text: note.content }));
      var ul = el('ul', { class:'card-todo' });
      (note.items || []).forEach(function(it, idx){
        var li = el('li', it.done ? { class:'checked' } : null);
        var cb = el('input', { type:'checkbox' }); cb.checked = !!it.done;
        cb.addEventListener('change', function(e){
          e.stopPropagation();
          note.items[idx].done = cb.checked;
          li.classList.toggle('checked', cb.checked);
          if(progressSpan) progressSpan.textContent = todoProgress(note);
          patchNote(note.id, { items: note.items });
        });
        li.appendChild(cb);
        li.appendChild(el('span', { text: it.text }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    } else {
      linkifyInto(body, note.content || '');
    }
    card.appendChild(body);

    // media previews
    var media = buildMedia(note);
    if(media) card.appendChild(media);

    // click card background → edit
    card.addEventListener('click', function(e){
      if(e.target.closest('a, button, input, label, .media, .embed, .twitter-holder, .linkcard')) return;
      editNote(note);
    });
    return card;
  }

  function todoProgress(note){
    var items = note.items || []; var done = 0;
    items.forEach(function(it){ if(it.done) done++; });
    return done + '/' + items.length;
  }

  // ── board ────────────────────────────────────────────────
  function matchesFilter(n){
    if(!state.filter) return true;
    if(n.tag_ids.indexOf(state.filter) >= 0) return true;
    var kids = state.childMap[state.filter] || [];
    for(var i=0;i<kids.length;i++){ if(n.tag_ids.indexOf(kids[i].id) >= 0) return true; }
    return false;
  }
  function matchesSearch(n){
    if(!state.search) return true;
    var hay = (n.content || '').toLowerCase();
    (n.items || []).forEach(function(it){ hay += ' ' + (it.text || '').toLowerCase(); });
    n.tag_ids.forEach(function(tid){ var t = state.tagById[tid]; if(t) hay += ' #' + t.name.toLowerCase(); });
    hay += ' ' + formatStamp(n.created_at).toLowerCase() + ' ' + isoDate(n.created_at);
    var terms = state.search.toLowerCase().split(' ').filter(function(x){ return !!x; });
    for(var i=0;i<terms.length;i++){ if(hay.indexOf(terms[i]) < 0) return false; }
    return true;
  }
  function groupLabelEl(text){ return el('div', { class:'group-label', text:text }); }

  function renderBoard(){
    var board = qs('board'); board.textContent = '';
    var list = state.notes.filter(matchesFilter).filter(matchesSearch);
    if(!list.length){
      var msg = state.notes.length ? 'Nothing matches that filter.' : 'No notes yet.';
      var sub = state.notes.length ? 'Try clearing your search or tag filter.' : 'Type a thought above and hit Save — it becomes a sticky note stamped with today.';
      board.appendChild(el('div', { class:'empty' }, el('p', { style:'margin:0 0 8px;font-size:16px;', html:'<strong>' + msg + '</strong>' }), el('p', { style:'margin:0;', text: sub })));
      return;
    }
    var cmp = state.view.oldest ? function(a,b){ return a.created_at - b.created_at; } : function(a,b){ return b.created_at - a.created_at; };
    var pinned = list.filter(function(n){ return n.pinned; }).sort(cmp);
    var rest = list.filter(function(n){ return !n.pinned; }).sort(cmp);

    if(pinned.length){
      if(state.view.group) board.appendChild(groupLabelEl('Pinned'));
      pinned.forEach(function(n){ board.appendChild(buildCard(n)); });
    }
    if(state.view.group){
      var order = ['Today','Yesterday','Earlier this week','Earlier this month','Older'];
      var buckets = {};
      rest.forEach(function(n){ var g = groupFor(n.created_at); (buckets[g] = buckets[g] || []).push(n); });
      order.forEach(function(g){
        if(buckets[g] && buckets[g].length){
          board.appendChild(groupLabelEl(g));
          buckets[g].forEach(function(n){ board.appendChild(buildCard(n)); });
        }
      });
    } else {
      rest.forEach(function(n){ board.appendChild(buildCard(n)); });
    }
  }

  // ── note actions ─────────────────────────────────────────
  function patchNote(id, patch){
    return api('/api/notes/' + id, { method:'PUT', body: JSON.stringify(patch) })
      .then(function(b){ replaceNote(b.note); return b.note; })
      .catch(function(err){ toast(err.message || 'Save failed'); });
  }
  function replaceNote(note){
    for(var i=0;i<state.notes.length;i++){ if(state.notes[i].id === note.id){ state.notes[i] = note; return; } }
    state.notes.unshift(note);
  }
  function togglePin(note){
    note.pinned = !note.pinned;
    patchNote(note.id, { pinned: note.pinned }).then(function(){ renderBoard(); });
  }
  function toggleDone(note, card){
    note.done = !note.done;
    card.classList.toggle('done', note.done);
    patchNote(note.id, { done: note.done });
  }
  function deleteNote(note){
    if(!confirm('Delete this note? This cannot be undone.')) return;
    api('/api/notes/' + note.id, { method:'DELETE' }).then(function(){
      state.notes = state.notes.filter(function(n){ return n.id !== note.id; });
      renderBoard();
    }).catch(function(err){ toast(err.message || 'Delete failed'); });
  }

  // ── composer ─────────────────────────────────────────────
  function openComposer(){
    qs('composer').classList.add('open'); qs('composer').classList.remove('collapsed');
    qs('composer-save').textContent = state.composer.editingId ? 'Update' : 'Save';
  }
  function closeComposer(){
    var c = qs('composer'); c.classList.remove('open'); c.classList.add('collapsed');
    resetComposer();
  }
  function resetComposer(){
    state.composer = { kind:'note', content:'', items:[{text:'',done:false}], tagIds:{}, editingId:null };
    setSeg('note'); renderComposerBody(); renderComposerTags();
  }
  function setSeg(kind){
    state.composer.kind = kind;
    qs('seg-note').classList.toggle('active', kind === 'note');
    qs('seg-todo').classList.toggle('active', kind === 'todo');
  }
  function syncComposerContent(){
    if(state.composer.kind === 'note'){ var a = qs('note-area'); if(a) state.composer.content = a.value; }
    else { var t = qs('todo-title'); if(t) state.composer.content = t.value; }
  }
  function renderComposerBody(){
    var b = qs('composer-body'); b.textContent = '';
    if(state.composer.kind === 'note'){
      var area = el('textarea', { id:'note-area', class:'note-area', placeholder:'type your note here… paste a YouTube, Vimeo, X or website link for a preview' });
      area.value = state.composer.content || '';
      b.appendChild(area);
    } else {
      var title = el('input', { id:'todo-title', class:'note-area', style:'min-height:auto;', placeholder:'List title (e.g. Launch List)' });
      title.value = state.composer.content || '';
      b.appendChild(title);
      var items = el('div', { class:'todo-items', id:'todo-items' });
      b.appendChild(items);
      renderComposerItems();
      b.appendChild(el('button', { class:'add-item-btn', onclick:function(){ state.composer.items.push({text:'',done:false}); renderComposerItems(); } }, '+ Add item'));
    }
  }
  function renderComposerItems(){
    var wrap = qs('todo-items'); if(!wrap) return; wrap.textContent = '';
    state.composer.items.forEach(function(it, idx){
      var row = el('div', { class:'todo-row' });
      var cb = el('input', { type:'checkbox' }); cb.checked = !!it.done;
      cb.addEventListener('change', function(){ state.composer.items[idx].done = cb.checked; });
      var inp = el('input', { type:'text', placeholder:'Item ' + (idx+1), value: it.text });
      inp.addEventListener('input', function(){ state.composer.items[idx].text = inp.value; });
      inp.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){ e.preventDefault(); state.composer.items.splice(idx+1,0,{text:'',done:false}); renderComposerItems();
          var rows = wrap.querySelectorAll('.todo-row input[type=text]'); if(rows[idx+1]) rows[idx+1].focus(); }
      });
      var del = el('button', { class:'del-item', title:'Remove', onclick:function(){ state.composer.items.splice(idx,1); if(!state.composer.items.length) state.composer.items.push({text:'',done:false}); renderComposerItems(); } }, '✕');
      row.appendChild(cb); row.appendChild(inp); row.appendChild(del);
      wrap.appendChild(row);
    });
  }
  function renderComposerTags(){
    var wrap = qs('composer-tagrow'); wrap.textContent = '';
    if(!state.tags.length){ wrap.appendChild(el('span', { class:'hint' }, 'No tags yet — add some with “# Edit Tags” above.')); return; }
    state.tags.forEach(function(t){
      var on = !!state.composer.tagIds[t.id];
      var label = (t.parent_id ? '↳ ' : '') + '#' + t.name;
      var chip = el('button', { class:'chip tag' + (on?' active':''), onclick: function(){
        state.composer.tagIds[t.id] = !state.composer.tagIds[t.id];
        chip.classList.toggle('active', !!state.composer.tagIds[t.id]);
      } }, label);
      wrap.appendChild(chip);
    });
  }
  function editNote(note){
    state.composer = {
      kind: note.kind, content: note.content || '',
      items: (note.items && note.items.length) ? note.items.map(function(it){ return { text:it.text, done:!!it.done }; }) : [{text:'',done:false}],
      tagIds: {}, editingId: note.id
    };
    (note.tag_ids || []).forEach(function(tid){ state.composer.tagIds[tid] = true; });
    setSeg(note.kind); renderComposerBody(); renderComposerTags(); openComposer();
    window.scrollTo({ top:0, behavior:'smooth' });
    var f = qs('note-area') || qs('todo-title'); if(f) f.focus();
  }
  function saveComposer(){
    syncComposerContent();
    var kind = state.composer.kind;
    var content = (state.composer.content || '').trim();
    var items = null;
    if(kind === 'todo'){
      items = state.composer.items.map(function(it){ return { text:(it.text||'').trim(), done:!!it.done }; }).filter(function(it){ return it.text.length > 0; });
    }
    if(kind === 'note' && !content){ toast('Note is empty'); return; }
    if(kind === 'todo' && !content && (!items || !items.length)){ toast('Add a title or at least one item'); return; }
    var tagIds = Object.keys(state.composer.tagIds).filter(function(k){ return state.composer.tagIds[k]; });
    var payload = { kind:kind, content:content, items:items, tag_ids:tagIds };
    var editingId = state.composer.editingId;
    var req = editingId
      ? api('/api/notes/' + editingId, { method:'PUT', body: JSON.stringify(payload) })
      : api('/api/notes', { method:'POST', body: JSON.stringify(payload) });
    req.then(function(b){ replaceNote(b.note); closeComposer(); renderBoard(); })
       .catch(function(err){ toast(err.message || 'Could not save'); });
  }

  // ── tag bar + editor ─────────────────────────────────────
  function renderTagBar(){
    var bar = qs('tagbar'); bar.textContent = '';
    bar.appendChild(el('button', { class:'chip ghost', onclick: openTagEditor }, '+ Add Tag'));
    bar.appendChild(el('button', { class:'chip ghost', onclick: openTagEditor }, '# Edit Tags'));
    state.topTags.forEach(function(t){
      var active = state.filter === t.id;
      var hasKids = (state.childMap[t.id] || []).length > 0;
      var chip = el('button', { class:'chip tag' + (active?' active':''), onclick: function(){
        state.filter = (state.filter === t.id) ? null : t.id; renderTagBar(); renderBoard();
      } }, '#' + t.name);
      if(hasKids) chip.appendChild(el('span', { class:'caret' }, ' ▾'));
      bar.appendChild(chip);
      if(active && hasKids){
        (state.childMap[t.id] || []).forEach(function(ct){
          var cActive = state.filter === ct.id;
          bar.appendChild(el('button', { class:'chip tag chip-sub' + (cActive?' active':''), onclick: function(){
            state.filter = (state.filter === ct.id) ? t.id : ct.id; renderTagBar(); renderBoard();
          } }, '↳ #' + ct.name));
        });
      }
    });
  }

  function openTagEditor(){ qs('tag-modal').classList.add('open'); renderTagEditor(); var i = qs('new-tag-input'); if(i){ i.value=''; setTimeout(function(){ i.focus(); }, 50); } }
  function closeTagEditor(){ qs('tag-modal').classList.remove('open'); }
  function renderTagEditor(){
    var list = qs('tag-edit-list'); list.textContent = '';
    if(!state.tags.length){ list.appendChild(el('p', { class:'hint', style:'padding:8px 0;' }, 'No tags yet. Add your first below.')); return; }
    state.topTags.forEach(function(t){ list.appendChild(tagEditRow(t, false)); (state.childMap[t.id] || []).forEach(function(ct){ list.appendChild(tagEditRow(ct, true)); }); });
  }
  function tagEditRow(t, isChild){
    var row = el('div', { class:'tag-edit-row', style: isChild ? 'padding-left:22px;' : '' });
    row.appendChild(el('span', { class:'grip' }, isChild ? '↳' : '#'));
    var inp = el('input', { type:'text', value: t.name, maxlength:'40' });
    function commit(){ var name = inp.value.trim(); if(!name || name === t.name) return; api('/api/tags/' + t.id, { method:'PUT', body: JSON.stringify({ name:name }) }).then(reloadTags).catch(function(e){ toast(e.message); }); }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ inp.blur(); } });
    row.appendChild(inp);
    if(!isChild){
      row.appendChild(el('button', { class:'act', title:'Add sub-tag', onclick: function(){
        var name = prompt('Sub-tag of #' + t.name + ':'); if(name && name.trim()) api('/api/tags', { method:'POST', body: JSON.stringify({ name:name.trim(), parent_id:t.id }) }).then(reloadTags).catch(function(e){ toast(e.message); });
      } }, '＋'));
    }
    row.appendChild(el('button', { class:'act danger', title:'Delete tag', onclick: function(){
      if(!confirm('Delete #' + t.name + '? It is removed from notes, but the notes are kept.')) return;
      api('/api/tags/' + t.id, { method:'DELETE' }).then(function(){ if(state.filter === t.id) state.filter = null; reloadTags(); }).catch(function(e){ toast(e.message); });
    } }, '🗑'));
    return row;
  }
  function addTopTag(){
    var i = qs('new-tag-input'); var name = (i.value || '').trim(); if(!name) return;
    api('/api/tags', { method:'POST', body: JSON.stringify({ name:name }) }).then(function(){ i.value=''; reloadTags(); i.focus(); }).catch(function(e){ toast(e.message); });
  }
  function reloadTags(){
    return api('/api/tags').then(function(b){ setTags(b.tags); renderTagBar(); renderComposerTags(); renderTagEditor(); });
  }

  // ── view menu ────────────────────────────────────────────
  function renderViewMenu(){
    var menu = qs('view-menu');
    menu.querySelectorAll('.menu-item').forEach(function(item){
      var key = item.getAttribute('data-view');
      var on = key === 'group' ? state.view.group : key === 'compact' ? state.view.compact : state.view.oldest;
      item.classList.toggle('on', on);
    });
  }

  // ── load + init ──────────────────────────────────────────
  function load(){
    Promise.all([ api('/api/notes'), api('/api/tags') ]).then(function(res){
      state.notes = res[0].notes || [];
      setTags(res[1].tags || []);
      renderTagBar(); renderComposerTags(); renderBoard();
    }).catch(function(err){
      qs('board').textContent = '';
      qs('board').appendChild(el('div', { class:'empty' }, el('p', { html:'<strong>Could not load notes.</strong>' }), el('p', { text: err.message || '' })));
    });
  }

  function init(){
    // composer open triggers
    qs('composer-collapsed').addEventListener('click', function(){ resetComposer(); openComposer(); var a = qs('note-area'); if(a) a.focus(); });
    qs('add-note-btn').addEventListener('click', function(){ resetComposer(); openComposer(); var a = qs('note-area'); if(a) a.focus(); });
    qs('seg-note').addEventListener('click', function(){ syncComposerContent(); setSeg('note'); renderComposerBody(); });
    qs('seg-todo').addEventListener('click', function(){ syncComposerContent(); setSeg('todo'); renderComposerBody(); });
    qs('composer-close').addEventListener('click', closeComposer);
    qs('composer-save').addEventListener('click', saveComposer);
    qs('composer').addEventListener('keydown', function(e){
      if((e.metaKey || e.ctrlKey) && e.key === 'Enter'){ e.preventDefault(); saveComposer(); }
      else if(e.key === 'Escape'){ e.preventDefault(); closeComposer(); }
    });

    // search
    qs('search').addEventListener('input', function(e){ state.search = e.target.value; renderBoard(); });

    // tag editor modal
    qs('new-tag-add').addEventListener('click', addTopTag);
    qs('new-tag-input').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); addTopTag(); } });
    qs('tag-modal-close').addEventListener('click', closeTagEditor);
    qs('tag-modal').addEventListener('click', function(e){ if(e.target === qs('tag-modal')) closeTagEditor(); });

    // view menu
    var vbtn = qs('view-menu-btn'); var vmenu = qs('view-menu');
    vbtn.addEventListener('click', function(e){ e.stopPropagation(); vmenu.classList.toggle('open'); renderViewMenu(); });
    vmenu.addEventListener('click', function(e){ e.stopPropagation(); });
    vmenu.querySelectorAll('.menu-item').forEach(function(item){
      item.addEventListener('click', function(){
        var key = item.getAttribute('data-view');
        if(key === 'group') state.view.group = !state.view.group;
        else if(key === 'compact') state.view.compact = !state.view.compact;
        else state.view.oldest = !state.view.oldest;
        saveView(); renderViewMenu(); renderBoard();
      });
    });
    document.addEventListener('click', function(){ vmenu.classList.remove('open'); });

    renderComposerBody(); renderComposerTags(); renderViewMenu();
    load();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`;
