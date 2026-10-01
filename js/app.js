// app.js — rendering, modals, event wiring. Uses store.js for all data and
// sync.js for the Gist sync. Views are rendered as HTML strings (with every
// user-supplied string run through esc()) and wired via delegated click /
// change / submit listeners that read data-act attributes, rather than a
// vdom — the library is small enough that re-rendering a whole view on
// every change is cheap and keeps this file easy to follow.
import * as S from './store.js';
import * as Sync from './sync.js';

S.load();

// ---------- tiny DOM/string helpers ----------
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(sel,root){ return (root||document).querySelector(sel); }
function $all(sel,root){ return Array.from((root||document).querySelectorAll(sel)); }

// ---------- theme ----------
const LIB_COLORS=['#7a3b2e','#5c4b2a','#3f5a3f','#2f4a52','#4a3b5c','#6b4423','#5c2f3a','#3a4a5c','#7a5a2a','#2f5c4a','#5c3a2f','#3a5c5c','#6b3a5c','#4a5c2f','#5c4a3a'];
const LCARS_COLORS=['#ff9966','#cc99cc','#9999cc','#ffcc66','#99cc99','#cc6666','#ff99cc','#66cccc','#cccc66','#9999ff','#ffb399','#66ccff','#cc99ff','#99ffcc','#ffe066'];
function getTheme(){ const t=localStorage.getItem(S.K_THEME); return t==='lcars'?'lcars':'library'; }
function setTheme(t){ t=t==='lcars'?'lcars':'library'; try{localStorage.setItem(S.K_THEME,t);}catch(e){}
  document.documentElement.setAttribute('data-theme',t);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t==='lcars'?'#000000':'#f5ead6');
  refreshView(); }
document.documentElement.setAttribute('data-theme',getTheme());
document.querySelector('meta[name="theme-color"]').setAttribute('content', getTheme()==='lcars'?'#000000':'#f5ead6');

function coverColor(seed){ const pal = getTheme()==='lcars'?LCARS_COLORS:LIB_COLORS; return pal[S.hashStr(seed)%pal.length]; }
function coverLetter(title){ const t=(title||'').trim(); return t?t.charAt(0).toUpperCase():'?'; }
function coverStyleAttr(id,title){ const d=S.det(id); const c=d.color||coverColor(id); return ' style="--c:'+c+'"'; }
function coverHtml(id,title,size){ return '<div class="cover"'+coverStyleAttr(id,title)+'>'+esc(coverLetter(title))+'</div>'; }

// ---------- toast ----------
let toastTimer=null;
function toast(msg,actLabel,actFn){
  const t=document.getElementById('toast'); t.innerHTML='';
  t.appendChild(document.createTextNode(msg));
  if(actLabel){ const b=document.createElement('button'); b.textContent=actLabel; b.onclick=()=>{ t.classList.remove('show'); actFn&&actFn(); }; t.appendChild(b); }
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'), actLabel?5000:2600);
}

// ---------- modal system ----------
let modalCtx=null;
function closeModal(){ const root=document.getElementById('modal-root');
  if(modalCtx){ document.removeEventListener('keydown',modalCtx.onkey); } root.innerHTML=''; modalCtx=null; }
function showModal(html,{onAction,onMount,wide}={}){
  closeModal();
  const root=document.getElementById('modal-root');
  const back=document.createElement('div'); back.className='modal-backdrop';
  const m=document.createElement('div'); m.className='modal'+(wide?' wide':'');
  m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true');
  // chrome (grab handle + close button) lives outside .modal-body so a content-only
  // refresh (rerenderDetail) can replace .modal-body without disturbing it
  m.innerHTML='<div class="modal-grab" aria-hidden="true"></div><button class="iconbtn modal-x" data-act="close" aria-label="Close">&times;</button><div class="modal-body">'+html+'</div>';
  back.appendChild(m);
  back.addEventListener('mousedown',e=>{ if(e.target===back) closeModal(); });
  function onkey(e){ if(e.key==='Escape') closeModal(); }
  document.addEventListener('keydown',onkey);
  // forms route through the 'submit' listener below; a bare click/change bubbling up to the
  // <form data-act="..."> wrapper (e.g. focusing a sibling field) must not also fire it here.
  // "close" is handled here directly so every modal can be dismissed the same way without
  // each content template having to wire its own close case.
  const act=e=>{ const t=e.target.closest('[data-act]'); if(!t || t.tagName==='FORM') return;
    if(t.dataset.act==='close'){ closeModal(); return; }
    if(onAction) onAction(t,e,m); };
  back.addEventListener('click',act);
  back.addEventListener('change',act);
  back.addEventListener('submit',e=>{ e.preventDefault(); const t=e.target.closest('form')||e.target; if(onAction) onAction(t,e,m); });
  root.appendChild(back);
  modalCtx={back,onkey,m};
  if(onMount) onMount(m);
  const f=m.querySelector('[autofocus]'); if(f) setTimeout(()=>f.focus(),30);
  trapFocus(m);
}
function trapFocus(m){
  const sel='button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  function onkey(e){ if(e.key!=='Tab') return; const items=$all(sel,m).filter(x=>!x.disabled && x.offsetParent!==null);
    if(!items.length) return; const first=items[0], last=items[items.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); } }
  m.addEventListener('keydown',onkey);
}

// ---------- nav / view state ----------
let currentView='dashboard';
let statusFilter='all', fmtFilter='all', ratingFilter='all', searchQuery='';
let libTab='series';
const openSeries=new Set();

function setView(v){ currentView=v;
  $all('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.view===v)));
  renderView(); window.scrollTo(0,0);
}
function refreshView(){ renderView(); }
function renderView(){
  const root=document.getElementById('view');
  if(currentView==='dashboard') root.innerHTML=renderDashboard();
  else if(currentView==='library') root.innerHTML=renderLibrary();
  else if(currentView==='stats') root.innerHTML=renderStats();
  else if(currentView==='settings') root.innerHTML=renderSettings();
}

// ================= DASHBOARD =================
function greeting(){ const h=new Date().getHours(); return h<5?'Still up':h<12?'Good morning':h<17?'Good afternoon':h<22?'Good evening':'Still up'; }
function renderDashboard(){
  const st=S.computeStats();
  const goal=S.getGoal();
  const year=new Date().getFullYear();
  const doneThisYear=st.byYear[String(year)]||0;
  const streak=S.currentStreak();
  const due=S.dueReminders();

  let ring='';
  if(goal){
    const pct=Math.min(1, doneThisYear/goal.target);
    const r=32, c=2*Math.PI*r;
    ring=`<div class="ring"><svg viewBox="0 0 76 76"><circle class="track" cx="38" cy="38" r="${r}"></circle>
      <circle class="fill" cx="38" cy="38" r="${r}" style="stroke-dasharray:${c};stroke-dashoffset:${c*(1-pct)}"></circle></svg>
      <div class="ring-num">${doneThisYear}</div></div>
      <div><div class="hero-goal-lbl">${doneThisYear} of ${goal.target} books in ${year}</div>
      <div class="hero-streak"><span aria-hidden="true">&#128293;</span> <b>${streak}</b> day streak</div></div>`;
  } else {
    ring=`<button class="btn ghost sm" data-act="goal-open">Set a ${year} goal</button>
      <div class="hero-streak"><span aria-hidden="true">&#128293;</span> <b>${streak}</b> day streak</div>`;
  }

  const dueBanner = due.length ? `<section class="dash-due">
      <span>${due.length===1?'1 reminder is':due.length+' reminders are'} due</span>
      <button data-act="reminders-open">View</button>
    </section>` : '';

  const reading=S.readingList();
  const continueHtml = reading.length ? reading.map(({s,b})=>{
      const d=S.det(b.id); const pct = d.ptot? Math.min(100,Math.round(100*(d.pcur||0)/d.ptot)) : null;
      return `<article class="rcard">
        ${coverHtml(b.id,S.displayTitle(b))}
        <div class="rcard-body">
          <div class="rcard-title">${esc(S.displayTitle(b))}</div>
          <div class="rcard-sub">${esc(s.series==='Standalone'?S.authorOf(s,b):s.series+(b.num?' #'+b.num:''))}</div>
          <div class="rcard-progress">
            <div class="bar"><i style="width:${pct==null?0:pct}%"></i></div>
            <span>${d.ptot? (d.pcur||0)+' / '+d.ptot+(d.fmt==='audio'?' ch':' p') : 'No page count set'}</span>
          </div>
          <div class="rcard-actions">
            <button class="stepbtn" data-act="step" data-id="${b.id}" data-delta="-10">&minus;10</button>
            <button class="stepbtn" data-act="step" data-id="${b.id}" data-delta="10">+10</button>
            <button class="donebtn" data-act="finish" data-id="${b.id}">Finished</button>
          </div>
        </div>
      </article>`;
    }).join('') : '<div class="empty-row">Nothing in progress &mdash; open Library and start something.</div>';

  const recs=S.recommendations(8);
  const recHtml = recs.length ? recs.map(({s,b,reason})=>`
      <article class="chipcard" data-act="open" data-id="${b.id}" role="button" tabindex="0">
        ${coverHtml(b.id,S.displayTitle(b))}
        <div class="chipcard-title">${esc(S.displayTitle(b))}</div>
        <div class="chipcard-reason">${esc(reason)}</div>
      </article>`).join('') : '<div class="empty-row">Add a few books and rate some favorites to get picks here.</div>';

  const upnext=S.upNextList();
  const upnextSection = upnext.length ? `<section class="dash-section">
      <div class="sec-head"><h2>Up next</h2></div>
      <div class="hscroll">${upnext.map(({s,b})=>`
        <article class="chipcard" data-act="open" data-id="${b.id}" role="button" tabindex="0">
          ${coverHtml(b.id,S.displayTitle(b))}
          <div class="chipcard-title">${esc(S.displayTitle(b))}</div>
          <div class="chipcard-reason">${esc(s.series)}</div>
        </article>`).join('')}</div></section>` : '';

  return `<div class="dash">
    <section class="dash-hero">
      <div class="hero-greet">${greeting()}</div>
      <div class="hero-row">${ring}</div>
      <div class="hero-stats">
        <div class="hero-stat"><b>${st.reading}</b><span>Reading</span></div>
        <div class="hero-stat"><b>${st.read}</b><span>Finished</span></div>
        <div class="hero-stat"><b>${st.unread}</b><span>Unread</span></div>
        <div class="hero-stat"><b>${st.total}</b><span>Total</span></div>
      </div>
    </section>
    ${dueBanner}
    <section class="dash-section">
      <div class="sec-head"><h2>Continue reading</h2></div>
      <div class="hscroll">${continueHtml}</div>
    </section>
    <section class="dash-section">
      <div class="sec-head"><h2>Recommended for you</h2></div>
      <div class="hscroll">${recHtml}</div>
    </section>
    ${upnextSection}
  </div>`;
}

// ================= LIBRARY =================
function passesFilter(s,b){
  const id=b.id;
  if(statusFilter!=='all' && S.statusOf(id)!==statusFilter) return false;
  const d=S.det(id);
  if(fmtFilter!=='all' && (d.fmt||'book')!==fmtFilter) return false;
  if(ratingFilter!=='all'){ const r=S.ratings[id]||0;
    if(ratingFilter==='unrated'){ if(r) return false; } else if(r < +ratingFilter) return false; }
  if(searchQuery){ if(!S.hayFor(s,b).includes(searchQuery.toLowerCase())) return false; }
  return true;
}
function statusDotStyle(id){ return 'var(--dot-'+S.statusOf(id)+')'; }
function bookRowHtml(s,b){
  const id=b.id; const r=S.ratings[id]||0; const d=S.det(id);
  const sub=[]; if(s.series!=='Standalone' && b.num) sub.push('#'+b.num); const a=S.authorOf(s,b); if(a) sub.push(a);
  if(d.fmt==='audio') sub.push('\u{1F3A7}'); if(d.fmt==='manga') sub.push('\u{1F4D5}');
  return `<button class="book-row" data-act="open" data-id="${id}">
    <span class="statusdot" style="--dot:${statusDotStyle(id)}"></span>
    <span class="book-main">
      <span class="book-title">${esc(S.displayTitle(b))}</span>
      <span class="book-sub">${esc(sub.join(' · '))}</span>
    </span>
    ${r?`<span class="book-stars">${'★'.repeat(r)}</span>`:''}
  </button>`;
}
function renderLibrary(){
  const chips=['all','unread','reading','read','dnf'].map(f=>
    `<button data-act="filter" data-filter="${f}" aria-pressed="${String(statusFilter===f)}">${f==='all'?'All':S.ST_LABEL[f]}</button>`).join('');

  if(searchQuery){
    const results=[];
    S.catalog.series.forEach(s=>s.books.forEach(b=>{ if(passesFilter(s,b)) results.push({s,b}); }));
    return `<div class="lib">
      <div class="chips">${chips}</div>
      <div class="sec-head"><h2>${results.length} match${results.length===1?'':'es'}</h2></div>
      <div class="series-group" data-open="true"><div class="series-books">
        ${results.length?results.map(({s,b})=>bookRowHtml(s,b)).join(''):'<div class="empty-row">No books match.</div>'}
      </div></div>
    </div>`;
  }

  const subbar=`<div class="subbar">
    <select data-act="fmt-filter" aria-label="Filter by format">
      <option value="all"${fmtFilter==='all'?' selected':''}>Any format</option>
      <option value="book"${fmtFilter==='book'?' selected':''}>Books</option>
      <option value="audio"${fmtFilter==='audio'?' selected':''}>Audiobooks</option>
      <option value="manga"${fmtFilter==='manga'?' selected':''}>Manga</option>
    </select>
    <select data-act="rating-filter" aria-label="Filter by rating">
      <option value="all"${ratingFilter==='all'?' selected':''}>Any rating</option>
      <option value="5"${ratingFilter==='5'?' selected':''}>5 stars</option>
      <option value="4"${ratingFilter==='4'?' selected':''}>4+ stars</option>
      <option value="3"${ratingFilter==='3'?' selected':''}>3+ stars</option>
      <option value="unrated"${ratingFilter==='unrated'?' selected':''}>Unrated</option>
    </select>
    <button class="btn ghost sm" data-act="surprise">Surprise me</button>
  </div>`;

  const seg=`<div class="segctl" role="tablist">
    <button data-act="seg" data-tab="series" aria-pressed="${String(libTab==='series')}">Series</button>
    <button data-act="seg" data-tab="singles" aria-pressed="${String(libTab==='singles')}">Singles</button>
  </div>`;

  let body;
  if(libTab==='series'){
    const list=S.catalog.series.filter(s=>s.series!=='Standalone');
    body = list.length ? list.map(s=>{
      const books=s.books.filter(b=>passesFilter(s,b));
      if(!books.length) return '';
      const open=openSeries.has(s.sid);
      const total=s.books.length, done=s.books.filter(b=>S.statusOf(b.id)==='read').length;
      return `<section class="series-group" data-open="${open}">
        <button class="series-head" data-act="series-toggle" data-sid="${s.sid}">
          <span class="series-name">${esc(s.series)}</span>
          <span class="series-count">${done}/${total}</span>
          <span class="series-caret" aria-hidden="true">&#8250;</span>
        </button>
        <div class="series-books">${books.map(b=>bookRowHtml(s,b)).join('')}</div>
      </section>`;
    }).join('') : '<div class="empty-row">No series yet. Tap + to add one.</div>';
  } else {
    const singles=S.findSeries('Standalone');
    const books=singles?singles.books.filter(b=>passesFilter(singles,b)):[];
    body = books.length ? `<div class="singles-grid">${books.map(b=>`
      <button class="singlecard" data-act="open" data-id="${b.id}">
        ${coverHtml(b.id,S.displayTitle(b))}
        <div class="singlecard-body">
          <div class="book-title">${esc(S.displayTitle(b))}</div>
          <div class="book-sub">${esc(S.authorOf(singles,b))}</div>
        </div>
      </button>`).join('')}</div>` : '<div class="empty-row">No standalone books yet.</div>';
  }

  return `<div class="lib">
    <div class="chips">${chips}</div>
    ${subbar}
    ${seg}
    ${body}
  </div>`;
}

// ================= STATS =================
function renderStats(){
  const st=S.computeStats();
  const years=Object.keys(st.byYear).sort().slice(-6);
  const max=Math.max(1,...years.map(y=>st.byYear[y]));
  const bars=years.map(y=>`<div class="col"><i style="height:${Math.max(4,100*st.byYear[y]/max)}%"></i><span>${y.slice(2)}</span></div>`).join('');
  const topAuthors=Object.entries(st.authors).sort((a,b)=>b[1]-a[1]).slice(0,5);
  return `<div class="dash">
    <div class="statgrid">
      <div class="statcard"><b>${st.read}</b><span>Books finished</span></div>
      <div class="statcard"><b>${st.avg?st.avg.toFixed(1):'–'}</b><span>Average rating</span></div>
      <div class="statcard"><b>${st.pages.toLocaleString()}</b><span>Pages read</span></div>
      <div class="statcard"><b>${st.rereads}</b><span>Rereads</span></div>
    </div>
    <section class="dash-section">
      <div class="sec-head"><h2>Finished per year</h2></div>
      ${years.length?`<div class="barchart">${bars}</div>`:'<div class="empty-row">Mark a few books finished to see this.</div>'}
    </section>
    <section class="dash-section">
      <div class="sec-head"><h2>Most-read authors</h2></div>
      <div class="toplist">${topAuthors.length?topAuthors.map(([a,n])=>`<div class="toplist-row"><span>${esc(a)}</span><span>${n}</span></div>`).join(''):'<div class="empty-row">No finished books with an author yet.</div>'}</div>
    </section>
  </div>`;
}

// ================= SETTINGS =================
function renderSettings(){
  const theme=getTheme();
  const goal=S.getGoal();
  const devices=Object.entries((S.meta.devices)||{}).sort((a,b)=>(b[1].lastSyncAt||0)-(a[1].lastSyncAt||0));
  const connected=Sync.isConnected();
  return `<div class="dash">
    <div class="setgroup">
      <h3>Appearance</h3>
      <div class="themepick">
        <button class="themeopt" data-act="theme-pick" data-theme="library" aria-pressed="${String(theme==='library')}">
          <div class="swatch" style="background:linear-gradient(135deg,#f5ead6,#833a2c)"></div>Library</button>
        <button class="themeopt" data-act="theme-pick" data-theme="lcars" aria-pressed="${String(theme==='lcars')}">
          <div class="swatch" style="background:linear-gradient(135deg,#000,#ff9c5a)"></div>LCARS</button>
      </div>
    </div>

    <div class="setgroup">
      <h3>Reading goal</h3>
      ${goal?`<div class="setrow"><span>${goal.target} books in ${goal.year}</span><button class="btn ghost sm" data-act="goal-open">Edit</button></div>
        <div class="setrow"><span></span><button class="iconlink" data-act="goal-clear">Clear goal</button></div>`
        :`<div class="setrow"><span>No goal set</span><button class="btn ghost sm" data-act="goal-open">Set goal</button></div>`}
    </div>

    <div class="setgroup">
      <h3>Reminders</h3>
      <div class="setrow"><span>${S.allReminders().length} reminder${S.allReminders().length===1?'':'s'}</span>
        <button class="btn ghost sm" data-act="reminders-open">Manage</button></div>
    </div>

    <div class="setgroup">
      <h3>Sync across devices</h3>
      ${connected?`
        <div class="setrow"><span>Status</span><span>${esc(Sync.syncMsg||(Sync.dirty?'Unsynced changes':'Connected'))}</span></div>
        <div class="setrow"><span>Last synced</span><span>${S.relTime(Sync.lastSyncAt)}</span></div>
        <div class="field"><label for="devName">This device's name</label><input id="devName" value="${esc(Sync.devName)}" data-act="devname-input"></div>
        ${devices.length?`<h3 style="margin-top:12px">Devices</h3>${devices.map(([id,dv])=>`
          <div class="setrow"><span>${esc(dv.name)}${id===Sync.DEV_ID?' (this device)':''} &middot; ${S.relTime(dv.lastSyncAt)}</span>
          ${id!==Sync.DEV_ID?`<button class="iconlink" data-act="device-remove" data-devid="${id}">Remove</button>`:''}</div>`).join('')}`:''}
        <div class="btnrow">
          <button class="btn ghost sm" data-act="sync-now">Sync now</button>
          <button class="btn ghost sm" data-act="sync-reconnect">Reconnect to shared copy</button>
          <button class="btn danger sm" data-act="sync-disconnect">Disconnect</button>
        </div>
      `:`
        <div class="sub" style="margin:0 0 10px">Paste a GitHub personal access token with the <b>gist</b> scope to sync your library between devices.</div>
        <div class="field"><input id="tokenInput" placeholder="ghp_&hellip;" autocomplete="off"></div>
        <button class="btn primary" data-act="sync-connect">Connect</button>
      `}
    </div>

    <div class="setgroup">
      <h3>Library tools</h3>
      <div class="btnrow">
        <button class="btn ghost sm" data-act="merge-dupes">Merge duplicate series</button>
      </div>
    </div>

    <div class="setgroup">
      <h3>Import / export</h3>
      <div class="btnrow">
        <button class="btn ghost sm" data-act="export-txt">Export .txt</button>
        <button class="btn ghost sm" data-act="export-md">Export .md</button>
        <button class="btn ghost sm" data-act="export-csv">Export .csv</button>
      </div>
      <div class="btnrow">
        <button class="btn ghost sm" data-act="backup-save">Save backup</button>
        <button class="btn ghost sm" data-act="backup-load">Load backup</button>
      </div>
    </div>

    <div class="setgroup">
      <h3>About</h3>
      <div class="setrow"><span>Status colors</span><span></span></div>
      <div class="setrow"><span><span class="statusdot" style="--dot:var(--dot-unread)"></span> Unread</span><span></span></div>
      <div class="setrow"><span><span class="statusdot" style="--dot:var(--dot-reading)"></span> Reading</span><span></span></div>
      <div class="setrow"><span><span class="statusdot" style="--dot:var(--dot-read)"></span> Read</span><span></span></div>
      <div class="setrow"><span><span class="statusdot" style="--dot:var(--dot-dnf)"></span> Set aside</span><span></span></div>
    </div>
  </div>`;
}

// ================= BOOK DETAIL MODAL =================
function detailHtml(id){
  const found=S.bookById(id); if(!found) return '<p>This book was removed.</p>';
  const {s,b}=found; const d=S.det(id); const st=S.statusOf(id); const r=S.ratings[id]||0;
  const subParts=[]; if(s.series!=='Standalone'){ subParts.push(s.series+(b.num?' #'+b.num:'')); if(S.authorOf(s,b)) subParts.push(S.authorOf(s,b)); }
  else subParts.push(S.authorOf(s,b)||'Standalone');

  const pal=(getTheme()==='lcars'?LCARS_COLORS:LIB_COLORS);
  const swatches=pal.map(c=>`<button data-act="color-set" data-hex="${c}" style="background:${c};width:26px;height:26px;border-radius:50%;margin:3px;border:2px solid ${d.color===c?'var(--text)':'transparent'}"></button>`).join('');

  const notesHtml=S.notesFor(id).map(n=>`
    <div class="note-item">
      <div class="note-meta"><span>${S.fmtDateTime(n.at)}${n.editedAt?' (edited)':''}</span></div>
      <div class="note-text">${esc(n.text)}</div>
      <div class="note-actions">
        <button data-act="note-delete" data-nid="${n.nid}">Delete</button>
      </div>
    </div>`).join('') || '<div class="empty-row">No notes yet.</div>';

  const reminders=S.remindersFor(id).filter(r=>!r.done);
  const remindersHtml=reminders.map(r=>`
    <div class="reminder-item${r.at<=Date.now()?' due':''}">
      <span class="reminder-when">${S.fmtDateTime(r.at)}${r.note?' &mdash; '+esc(r.note):''}</span>
      <button class="btn ghost sm" data-act="reminder-done" data-rid="${r.rid}">Done</button>
      <button class="btn ghost sm" data-act="reminder-delete" data-rid="${r.rid}">Cancel</button>
    </div>`).join('');

  const reads=d.reads||[];
  const readsHtml = reads.length ? reads.map((x,i)=>`<div class="kv"><span>Read ${i+1}</span><span>${S.fmtDate(x.started)||'?'} &rarr; ${S.fmtDate(x.finished)||'?'}</span></div>`).join('') : '';

  return `
    <div class="detail-head">
      ${coverHtml(id,S.displayTitle(b))}
      <div>
        <div class="detail-title">${esc(S.displayTitle(b))}</div>
        <div class="detail-sub">${esc(subParts.join(' · '))}</div>
      </div>
    </div>

    <div class="statusrow" role="group" aria-label="Status">
      ${S.ORDER.map(k=>`<button class="statuspill" data-st="${k}" data-act="status-set" data-id="${id}" aria-pressed="${String(st===k)}">${S.ST_LABEL[k]}</button>`).join('')}
    </div>

    <div class="stars" role="group" aria-label="Your rating">
      ${[1,2,3,4,5].map(i=>`<button data-act="rating-set" data-id="${id}" data-n="${i}" class="${i<=r?'on':''}" aria-label="${i} star">&#9733;</button>`).join('')}
    </div>

    <div class="detail-section">
      <h4>Format</h4>
      <div class="segtoggle">
        <button data-act="fmt-set" data-id="${id}" data-fmt="book" aria-pressed="${String(!d.fmt)}">Book</button>
        <button data-act="fmt-set" data-id="${id}" data-fmt="audio" aria-pressed="${String(d.fmt==='audio')}">Audiobook</button>
        <button data-act="fmt-set" data-id="${id}" data-fmt="manga" aria-pressed="${String(d.fmt==='manga')}">Manga</button>
      </div>
    </div>

    <div class="detail-section">
      <h4>Progress</h4>
      <div class="progress-edit">
        <input type="number" min="0" placeholder="Current" value="${d.pcur||''}" data-act="pcur-input" data-id="${id}">
        <span>/</span>
        <input type="number" min="0" placeholder="Total" value="${d.ptot||''}" data-act="ptot-input" data-id="${id}">
        <span>${d.fmt==='audio'?'chapters':'pages'}</span>
      </div>
    </div>

    <div class="detail-section">
      <h4>Dates</h4>
      <div class="kv"><span>Started</span><span>${S.fmtDate(d.started)||'–'}</span></div>
      <div class="kv"><span>Finished</span><span>${S.fmtDate(d.finished)||'–'}</span></div>
      ${readsHtml}
      ${st==='read'?`<div class="btnrow"><button class="btn ghost sm" data-act="reread" data-id="${id}">Start a reread</button></div>`:''}
    </div>

    <div class="detail-section">
      <h4>Cover color</h4>
      <div>${swatches}<button class="btn ghost sm" data-act="color-clear" data-id="${id}" style="margin-left:8px">Auto</button></div>
    </div>

    <div class="detail-section">
      <h4>Reminders</h4>
      ${remindersHtml}
      <form data-act="reminder-save" data-id="${id}" class="field" style="margin-top:8px">
        <div class="row2">
          <input type="datetime-local" name="when" required>
          <input type="text" name="note" placeholder="Note (optional)">
        </div>
        <button class="btn ghost sm" type="submit" style="margin-top:8px">Remind me</button>
      </form>
    </div>

    <div class="detail-section">
      <h4>Notes</h4>
      ${notesHtml}
      <form data-act="note-add" data-id="${id}" class="field" style="margin-top:8px">
        <textarea name="text" placeholder="Jot something down about this book&hellip;"></textarea>
        <button class="btn ghost sm" type="submit" style="margin-top:8px">Add note</button>
      </form>
    </div>

    <div class="detail-section">
      <h4>Manage</h4>
      <div class="btnrow">
        <button class="btn ghost sm" data-act="rename-open" data-id="${id}">Rename / edit</button>
        <button class="btn ghost sm" data-act="${d.next?'next-off':'next-on'}" data-id="${id}">${d.next?'Remove from Up Next':'Add to Up Next'}</button>
      </div>
      <div class="btnrow">
        <button class="btn danger sm" data-act="delete-book" data-id="${id}">Delete book</button>
      </div>
    </div>
  `;
}
function openDetail(id){
  showModal(detailHtml(id),{
    onAction:(t,e,m)=>{
      const act=t.dataset.act, bid=t.dataset.id;
      if(act==='status-set'){ S.applyStatus(bid,t.dataset.st); rerenderDetail(bid); }
      else if(act==='rating-set'){ S.setRating(bid,+t.dataset.n); rerenderDetail(bid); }
      else if(act==='fmt-set'){ S.setFormat(bid, t.dataset.fmt==='book'?'':t.dataset.fmt); rerenderDetail(bid); }
      else if(act==='pcur-input'){ S.setPages(bid,'pcur',t.value); rerenderDashboardOnly(); }
      else if(act==='ptot-input'){ S.setPages(bid,'ptot',t.value); }
      else if(act==='reread'){ S.startReread(bid); rerenderDetail(bid); toast('Started a reread ✓'); }
      else if(act==='color-set'){ S.setColor(bid,t.dataset.hex); rerenderDetail(bid); }
      else if(act==='color-clear'){ S.setColor(bid,''); rerenderDetail(bid); }
      else if(act==='next-on'){ S.toggleNext(bid); rerenderDetail(bid); }
      else if(act==='next-off'){ S.toggleNext(bid); rerenderDetail(bid); }
      else if(act==='note-add'){ const ta=t.querySelector('[name="text"]'); if(S.addNote(bid,ta.value)){ rerenderDetail(bid); toast('Note added'); } }
      else if(act==='note-delete'){ S.deleteNote(t.dataset.nid); rerenderDetail(bid||currentDetailId); }
      else if(act==='reminder-save'){
        const when=t.querySelector('[name="when"]').value; const note=t.querySelector('[name="note"]').value;
        if(when){ ensureNotifyPermission(); S.addReminder({bookId:bid,title:'',at:new Date(when).getTime(),note});
          rerenderDetail(bid); toast('Reminder set'); }
      }
      else if(act==='reminder-done'){ S.completeReminder(t.dataset.rid); rerenderDetail(currentDetailId); }
      else if(act==='reminder-delete'){ S.deleteReminder(t.dataset.rid); rerenderDetail(currentDetailId); }
      else if(act==='rename-open'){ openRename(bid); }
      else if(act==='delete-book'){
        const found=S.bookById(bid); if(!found) return;
        if(confirm('Delete "'+S.displayTitle(found.b)+'"? This can’t be undone.')){
          S.removeBook(found.s.series,found.b); closeModal(); refreshView(); toast('Deleted.');
        }
      }
    }
  });
  currentDetailId=id;
}
let currentDetailId=null;
function rerenderDetail(id){ if(!modalCtx) return;
  modalCtx.m.querySelector('.modal-body').innerHTML=detailHtml(id);
  refreshView();
}
function rerenderDashboardOnly(){ if(currentView==='dashboard') renderView(); }

function openRename(id){
  const found=S.bookById(id); if(!found) return;
  const {s,b}=found; const standalone=s.series==='Standalone';
  showModal(`
    <h3>Edit book</h3>
    <form data-act="rename-save" data-id="${id}">
      <div class="field"><label>Title</label><input name="title" value="${esc(b.title||'')}" required autofocus></div>
      ${standalone?`<div class="field"><label>Author</label><input name="author" value="${esc(b.author||'')}"></div>`
        :`<div class="field"><label>Number</label><input name="num" value="${esc(b.num||'')}"></div>`}
      <div class="field"><label>Series name</label><input name="series" value="${esc(s.series)}" ${standalone?'disabled':''}></div>
      <div class="btnrow"><button type="button" class="btn ghost" data-act="rename-cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div>
    </form>
  `,{onAction:(t,e,m)=>{
    if(t.dataset.act==='rename-cancel'){ openDetail(id); return; }
    if(t.dataset.act==='rename-save'){
      const f=m.querySelector('form');
      const title=f.title.value, num=standalone?'':f.num.value, author=standalone?f.author.value:'';
      S.renameBook(s.series,b,num,title,author);
      if(!standalone && f.series.value.trim() && f.series.value.trim()!==s.series) S.saveSeriesEdit(s.series,f.series.value,s.author);
      openDetail(id); refreshView(); toast('Saved ✓');
    }
  }});
}

// ================= ADD MODAL =================
let addTab='quick';
function addModalHtml(){
  const seriesNames=S.catalog.series.filter(x=>x.series!=='Standalone').map(x=>x.series);
  const datalist=`<datalist id="seriesList">${seriesNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
  const tabs=`<div class="modtabs">
    <button data-act="add-tab" data-tab="quick" aria-pressed="${String(addTab==='quick')}">Quick add</button>
    <button data-act="add-tab" data-tab="paste" aria-pressed="${String(addTab==='paste')}">Paste list</button>
    <button data-act="add-tab" data-tab="import" aria-pressed="${String(addTab==='import')}">Import file</button>
  </div>`;
  let body='';
  if(addTab==='quick'){
    body=`<form data-act="quick-submit">
      <div class="field"><label>Title</label><input name="title" required autofocus placeholder="The Name of the Wind"></div>
      <div class="row2">
        <div class="field"><label>Series (optional)</label><input name="series" list="seriesList" placeholder="Leave blank for a standalone"></div>
        <div class="field"><label>#</label><input name="num" placeholder="1"></div>
      </div>
      <div class="field"><label>Author</label><input name="author" placeholder="Patrick Rothfuss"></div>
      <div class="field"><label>Format</label>
        <div class="segtoggle">
          <button type="button" data-act="quick-fmt" data-fmt="book" aria-pressed="true">Book</button>
          <button type="button" data-act="quick-fmt" data-fmt="audio" aria-pressed="false">Audiobook</button>
          <button type="button" data-act="quick-fmt" data-fmt="manga" aria-pressed="false">Manga</button>
        </div>
      </div>
      <div class="field"><label>Status</label>
        <div class="segtoggle">
          <button type="button" data-act="quick-status" data-status="unread" aria-pressed="true">Unread</button>
          <button type="button" data-act="quick-status" data-status="reading" aria-pressed="false">Reading</button>
          <button type="button" data-act="quick-status" data-status="read" aria-pressed="false">Read</button>
        </div>
      </div>
      <input type="hidden" name="fmt" value="book"><input type="hidden" name="status" value="unread">
      <div class="btnrow"><button type="button" class="btn ghost" data-act="close">Close</button><button type="submit" class="btn primary">Add book</button></div>
    </form>${datalist}`;
  } else if(addTab==='paste'){
    body=`<form data-act="paste-submit">
      <div class="field"><label>Series</label><input name="series" list="seriesList" placeholder="New or existing series name" required></div>
      <div class="field"><label>One book per line</label>
        <textarea name="text" rows="6" placeholder="1. First Book&#10;2. Second Book&#10;2.5. A Novella"></textarea></div>
      <div class="btnrow"><button type="button" class="btn ghost" data-act="close">Close</button><button type="submit" class="btn primary">Add list</button></div>
    </form>${datalist}`;
  } else {
    body=`<p class="sub">Bring in a Goodreads or StoryGraph CSV export, or a .txt list exported from this app. Existing books are skipped.</p>
      <div class="btnrow"><button class="btn primary" data-act="import-choose">Choose file&hellip;</button></div>
      <div class="btnrow"><button class="btn ghost" data-act="close">Close</button></div>`;
  }
  return `<h3>Add to your library</h3>${tabs}${body}`;
}
function openAddModal(){
  showModal(addModalHtml(),{
    onAction:(t,e,m)=>{
      const act=t.dataset.act;
      if(act==='close'){ closeModal(); return; }
      if(act==='add-tab'){ addTab=t.dataset.tab; openAddModal(); return; }
      if(act==='quick-fmt'){ setPressed(m,'[data-act="quick-fmt"]',t); m.querySelector('[name="fmt"]').value=t.dataset.fmt; return; }
      if(act==='quick-status'){ setPressed(m,'[data-act="quick-status"]',t); m.querySelector('[name="status"]').value=t.dataset.status; return; }
      if(act==='quick-submit'){
        const f=m.querySelector('form');
        const entry=S.addBook({series:f.series.value,num:f.num.value,title:f.title.value,author:f.author.value,fmt:f.fmt.value,status:f.status.value});
        if(entry){ toast('Added “'+S.displayTitle(entry)+'” ✓'); refreshView();
          f.title.value=''; f.num.value=''; f.author.value=''; f.title.focus(); }
        return;
      }
      if(act==='paste-submit'){
        const f=m.querySelector('form');
        const sn=f.series.value.trim(); if(!sn) return;
        if(!S.findSeries(sn)) S.addSeries(sn,'');
        const res=S.addList(sn,f.text.value);
        toast((res.added||0)+' book'+(res.added===1?'':'s')+' added.'); refreshView(); closeModal();
        return;
      }
      if(act==='import-choose'){ document.getElementById('impfile').click(); return; }
    }
  });
}
function setPressed(scope,sel,active){ $all(sel,scope).forEach(b=>b.setAttribute('aria-pressed', String(b===active))); }

// ================= REMINDERS MODAL =================
function remindersModalHtml(){
  const due=S.dueReminders(), upcoming=S.upcomingReminders();
  const row=r=>{ const b=r.bookId?S.bookById(r.bookId):null;
    const label = b?S.displayTitle(b.b):(r.title||'Reminder');
    return `<div class="reminder-item${r.at<=Date.now()?' due':''}">
      <span class="reminder-when">${esc(label)} &middot; ${S.fmtDateTime(r.at)}${r.note?' &mdash; '+esc(r.note):''}</span>
      ${b?`<button class="btn ghost sm" data-act="open-book" data-id="${b.b.id}">Open</button>`:''}
      <button class="btn ghost sm" data-act="rem-done" data-rid="${r.rid}">Done</button>
      <button class="btn ghost sm" data-act="rem-del" data-rid="${r.rid}">Delete</button>
    </div>`; };
  return `<h3>Reminders</h3>
    <div class="detail-section"><h4>Due</h4>${due.length?due.map(row).join(''):'<div class="empty-row">Nothing due.</div>'}</div>
    <div class="detail-section"><h4>Upcoming</h4>${upcoming.length?upcoming.map(row).join(''):'<div class="empty-row">Nothing scheduled.</div>'}</div>
    <div class="btnrow"><button class="btn ghost" data-act="close">Close</button></div>`;
}
function openReminders(){
  showModal(remindersModalHtml(),{onAction:(t)=>{
    const act=t.dataset.act;
    if(act==='close') closeModal();
    else if(act==='open-book'){ openDetail(t.dataset.id); }
    else if(act==='rem-done'){ S.completeReminder(t.dataset.rid); openReminders(); }
    else if(act==='rem-del'){ S.deleteReminder(t.dataset.rid); openReminders(); }
  }});
}
function ensureNotifyPermission(){
  if('Notification' in window && Notification.permission==='default'){ Notification.requestPermission().catch(()=>{}); }
}

// ================= GOAL MODAL =================
function openGoalModal(){
  const goal=S.getGoal();
  showModal(`<h3>Reading goal</h3>
    <form data-act="goal-save">
      <div class="field"><label>Books to finish in ${new Date().getFullYear()}</label>
        <input type="number" min="1" name="target" value="${goal?goal.target:''}" autofocus></div>
      <div class="btnrow"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="submit" class="btn primary">Save</button></div>
    </form>`,{onAction:(t,e,m)=>{
      if(t.dataset.act==='close') closeModal();
      if(t.dataset.act==='goal-save'){ const v=m.querySelector('[name="target"]').value; S.setGoalTarget(v); closeModal(); refreshView(); }
    }});
}

// ================= EVENT WIRING =================
document.getElementById('btnAdd').addEventListener('click',openAddModal);
$all('.tab').forEach(t=>t.addEventListener('click',()=>setView(t.dataset.view)));
document.getElementById('btnSettingsTop').addEventListener('click',()=>setView('settings'));
document.getElementById('btnSearch').addEventListener('click',()=>{
  const bar=document.getElementById('searchbar'); const willShow=bar.classList.contains('hidden');
  bar.classList.toggle('hidden'); document.getElementById('btnSearch').setAttribute('aria-expanded',String(willShow));
  if(willShow){ document.getElementById('q').focus(); if(currentView!=='library') setView('library'); }
  else { searchQuery=''; document.getElementById('q').value=''; refreshView(); }
});
document.getElementById('q').addEventListener('input',e=>{ searchQuery=e.target.value.trim(); refreshView(); });

document.getElementById('view').addEventListener('click',e=>{
  const t=e.target.closest('[data-act]'); if(!t) return;
  const act=t.dataset.act, id=t.dataset.id;
  if(act==='open') openDetail(id);
  else if(act==='step'){ const d=S.det(id); const next=Math.max(0,(d.pcur||0)+(+t.dataset.delta)); S.setPages(id,'pcur',next); refreshView(); }
  else if(act==='finish'){ S.markRead(id); refreshView(); toast('Marked finished ✓'); }
  else if(act==='reminders-open') openReminders();
  else if(act==='goal-open') openGoalModal();
  else if(act==='filter'){ statusFilter=t.dataset.filter; refreshView(); }
  else if(act==='seg'){ libTab=t.dataset.tab; refreshView(); }
  else if(act==='series-toggle'){ const sid=t.dataset.sid; openSeries.has(sid)?openSeries.delete(sid):openSeries.add(sid); refreshView(); }
  else if(act==='surprise'){ const pick=S.surprise(); pick?openDetail(pick.b.id):toast('Nothing unread to surprise you with.'); }
  else if(act==='theme-pick'){ setTheme(t.dataset.theme); }
  else if(act==='goal-clear'){ S.clearGoal(); refreshView(); }
  else if(act==='merge-dupes'){ const n=S.mergeDuplicatesNow(); toast(n?('Merged '+n+' duplicate series.'):'No duplicates found.'); refreshView(); }
  else if(act==='export-txt'){ downloadFile('reading-desk.txt',S.exportTxt(),'text/plain'); }
  else if(act==='export-md'){ downloadFile('reading-desk.md',S.exportMarkdown(),'text/markdown'); }
  else if(act==='export-csv'){ downloadFile('reading-desk.csv',S.exportCSV(),'text/csv'); }
  else if(act==='backup-save'){ downloadFile('reading-desk-backup.json',JSON.stringify(S.backupPayload(),null,1),'application/json'); S.noteBackup(); toast('Backup saved.'); }
  else if(act==='backup-load'){ document.getElementById('file').click(); }
  else if(act==='sync-now'){ Sync.syncNow(true); }
  else if(act==='sync-disconnect'){ Sync.disconnectSync(); refreshView(); toast('Sync disconnected on this device.'); }
  else if(act==='sync-reconnect'){ Sync.reconnectSharedGist(); }
  else if(act==='sync-connect'){
    const inp=document.getElementById('tokenInput'); const res=Sync.connectToken(inp.value);
    if(res.warn) toast(res.warn); refreshView();
  }
  else if(act==='device-remove'){
    const r=Sync.removeDevice(t.dataset.devid); refreshView();
    if(r) toast('Removed “'+r.name+'”.','Undo',r.undo);
  }
});
document.getElementById('view').addEventListener('change',e=>{
  const t=e.target.closest('[data-act]'); if(!t) return;
  if(t.dataset.act==='fmt-filter'){ fmtFilter=t.value; refreshView(); }
  else if(t.dataset.act==='rating-filter'){ ratingFilter=t.value; refreshView(); }
  else if(t.dataset.act==='devname-input'){ Sync.setDevName(t.value); }
});

document.getElementById('file').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return; const fr=new FileReader();
  fr.onload=()=>{ try{ const p=JSON.parse(fr.result); const res=S.restoreBackup(p);
      if(res.mode==='full'){ refreshView(); toast('Backup loaded ✓'); }
      else if(res.mode==='progress'){ refreshView(); toast('Recovered progress for '+res.hits+' of '+res.total+' books.'); }
      else if(res.mode==='legacy'){ refreshView(); toast('Backup loaded ✓'); }
      else toast('That file is not a valid backup.');
    } catch(err){ toast('That file is not a valid backup.'); } };
  fr.readAsText(f); e.target.value='';
});
document.getElementById('impfile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return; const fr=new FileReader();
  fr.onload=()=>{ const text=String(fr.result);
    const res = /\.csv$/i.test(f.name) ? S.importCSV(text) : S.importTxt(text);
    if(res.error) toast(res.error);
    else toast((res.added||0)+' book'+(res.added===1?'':'s')+' imported'+(res.skipped?' ('+res.skipped+' already here)':'')+'.');
    refreshView(); closeModal();
  };
  fr.readAsText(f); e.target.value='';
});

function downloadFile(name,text,type){
  const blob=new Blob([text],{type}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
}

// ================= reminder polling =================
function checkReminders(){
  const due=S.dueReminders();
  due.forEach(r=>{
    if(!r.notifiedAt){
      if('Notification' in window && Notification.permission==='granted'){
        const b=r.bookId?S.bookById(r.bookId):null;
        const label=b?S.displayTitle(b.b):(r.title||'Reading Desk');
        try{ new Notification('Reading reminder', {body:label+(r.note?' — '+r.note:''), tag:r.rid}); }catch(e){}
      }
      S.markNotified(r.rid);
    }
  });
  if(due.length && currentView==='dashboard') refreshView();
}
setInterval(checkReminders,60000);

// ================= boot =================
S.onSave(()=> refreshView());
Sync.onSyncChange(()=> refreshView());
renderView();
checkReminders();
if(S.backupDue()){ setTimeout(()=>toast('It has been a while since you saved a backup.','Save one',()=>{
  setView('settings'); document.getElementById('view').querySelector('[data-act="backup-save"]')?.click(); }),1500); }
