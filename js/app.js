// app.js — rendering, modals, event wiring. Uses store.js for all data and
// sync.js for the Gist sync. Views are rendered as HTML strings (with every
// user-supplied string run through esc()) and wired via delegated click /
// change / submit listeners that read data-act attributes, rather than a
// vdom — the library is small enough that re-rendering a whole view on
// every change is cheap and keeps this file easy to follow.
import * as S from './store.js';
import * as Sync from './sync.js';
import * as Covers from './covers.js';
import * as Discover from './discover.js';

// bump alongside the CACHE version in sw.js — shown in Settings so you can
// confirm a device actually picked up a new deploy after refreshing
const APP_VERSION='v78';

S.load();

// ---------- tiny DOM/string helpers ----------
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(sel,root){ return (root||document).querySelector(sel); }
function $all(sel,root){ return Array.from((root||document).querySelectorAll(sel)); }

// ---------- theme ----------
function getTheme(){ const t=localStorage.getItem(S.K_THEME); return t==='cyberpunk'?'cyberpunk':'library'; }
function setTheme(t){
  t=t==='cyberpunk'?'cyberpunk':'library';
  const changed = t!==getTheme();
  try{localStorage.setItem(S.K_THEME,t);}catch(e){}
  document.documentElement.setAttribute('data-theme',t);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t==='cyberpunk'?'#04060a':'#f5ead6');
  if(changed){
    const fl=document.getElementById('modeflash');
    if(fl){
      fl.className='modeflash '+(t==='cyberpunk'?'boot-in':'boot-out');
      const dur = t==='cyberpunk'?560:360;
      clearTimeout(fl._t); fl._t=setTimeout(()=>{ fl.className='modeflash'; },dur);
    }
  }
  refreshView();
}
document.documentElement.setAttribute('data-theme',getTheme());
document.querySelector('meta[name="theme-color"]').setAttribute('content', getTheme()==='cyberpunk'?'#04060a':'#f5ead6');
function isCyberpunkTheme(){ return getTheme()==='cyberpunk'; }

// ---------- procedural cover-art engine ----------
// Ported from the single-file app: every book gets a deterministic "cover" —
// a family color (by series), a per-book shade variant, an ornament glyph,
// a scattering of translucent shapes, and (at large size) a framed title/
// author. Library reuses the old warm-cloth palette; Cyberpunk reuses the
// old night-mode neon palette (dark=hot/saturated, light=dim/quiet) almost
// verbatim, since it already reads as a "console readout" aesthetic.
const FAMILIES=[
  {dark:'#5a2321',light:'#c7a199'},{dark:'#234a2f',light:'#a6c1a8'},{dark:'#22314f',light:'#a3b1cb'},
  {dark:'#1f4a48',light:'#a1c2bf'},{dark:'#6a5212',light:'#d8c78c'},{dark:'#3f2340',light:'#bda3bd'},
  {dark:'#4a1f2b',light:'#c39aa4'},{dark:'#6b4a1c',light:'#d5bd93'},{dark:'#33384a',light:'#b1b6c4'},
  {dark:'#2f2140',light:'#b0a3c4'},{dark:'#6b3320',light:'#d3a893'},{dark:'#3b4a34',light:'#b6c2a7'},
  {dark:'#26333a',light:'#a7b6bd'},{dark:'#43291d',light:'#c6ab97'},{dark:'#242530',light:'#b7bac6'}];
const ACCENTS=['#8a3b2f','#4d6b3c','#2e3b57','#b0841a','#5a2f45','#26414a','#7a3320','#3f5148'];
const ORN=['❦','❧','✦','◆','⁂','❈','✣','☙'];
const NIGHT_FAMILIES=[
  {dark:'#17e0ff',light:'#0a6b78'},{dark:'#ff2bd6',light:'#7a1a68'},{dark:'#a742ff',light:'#55208a'},
  {dark:'#33ff9c',light:'#157a4c'},{dark:'#ffb02e',light:'#8a5c12'},{dark:'#ff3b5c',light:'#85172c'},
  {dark:'#2b6bff',light:'#163a85'},{dark:'#ff5cc9',light:'#852966'},{dark:'#1ee0b8',light:'#0d6f5a'},
  {dark:'#c8ff2e',light:'#647d14'},{dark:'#6b5bff',light:'#362c85'},{dark:'#4fd8ff',light:'#256b85'},
  {dark:'#ff5b9c',light:'#85304f'},{dark:'#58ffcf',light:'#2c8567'},{dark:'#ffe14f',light:'#857517'}];
const NIGHT_ACCENTS=['#2de7ff','#ff2bd6','#a742ff','#33ff9c','#ffb02e','#ff3b5c','#4fd8ff','#c8ff2e'];
const NIGHT_ORN=['◈','◆','▲','⬡','✦','◇','◉','⌘'];

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function hexToHsl(hex){ let r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let h,s,l=(mx+mn)/2;
  if(mx===mn){ h=0;s=0; } else { const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    h = mx===r ? (g-b)/d+(g<b?6:0) : mx===g ? (b-r)/d+2 : (r-g)/d+4; h*=60; }
  return {h, s:s*100, l:l*100}; }
function hslToHex(h,s,l){ s/=100; l/=100; const k=n=>(n+h/30)%12; const a=s*Math.min(l,1-l);
  const f=n=>{ const c=l-a*Math.max(-1,Math.min(k(n)-3, Math.min(9-k(n),1))); return Math.round(255*c); };
  const to=x=>x.toString(16).padStart(2,'0'); return '#'+to(f(0))+to(f(8))+to(f(4)); }

// seed key: series name for series books, the book's own title for standalones
function seedOf(seriesName,title,standalone){ return standalone ? title : seriesName; }
function famFor(seed){ const list=isCyberpunkTheme()?NIGHT_FAMILIES:FAMILIES; return list[S.hashStr(seed)%list.length]; }
function isLightSeed(seed){ return (S.hashStr(seed+'lite')%100)<26; }
function seriesBase(seed){ return isLightSeed(seed)?famFor(seed).light:famFor(seed).dark; }
function hasBand(seed){ return (S.hashStr(seed+'band')%100)<64; }
function bandIsFoil(seed){ return (S.hashStr(seed+'bandfoil')%2)===0; }
function isFoilTitle(seed){ return (S.hashStr(seed+'foil')%100)<55; }
function ornFor(seed){ const list=isCyberpunkTheme()?NIGHT_ORN:ORN; return list[S.hashStr(seed+'orn')%list.length]; }
function accentFor(author,seed){ const list=isCyberpunkTheme()?NIGHT_ACCENTS:ACCENTS; return list[S.hashStr((author||seed)+'acc')%list.length]; }
function foilColor(){ return isCyberpunkTheme()?'#2de7ff':'#c9a227'; }
function textOn(seed,light){ if(isCyberpunkTheme()) return '#eaffff'; return light?'#2a2018':'#f0e6cd'; }

// per-book shade variant inside its series' color family
function bookShade(seed,title){ const base=seriesBase(seed), c=hexToHsl(base), h=S.hashStr(title), light=isLightSeed(seed);
  if(isCyberpunkTheme()){
    const dh=((h&31)-15)*1.3, ds=(((h>>>5)&15)-7)*1.1, dl=(((h>>>9)&15)-7)*1.1;
    return hslToHex((c.h+dh+360)%360, clamp(c.s+ds, light?26:55, light?66:100), clamp(c.l+dl, light?24:40, light?54:76)); }
  const dh=((h&15)-7)*0.9, ds=(((h>>>4)&15)-7)*0.7, dl=(((h>>>8)&7)-3);
  return hslToHex((c.h+dh+360)%360, clamp(c.s+ds, light?6:12, light?42:72), clamp(c.l+dl, light?70:16, light?92:42)); }

function coverVariant(id,title,author,seed){
  const d=S.det(id);
  const override=d.color?true:false;
  const base=override?d.color:bookShade(seed,title);
  const light=override?(hexToHsl(d.color).l>58):(isLightSeed(seed));
  const acc=accentFor(author,seed), foil=foilColor();
  const text=textOn(seed,light);
  const orn=ornFor(seed);
  const band=hasBand(seed);
  const bandColor= band ? (bandIsFoil(seed)?foil:(light?'rgba(0,0,0,.26)':'rgba(0,0,0,.4)')) : 'transparent';
  const foilTitle=isFoilTitle(seed);
  const titleColor= foilTitle ? foil : text;
  return {base,light,acc,foil,text,orn,band,bandColor,titleColor};
}
// three scattered translucent shapes + a diagonal wash — deterministic per title, scaled by size
function artShapes(title,v,scale){
  const hh=S.hashStr(title+'art');
  const cols=[v.acc,v.foil,v.base];
  let out='';
  for(let k=0;k<3;k++){
    const hk=S.hashStr(title+'s'+k);
    const round=(hk%3===0), sz=Math.round((44+hk%116)*scale), x=(hk>>>4)%100, y=(hk>>>9)%100, rot=(hk>>>2)%180, op=0.16+((hk>>>7)%22)/100;
    out+='<span class="bc-shape" style="left:'+x+'%;top:'+y+'%;width:'+sz+'px;height:'+sz+'px;'+
      'transform:translate(-50%,-50%) rotate('+rot+'deg);background:'+cols[k]+';opacity:'+op+';'+
      'border-radius:'+(round?'50%':(hk%5)+'px')+'"></span>';
  }
  out+='<span class="bc-wash" style="background:linear-gradient('+(60+hh%80)+'deg,'+v.foil+'22,transparent 55%)"></span>';
  return out;
}
// size: 'lg' (dashboard continue-reading + detail modal) shows the framed title/author
// overlay; 'md' (chip/grid cards) is art-only since those cards show the title separately
function bookCoverHtml(id,title,author,seriesLabel,standalone,size){
  size=size||'md';
  const realCover=S.details[id]&&S.details[id].cover;
  if(realCover){
    return '<div class="bookcover size-'+size+' realcover"><img class="bc-photo" src="'+realCover+'" alt="Cover of '+esc(title)+'"></div>';
  }
  const seed=seedOf(seriesLabel,title,standalone);
  const v=coverVariant(id,title,author,seed);
  const scale = size==='lg' ? 1 : 0.55;
  let html='<div class="bookcover size-'+size+'" data-light="'+v.light+'" style="--bc:'+v.base+';--acc:'+v.acc+
    ';--foil:'+v.foil+';--text:'+v.text+';--ttl:'+v.titleColor+';--cap:'+v.bandColor+'">';
  html+='<span class="bc-art">'+artShapes(title,v,scale)+'</span>';
  html+='<span class="bc-edge"></span>';
  if(v.band) html+='<span class="bc-cap t"></span><span class="bc-cap b"></span>';
  if(size==='lg'){
    html+='<span class="bc-ribbon"></span>';
    html+='<span class="bc-orn">'+v.orn+'</span>';
    html+='<div class="bc-frame"><div class="bc-title">'+esc(title)+'</div>'+(author?'<div class="bc-author">'+esc(author)+'</div>':'')+'</div>';
    if(seriesLabel) html+='<div class="bc-seriescap">'+esc(seriesLabel)+'</div>';
  } else {
    html+='<span class="bc-orn sm">'+v.orn+'</span>';
  }
  html+='</div>';
  return html;
}
// compact-context wrapper: looks up the book's series/author context from its id
function bookCoverFor(id,size){
  const found=S.bookById(id); if(!found) return '<div class="bookcover size-'+( size||'md')+'"></div>';
  const {s,b}=found; const standalone=s.series==='Standalone';
  return bookCoverHtml(id,S.displayTitle(b),S.authorOf(s,b),standalone?'':s.series,standalone,size);
}

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
// the Discovery page's seed titles (multi-select — TasteDive blends several
// books into one search): null means "not customized yet, use the automatic
// pick" (top-rated or currently-reading book); once the user adds or removes
// anything it becomes a real array (possibly empty) under their own control.
// Jumping in from a book's detail via "Find similar books" sets it to that
// one book explicitly.
let discoverSeeds=null;
// the Discovery page's top-level split: 'add' (search Open Library / manual
// entry / paste / import — everywhere adding a book now starts) or
// 'similar' (the TasteDive multi-seed search). The "+" FAB and the
// "Find similar books" / "See more" entry points each force the relevant
// one; the bottom nav's own Discover tab leaves it as whatever was last used.
let discoverPageTab='add';

function setView(v){ currentView=v;
  $all('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.view===v)));
  renderView(); window.scrollTo(0,0);
}
function refreshView(){ renderView(); }
function renderView(){
  const root=document.getElementById('view');
  if(currentView==='dashboard') root.innerHTML=renderDashboard();
  else if(currentView==='library') root.innerHTML=renderLibrary();
  else if(currentView==='discover'){ root.innerHTML=renderDiscoverPage(); wireDiscoverCombo(); }
  else if(currentView==='stats') root.innerHTML=renderStats();
  else if(currentView==='settings') root.innerHTML=renderSettings();
}

// ================= DASHBOARD =================
function greeting(){ const h=new Date().getHours(); return h<5?'Still up':h<12?'Good morning':h<17?'Good afternoon':h<22?'Good evening':'Still up'; }

// Continue Reading's card order is sticky across re-renders: it's only
// recomputed (most-recently-updated first) when the *set* of currently-
// reading books changes, never on every stepper tap. Re-sorting on every
// tap made a card jump to a different position the instant you tapped it,
// so the next tap in the same spot landed on a different book.
let continueOrderIds=null;
function stableReadingOrder(){
  const reading=S.readingList();
  const curIds=reading.map(({b})=>b.id);
  const curSet=new Set(curIds);
  const sameSet = continueOrderIds && continueOrderIds.length===curIds.length && continueOrderIds.every(id=>curSet.has(id));
  if(!sameSet){
    const freshlySorted=reading.slice().sort((a,b)=>{
      const da=S.det(a.b.id), db=S.det(b.b.id);
      const pa=+da.pcurAt||0, pb=+db.pcurAt||0;
      if(pa||pb) return pb-pa;
      const sa=da.started||'', sb=db.started||'';
      if(sa&&sb) return sb.localeCompare(sa); return sa?-1:sb?1:0;
    });
    continueOrderIds=freshlySorted.map(({b})=>b.id);
    return freshlySorted;
  }
  const byId=new Map(reading.map(item=>[item.b.id,item]));
  return continueOrderIds.map(id=>byId.get(id));
}

// ---------- "Discover" row: external similar-book lookups via TasteDive ----------
// Rendering is synchronous but the fetch isn't, so a cache entry doubles as
// the loading/error/result state machine: render whatever's in the cache for
// this seed right now, kick off a fetch if there's nothing there yet, and
// let the fetch's completion trigger a refresh.
const discoverCache=new Map();
// the automatic pick for both the dashboard's Discover row and the
// Discovery page (when nothing's been searched yet) seeds strictly off
// whatever's on top of Continue Reading — not top-rated — so it always
// reads as "because you're reading X" and stays the same book in both
// places, rather than surprising you with an unrelated old favorite every
// time the app restarts and the Discovery page's in-memory search resets
function activeReadingSeedBook(){
  const ordered=stableReadingOrder();
  return ordered.length ? ordered[0] : null;
}
// shared by the dashboard's "Discover" row and the standalone Discovery page —
// both key off the same seed-set-keyed cache, so switching between them (or
// jumping in from a book's detail) never re-fetches the same seed twice.
// seedTitles is always an array now (1 item from the dashboard, 1+ from the
// Discovery page's multi-select), and the cache key reflects the whole set.
function discoverCacheKey(seedTitles){ return seedTitles.map(t=>t.toLowerCase()).join('|'); }
function discoverEntryFor(seedTitles,key,proxy){
  const cacheKey=discoverCacheKey(seedTitles);
  let entry=discoverCache.get(cacheKey);
  if(!entry){
    entry={status:'loading'};
    discoverCache.set(cacheKey,entry);
    Discover.tasteDiveSimilar(seedTitles,key,10,proxy).then(async items=>{
      const existing=new Set(S.allBooks().map(x=>S.displayTitle(x.b).toLowerCase()));
      const filtered=items.filter(it=>!existing.has(it.title.toLowerCase()));
      // TasteDive only ever gives a title (plus series/# when it's embedded in
      // the title text) — no author. Open Library search is a second, best-
      // effort lookup per result to fill that in (and a cover, and series/#
      // when TasteDive didn't have it); one failed lookup never drops the
      // result, it's just shown without an author.
      const enriched=await Promise.all(filtered.map(async it=>{
        try{
          const [match]=await Discover.openLibrarySearch(it.title,1);
          if(!match) return it;
          return {...it, author:match.author||'', series:it.series||match.series||'', num:it.num||match.num||'', coverUrl:match.coverUrl||''};
        }catch(e){ return it; }
      }));
      discoverCache.set(cacheKey,{status:'ok',items:enriched});
      if(currentView==='dashboard'||currentView==='discover') refreshView();
    }).catch(err=>{
      discoverCache.set(cacheKey,{status:'error',error:(err&&err.message)||'Something went wrong.'});
      if(currentView==='dashboard'||currentView==='discover') refreshView();
    });
  }
  return entry;
}
function discoverSectionHtml(){
  const key=S.getTasteDiveKey(), proxy=S.getTasteDiveProxy();
  if(!key || !proxy){
    return `<section class="dash-section">
      <div class="sec-head"><h2>Discover</h2></div>
      <div class="empty-row">Connect TasteDive in Settings to see books like your favorites that aren’t in your library yet.
        <button class="btn ghost sm" data-act="open-settings" style="margin-top:8px">Open Settings</button></div>
    </section>`;
  }
  const seed=activeReadingSeedBook();
  if(!seed) return '';
  const seedTitle=S.displayTitle(seed.b);
  const cacheKey=discoverCacheKey([seedTitle]);
  const entry=discoverEntryFor([seedTitle],key,proxy);
  let body;
  if(entry.status==='loading') body=`<div class="empty-row">Looking for books like <i>${esc(seedTitle)}</i>…</div>`;
  else if(entry.status==='error') body=`<div class="empty-row">${esc(entry.error)}
      <button class="btn ghost sm" data-act="discover-retry" data-seed="${esc(cacheKey)}" style="margin-top:8px">Retry</button></div>`;
  else if(!entry.items.length) body=`<div class="empty-row">No new suggestions from <i>${esc(seedTitle)}</i> right now.</div>`;
  else body=`<div class="hscroll">${entry.items.map(it=>`
      <article class="chipcard discover-card" data-act="discover-preview" data-title="${esc(it.title)}" data-series="${esc(it.series)}" data-num="${esc(it.num)}" data-author="${esc(it.author)}" data-cover="${esc(it.coverUrl)}" role="button" tabindex="0">
        <div class="chipcard-title">${esc(it.title)}</div>
        ${it.author?`<div class="chipcard-author">${esc(it.author)}</div>`:''}
        <div class="chipcard-reason">${it.series?esc(it.series+(it.num?' #'+it.num:'')):'Similar to '+esc(seedTitle)}</div>
        <button class="btn ghost sm" data-act="discover-add" data-seed="${esc(cacheKey)}" data-title="${esc(it.title)}" data-series="${esc(it.series)}" data-num="${esc(it.num)}" data-author="${esc(it.author)}" data-cover="${esc(it.coverUrl)}">+ Add</button>
      </article>`).join('')}</div>`;
  return `<section class="dash-section">
    <div class="sec-head"><h2>Discover</h2><button class="seeall" data-act="open-discover">See more &rsaquo;</button></div>
    ${body}
  </section>`;
}

// ================= DISCOVERY PAGE =================
// a dedicated page version of the dashboard's Discover row: lets you build
// up a multi-book search (TasteDive blends several seeds into one set of
// recommendations) instead of just the one automatic pick, and shares the
// same cache, so jumping here from a book's detail ("Find similar books")
// or from the dashboard's "See more" link shows results instantly if
// already fetched
function currentDiscoverSeeds(){
  if(discoverSeeds!==null) return discoverSeeds;
  const auto=activeReadingSeedBook();
  return auto ? [S.displayTitle(auto.b)] : [];
}
function addDiscoverSeed(title){
  const val=(title||'').trim(); if(!val) return;
  const base=currentDiscoverSeeds();
  if(base.some(s=>s.toLowerCase()===val.toLowerCase())){ toast('Already in your search.'); return; }
  if(base.length>=8){ toast('Up to 8 titles at once.'); return; }
  discoverSeeds=base.concat([val]);
  if(currentView==='discover') refreshView();
}
function removeDiscoverSeed(idx){
  discoverSeeds=currentDiscoverSeeds().filter((_,i)=>i!==idx);
  if(currentView==='discover') refreshView();
}
// library titles grouped for the Discovery page's seed picker: singles
// first, then each series (alphabetical), filtered live as you type —
// the seed input itself doubles as the panel's search bar
function discoverComboGroups(filterText){
  const f=(filterText||'').trim().toLowerCase();
  const matches=b=>!f || S.displayTitle(b).toLowerCase().includes(f);
  const singles=S.findSeries('Standalone');
  const singleBooks=(singles?singles.books:[]).filter(matches).slice().sort((a,b)=>S.displayTitle(a).localeCompare(S.displayTitle(b)));
  const seriesList=S.catalog.series.filter(s=>s.series!=='Standalone').slice().sort((a,b)=>a.series.localeCompare(b.series));
  const seriesGroups=seriesList.map(s=>({name:s.series,books:s.books.filter(matches)})).filter(g=>g.books.length);
  return {singleBooks,seriesGroups};
}
function discoverComboListHtml(filterText){
  const {singleBooks,seriesGroups}=discoverComboGroups(filterText);
  if(!singleBooks.length && !seriesGroups.length) return '<div class="combo-empty">No library matches &mdash; press Add to search this title anyway.</div>';
  let html='';
  if(singleBooks.length) html+='<div class="combo-group"><div class="combo-group-label">Singles</div>'+
    singleBooks.map(b=>`<button type="button" class="combo-item" data-act="combo-pick" data-title="${esc(S.displayTitle(b))}">${esc(S.displayTitle(b))}</button>`).join('')+'</div>';
  seriesGroups.forEach(g=>{ html+=`<div class="combo-group"><div class="combo-group-label">${esc(g.name)}</div>`+
    g.books.map(b=>`<button type="button" class="combo-item" data-act="combo-pick" data-title="${esc(S.displayTitle(b))}">${esc(S.displayTitle(b))}</button>`).join('')+'</div>'; });
  return html;
}
// wired by hand (not the usual delegated re-render) so typing in the seed
// input never loses focus/cursor position — only the panel's own innerHTML
// is touched on each keystroke; adding a seed still goes through the
// normal refreshView() path since that's a discrete action, not typing
function wireDiscoverCombo(){
  const input=document.getElementById('discoverSeedInput');
  const panel=document.getElementById('discoverCombo');
  if(!input || !panel) return;
  const close=()=>{ panel.hidden=true; };
  input.addEventListener('focus',()=>{ panel.innerHTML=discoverComboListHtml(''); panel.hidden=false; input.select(); });
  input.addEventListener('input',()=>{ panel.innerHTML=discoverComboListHtml(input.value); panel.hidden=false; });
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ close(); return; }
    if(e.key==='Enter'){ e.preventDefault(); close(); addDiscoverSeed(input.value); }
  });
  input.addEventListener('blur',()=>{ setTimeout(close,150); });
  panel.addEventListener('mousedown',e=>{
    const b=e.target.closest('[data-act="combo-pick"]'); if(!b) return;
    e.preventDefault();
    close();
    addDiscoverSeed(b.dataset.title);
  });
}
function renderDiscoverSimilarSection(){
  const key=S.getTasteDiveKey(), proxy=S.getTasteDiveProxy();
  const seeds=currentDiscoverSeeds();
  const chipsHtml = seeds.length ? `<div class="seedchips">${seeds.map((title,i)=>
      `<span class="seedchip">${esc(title)}<button type="button" data-act="discoverseed-remove" data-idx="${i}" aria-label="Remove ${esc(title)}">&times;</button></span>`).join('')}
      ${seeds.length>1?`<button type="button" class="seedchip seedchip-clear" data-act="discoverseeds-clear">Clear all</button>`:''}
    </div>` : '';
  const seekbar=`${chipsHtml}<div class="seekrow">
      <div class="combofield">
        <input id="discoverSeedInput" placeholder="${seeds.length?'Add another title…':'e.g. The Hobbit — or type any title'}" autocomplete="off">
        <div class="combo-panel" id="discoverCombo" hidden></div>
      </div>
      <button class="btn primary" data-act="discoverseed-add">Add</button>
    </div>`;

  if(!key || !proxy){
    return `<p class="sub" style="margin:0 0 10px">Find books similar to one or more titles &mdash; in your library or not.</p>
      <div class="empty-row">Connect TasteDive in Settings first.
        <button class="btn ghost sm" data-act="open-settings" style="margin-top:8px">Open Settings</button></div>`;
  }

  let body;
  if(!seeds.length){
    body=`<div class="empty-row">Add a title above, or start reading something to get an automatic pick.</div>`;
  } else {
    const cacheKey=discoverCacheKey(seeds);
    const seedLabel = seeds.length>1 ? seeds.length+' titles' : seeds[0];
    const entry=discoverEntryFor(seeds,key,proxy);
    if(entry.status==='loading') body=`<div class="empty-row">Looking for books like <i>${esc(seedLabel)}</i>…</div>`;
    else if(entry.status==='error') body=`<div class="empty-row">${esc(entry.error)}
        <button class="btn ghost sm" data-act="discover-retry" data-seed="${esc(cacheKey)}" style="margin-top:8px">Retry</button></div>`;
    else if(!entry.items.length) body=`<div class="empty-row">No new suggestions from <i>${esc(seedLabel)}</i> right now.</div>`;
    else body=`<div class="discover-grid">${entry.items.map(it=>`
        <article class="chipcard discover-card" data-act="discover-preview" data-title="${esc(it.title)}" data-series="${esc(it.series)}" data-num="${esc(it.num)}" data-author="${esc(it.author)}" data-cover="${esc(it.coverUrl)}" role="button" tabindex="0">
          <div class="chipcard-title">${esc(it.title)}</div>
          ${it.author?`<div class="chipcard-author">${esc(it.author)}</div>`:''}
          <div class="chipcard-reason">${it.series?esc(it.series+(it.num?' #'+it.num:'')):(seeds.length>1?'From your picks':'Similar to '+esc(seedLabel))}</div>
          <button class="btn ghost sm" data-act="discover-add" data-seed="${esc(cacheKey)}" data-title="${esc(it.title)}" data-series="${esc(it.series)}" data-num="${esc(it.num)}" data-author="${esc(it.author)}" data-cover="${esc(it.coverUrl)}">+ Add</button>
        </article>`).join('')}</div>`;
  }

  return `<p class="sub" style="margin:0 0 10px">Find books similar to one or more titles &mdash; in your library or not.</p>
    ${seekbar}
    ${body}`;
}
// the Discovery page's "Add a book" tab: search Open Library, preview
// (cover/synopsis/genres/series) before adding, or fall back to typing it
// in by hand, pasting a list, or importing a file — every way of getting a
// book into the library starts here now, not from a FAB-opened modal
function renderDiscoverAddSection(){
  return `${cartHtml()}
    <p class="sub" style="margin:0 0 10px">Search to see a book&rsquo;s cover, synopsis, genres &mdash; and its whole series, if it has one &mdash; before adding it.</p>
    ${searchAssistHtml()}
    <div class="btnrow" style="margin-top:4px">
      <button class="btn ghost sm" data-act="manual-add-open">Add manually</button>
      <button class="btn ghost sm" data-act="paste-list-open">Paste a list</button>
      <button class="btn ghost sm" data-act="import-file-open">Import a file</button>
    </div>`;
}
function renderDiscoverPage(){
  const tabsHtml=`<div class="modtabs">
    <button data-act="discoverpage-tab" data-tab="add" aria-pressed="${String(discoverPageTab==='add')}">Add a book</button>
    <button data-act="discoverpage-tab" data-tab="similar" aria-pressed="${String(discoverPageTab==='similar')}">Find similar</button>
  </div>`;
  return `<div class="dash">
    <section class="dash-section">
      <div class="sec-head"><h2>Discovery</h2></div>
      ${tabsHtml}
      ${discoverPageTab==='add' ? renderDiscoverAddSection() : renderDiscoverSimilarSection()}
    </section>
  </div>`;
}

// ---------- book preview modal (not in the library yet) ----------
// the one full-overview screen before adding any book that isn't already
// yours — cover, synopsis, genres, and (when Open Library has it tagged)
// a way to add its whole series instead of just this one. Used both for
// TasteDive's "similar books" results and for Open Library search results
// in the Discovery page's "Add a book" tab, so there's exactly one preview
// experience regardless of how you got to a given title. An ephemeral,
// session-only cache — these aren't your books, so there's nowhere in
// store.js to persist them; re-opened previews just re-fetch.
const discoverPreviewCache=new Map();
let previewCtx=null;
function discoverPreviewHtml(title,series,num,author,coverUrl){
  const key=(title||'').toLowerCase();
  const entry=discoverPreviewCache.get(key);
  let synBody,genBody;
  if(!entry || entry.status==='loading'){
    synBody='<div class="empty-row">Looking up a synopsis…</div>';
    genBody='<div class="empty-row">Looking up genres…</div>';
  } else {
    synBody = entry.text ? `<p class="sub" style="margin:0;white-space:pre-wrap">${esc(entry.text)}</p>` : '<p class="sub" style="margin:0">No synopsis found on Open Library.</p>';
    genBody = (entry.genres&&entry.genres.length) ? '<div class="genre-tags">'+entry.genres.map(x=>`<span class="genre-tag">${esc(x)}</span>`).join('')+'</div>' : '<p class="sub" style="margin:0">No genres found on Open Library.</p>';
  }
  return `<div class="detail-head">
      ${coverUrl?`<div class="bookcover size-lg realcover"><img class="bc-photo" src="${esc(coverUrl)}" alt="Cover of ${esc(title)}"></div>`:''}
      <div>
        <div class="detail-title">${esc(title)}</div>
        ${author||series?`<div class="detail-sub">${esc([author,series+(num?' #'+num:'')].filter(Boolean).join(' · '))}</div>`:''}
      </div>
    </div>
    <div class="detail-section" style="margin-top:16px"><h4>Synopsis</h4>${synBody}</div>
    <div class="detail-section"><h4>Genres</h4>${genBody}</div>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn ghost" data-act="close">Close</button>
      ${series?`<button class="btn ghost" data-act="preview-add-series" data-series="${esc(series)}">Add whole series&hellip;</button>`:''}
      <button class="btn primary" data-act="preview-add" data-title="${esc(title)}" data-series="${esc(series)}" data-num="${esc(num)}" data-author="${esc(author)}" data-cover="${esc(coverUrl)}">+ Add book</button>
    </div>`;
}
// synopsis, genres, and (only when neither Open Library nor Google Books
// already found one) a Wikidata series check — all independent lookups,
// allSettled so one failing or coming back empty never blocks the others
function ensurePreviewInfo(title,author){
  const key=(title||'').toLowerCase();
  if(discoverPreviewCache.has(key)) return;
  discoverPreviewCache.set(key,{status:'loading'});
  const needsSeries = previewCtx && previewCtx.title===title && !previewCtx.series;
  Promise.allSettled([
    Discover.openLibrarySynopsis(title,author),
    Discover.openLibrarySubjects(title,author),
    needsSeries ? Discover.wikidataSeriesFor(title,author) : Promise.resolve(null)
  ]).then(([synRes,genRes,serRes])=>{
    discoverPreviewCache.set(key,{
      status:'ok',
      text: synRes.status==='fulfilled' ? synRes.value : '',
      genres: genRes.status==='fulfilled' ? genRes.value : []
    });
    if(serRes.status==='fulfilled' && serRes.value && serRes.value.series && previewCtx && previewCtx.title===title){
      previewCtx.series=serRes.value.series;
      if(!previewCtx.num) previewCtx.num=serRes.value.num;
    }
    if(previewCtx && previewCtx.title===title) rerenderPreview();
  });
}
function rerenderPreview(){
  if(!modalCtx || !previewCtx) return;
  modalCtx.m.querySelector('.modal-body').innerHTML=discoverPreviewHtml(previewCtx.title,previewCtx.series,previewCtx.num,previewCtx.author,previewCtx.coverUrl);
}
function openDiscoverPreview(title,series,num,author,coverUrl){
  previewCtx={title,series,num,author,coverUrl};
  showModal(discoverPreviewHtml(title,series,num,author,coverUrl),{
    onAction:(t)=>{
      if(t.dataset.act==='close'){ closeModal(); return; }
      if(t.dataset.act==='preview-add-series'){ openAddSeriesModal(t.dataset.series); return; }
      if(t.dataset.act==='preview-add'){
        const entry=S.addBook({series:t.dataset.series,num:t.dataset.num,title:t.dataset.title,author:t.dataset.author,status:'unread'});
        if(entry){
          if(t.dataset.cover) S.setCover(entry.id,t.dataset.cover);
          discoverCache.forEach(c=>{ if(c.status==='ok') c.items=c.items.filter(it=>it.title!==t.dataset.title); });
          toast('Added “'+S.displayTitle(entry)+'” ✓');
          closeModal(); refreshView();
        }
      }
    }
  });
  ensurePreviewInfo(title,author);
}

function renderDashboard(){
  const st=S.computeStats();
  const goal=S.getGoal();
  const year=new Date().getFullYear();
  const doneThisYear=st.byYear[String(year)]||0;
  const streak=S.currentStreak();
  const due=S.dueReminders();

  const flameHtml=`<span class="flame${streak>0?' lit':''}" aria-hidden="true">&#128293;</span>`;
  let ring='';
  if(goal){
    const pct=Math.min(1, doneThisYear/goal.target);
    const r=32, c=2*Math.PI*r;
    ring=`<div class="ring"><svg viewBox="0 0 76 76"><circle class="track" cx="38" cy="38" r="${r}"></circle>
      <circle class="fill" cx="38" cy="38" r="${r}" style="stroke-dasharray:${c};stroke-dashoffset:${c*(1-pct)}"></circle></svg>
      <div class="ring-num">${doneThisYear}</div></div>
      <div><div class="hero-goal-lbl">${doneThisYear} of ${goal.target} books in ${year}</div>
      <div class="hero-streak">${flameHtml} <b>${streak}</b> day streak</div></div>`;
  } else {
    ring=`<button class="btn ghost sm" data-act="goal-open">Set a ${year} goal</button>
      <div class="hero-streak">${flameHtml} <b>${streak}</b> day streak</div>`;
  }

  const dueBanner = due.length ? `<section class="dash-due">
      <span>${due.length===1?'1 reminder is':due.length+' reminders are'} due</span>
      <button data-act="reminders-open">View</button>
    </section>` : '';

  const ordered=stableReadingOrder();
  const continueHtml = ordered.length ? `<div class="herostack">${ordered.map(({s,b})=>{
      const id=b.id, d=S.det(id); const standalone=s.series==='Standalone';
      const pct = d.ptot? Math.min(100,Math.round(100*(d.pcur||0)/d.ptot)) : null;
      const seriesLabel = standalone ? '' : s.series+(b.num?' · Book '+b.num:'');
      return `<article class="featured">
        <span class="flap">Currently Reading</span>
        ${bookCoverHtml(id,S.displayTitle(b),S.authorOf(s,b),seriesLabel,standalone,'lg')}
        <div class="fmeta">
          ${seriesLabel?`<div class="fk">${esc(seriesLabel)}</div>`:''}
          <h3>${esc(S.displayTitle(b))}</h3>
          ${S.authorOf(s,b)?`<div class="fauth">${esc(S.authorOf(s,b))}</div>`:''}
          <div class="fprog">
            ${pct!=null?`<div class="bar"><i style="width:${pct}%"></i></div>`:''}
            <div class="flbl">
              <span>${d.started?'Started '+esc(S.fmtDate(d.started)):'In progress'}</span>
              <span>${d.fmt==='audio'?'ch.':'p.'} <span class="pgcur" data-act="pgcur-edit" data-id="${id}" tabindex="0" role="button" title="Tap to type an exact ${d.fmt==='audio'?'chapter':'page'}">${d.pcur||0}</span> of ${d.ptot||'&mdash;'}</span>
            </div>
          </div>
          <div class="factions">
            <div class="stepgroup">
              <button class="stepbtn" data-act="step" data-id="${id}" data-delta="-10">&minus;10</button>
              <button class="stepbtn" data-act="step" data-id="${id}" data-delta="-1">&minus;1</button>
              <button class="stepbtn" data-act="step" data-id="${id}" data-delta="1">+1</button>
              <button class="stepbtn" data-act="step" data-id="${id}" data-delta="10">+10</button>
            </div>
            <button class="btn ghost sm" data-act="open" data-id="${id}">Details</button>
            <button class="donebtn" data-act="finish" data-id="${id}">Finished &#10003;</button>
          </div>
        </div>
      </article>`;
    }).join('')}</div>` : '<div class="empty-row">Nothing in progress &mdash; open Library and start something.</div>';

  const recs=S.recommendations(8);
  const recHtml = recs.length ? recs.map(({s,b,reason})=>{
      const standalone=s.series==='Standalone';
      return `<article class="chipcard" data-act="open" data-id="${b.id}" role="button" tabindex="0">
        ${bookCoverHtml(b.id,S.displayTitle(b),S.authorOf(s,b),standalone?'':s.series,standalone,'md')}
        <div class="chipcard-title">${esc(S.displayTitle(b))}</div>
        <div class="chipcard-reason">${esc(reason)}</div>
      </article>`;
    }).join('') : '<div class="empty-row">Add a few books and rate some favorites to get picks here.</div>';

  const upnext=S.upNextList();
  const upnextSection = upnext.length ? `<section class="dash-section">
      <div class="sec-head"><h2>Up next</h2></div>
      <div class="hscroll">${upnext.map(({s,b})=>{
        const standalone=s.series==='Standalone';
        return `<article class="chipcard" data-act="open" data-id="${b.id}" role="button" tabindex="0">
          ${bookCoverHtml(b.id,S.displayTitle(b),S.authorOf(s,b),standalone?'':s.series,standalone,'md')}
          <div class="chipcard-title">${esc(S.displayTitle(b))}</div>
          <div class="chipcard-reason">${esc(s.series)}</div>
        </article>`;
      }).join('')}</div></section>` : '';

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
      ${continueHtml}
    </section>
    <section class="dash-section">
      <div class="sec-head"><h2>Recommended for you</h2></div>
      <div class="hscroll">${recHtml}</div>
    </section>
    ${discoverSectionHtml()}
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
// reorder: null for a plain row, or {isFirst,isLast} to show up/down arrows
// — only offered where the displayed order is actually the real order (the
// unfiltered series view), never on a filtered/searched subset where
// "up"/"down" would skip over hidden books in a confusing way
function bookRowHtml(s,b,reorder){
  const id=b.id; const r=S.ratings[id]||0; const d=S.det(id);
  const sub=[]; if(s.series!=='Standalone' && b.num) sub.push('#'+b.num); const a=S.authorOf(s,b); if(a) sub.push(a);
  if(d.fmt==='audio') sub.push('\u{1F3A7}'); if(d.fmt==='manga') sub.push('\u{1F4D5}');
  const main=`<button class="book-row-main" data-act="open" data-id="${id}">
    <span class="statusdot" style="--dot:${statusDotStyle(id)}"></span>
    <span class="book-main">
      <span class="book-title">${esc(S.displayTitle(b))}</span>
      <span class="book-sub">${esc(sub.join(' · '))}</span>
    </span>
    ${r?`<span class="book-stars">${'★'.repeat(r)}</span>`:''}
  </button>`;
  const reorderCtl = reorder ? `<span class="book-reorder">
      <button type="button" data-act="book-move-up" data-sid="${s.sid}" data-id="${id}" ${reorder.isFirst?'disabled':''} aria-label="Move up">&uarr;</button>
      <button type="button" data-act="book-move-down" data-sid="${s.sid}" data-id="${id}" ${reorder.isLast?'disabled':''} aria-label="Move down">&darr;</button>
    </span>` : '';
  return `<div class="book-row">${main}${reorderCtl}</div>`;
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
    // reordering (both books within a series, and series among each other)
    // only makes sense against the real, complete order — not a filtered
    // view where some books are hidden and "up"/"down" would be misleading
    const unfiltered = statusFilter==='all' && fmtFilter==='all' && ratingFilter==='all';
    body = list.length ? list.map((s,si)=>{
      const books=s.books.filter(b=>passesFilter(s,b));
      if(!books.length) return '';
      const open=openSeries.has(s.sid);
      const total=s.books.length, done=s.books.filter(b=>S.statusOf(b.id)==='read').length;
      const canReorderBooks = unfiltered && books.length>1;
      const rowsHtml = books.map((b,i)=>bookRowHtml(s,b,canReorderBooks?{isFirst:i===0,isLast:i===books.length-1}:null)).join('');
      const seriesReorder = unfiltered && list.length>1 ? `<span class="series-reorder">
          <button type="button" data-act="series-move-up" data-series="${esc(s.series)}" ${si===0?'disabled':''} aria-label="Move ${esc(s.series)} up">&uarr;</button>
          <button type="button" data-act="series-move-down" data-series="${esc(s.series)}" ${si===list.length-1?'disabled':''} aria-label="Move ${esc(s.series)} down">&darr;</button>
        </span>` : '';
      return `<section class="series-group" data-open="${open}">
        <div class="series-head-row">
          <button class="series-head" data-act="series-toggle" data-sid="${s.sid}">
            <span class="series-name">${esc(s.series)}</span>
            <span class="series-count">${done}/${total}</span>
            <span class="series-caret" aria-hidden="true">&#8250;</span>
          </button>
          ${seriesReorder}
        </div>
        <div class="series-books">${rowsHtml}</div>
        ${unfiltered?`<div class="series-footer"><button class="btn danger sm" data-act="series-delete" data-series="${esc(s.series)}">Delete series&hellip;</button></div>`:''}
      </section>`;
    }).join('') : '<div class="empty-row">No series yet. Tap + to add one.</div>';
  } else {
    const singles=S.findSeries('Standalone');
    const books=singles?singles.books.filter(b=>passesFilter(singles,b)):[];
    body = books.length ? `<div class="singles-grid">${books.map(b=>`
      <button class="singlecard" data-act="open" data-id="${b.id}">
        ${bookCoverHtml(b.id,S.displayTitle(b),S.authorOf(singles,b),'',true,'md')}
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
        <button class="themeopt" data-act="theme-pick" data-theme="cyberpunk" aria-pressed="${String(theme==='cyberpunk')}">
          <div class="swatch" style="background:linear-gradient(135deg,#04060a,#2de7ff)"></div>Cyberpunk</button>
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
      <h3>Discovery</h3>
      ${(S.getTasteDiveKey() && S.getTasteDiveProxy()) ? `
        <div class="setrow"><span>TasteDive</span><span>Connected</span></div>
        <p class="sub" style="margin:10px 0">Powers the "Discover" row on your dashboard — books similar to your top-rated ones that aren't in your library yet.</p>
        <button class="btn danger sm" data-act="taste-disconnect">Disconnect</button>
      ` : `
        <p class="sub" style="margin:0 0 10px">Paste a free <a href="https://tastedive.com/read/api" target="_blank" rel="noopener">TasteDive</a> API key to get a "Discover" row on your dashboard: books similar to your top-rated ones that aren't in your library yet.</p>
        <div class="field"><label>TasteDive API key</label><input id="tasteInput" value="${esc(S.getTasteDiveKey())}" placeholder="e.g. 1079186-YourApp-xxxxxxxx" autocomplete="off"></div>
        <p class="sub" style="margin:0 0 10px">TasteDive's API blocks direct calls from a browser (no CORS header on their end), so this also needs a small free proxy you deploy yourself — your key goes only from your device to your own proxy to TasteDive, never anywhere else. <a href="https://github.com/Zhemmie/ReadingDesk/tree/main/cloudflare-worker" target="_blank" rel="noopener">Setup steps (~5 min, free Cloudflare account)</a>.</p>
        <div class="field"><label>CORS proxy URL</label><input id="tasteProxyInput" value="${esc(S.getTasteDiveProxy())}" placeholder="https://your-worker.your-subdomain.workers.dev" autocomplete="off"></div>
        <button class="btn primary" data-act="taste-connect">Connect</button>
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
      <h3>Troubleshooting</h3>
      <div class="setrow"><span>App version</span><span>${APP_VERSION}</span></div>
      <p class="sub" style="margin:10px 0">If you've updated the app but it still looks old, your device may be stuck on a cached copy. This clears it and reloads immediately.</p>
      <button class="btn ghost sm" data-act="force-refresh">Force refresh app</button>
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
  const standalone=s.series==='Standalone';
  const subParts=[]; if(!standalone){ subParts.push(s.series+(b.num?' #'+b.num:'')); if(S.authorOf(s,b)) subParts.push(S.authorOf(s,b)); }
  else subParts.push(S.authorOf(s,b)||'Standalone');

  const pal=(isCyberpunkTheme()?NIGHT_FAMILIES:FAMILIES).map(f=>f.dark);
  const swatches=pal.map(c=>`<button data-act="color-set" data-hex="${c}" style="background:${c};width:26px;height:26px;border-radius:50%;margin:3px;border:2px solid ${d.color===c?'var(--text)':'transparent'}"></button>`).join('');

  const notesHtml=S.notesFor(id).map(n=>{
    if(editingNoteId===n.nid) return `<div class="note-item">
      <form data-act="note-edit-save" data-id="${id}" data-nid="${n.nid}" class="field">
        <textarea name="text">${esc(n.text)}</textarea>
        <div class="btnrow" style="margin-top:6px">
          <button type="button" class="btn ghost sm" data-act="note-edit-cancel" data-id="${id}">Cancel</button>
          <button type="submit" class="btn primary sm">Save</button>
        </div>
      </form>
    </div>`;
    return `<div class="note-item">
      <div class="note-meta"><span>${S.fmtDateTime(n.at)}${n.editedAt?' (edited)':''}</span></div>
      <div class="note-text">${esc(n.text)}</div>
      <div class="note-actions">
        <button data-act="note-edit-start" data-nid="${n.nid}">Edit</button>
        <button data-act="note-delete" data-nid="${n.nid}">Delete</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty-row">No notes yet.</div>';

  const reminders=S.remindersFor(id).filter(r=>!r.done);
  const remindersHtml=reminders.map(r=>`
    <div class="reminder-item${r.at<=Date.now()?' due':''}">
      <span class="reminder-when">${S.fmtDateTime(r.at)}${r.note?' &mdash; '+esc(r.note):''}</span>
      <button class="btn ghost sm" data-act="reminder-done" data-rid="${r.rid}">Done</button>
      <button class="btn ghost sm" data-act="reminder-delete" data-rid="${r.rid}">Cancel</button>
    </div>`).join('');

  const reads=d.reads||[];
  const readsHtml = reads.length ? reads.map((x,i)=>`<div class="kv"><span>Read ${i+1}</span><span>${S.fmtDate(x.started)||'?'} &rarr; ${S.fmtDate(x.finished)||'?'}
    <button class="iconlink" data-act="read-entry-delete" data-id="${id}" data-idx="${i}" style="margin-left:8px">Remove</button></span></div>`).join('') : '';

  return `
    <div class="detail-head">
      ${bookCoverHtml(id,S.displayTitle(b),S.authorOf(s,b),standalone?'':s.series,standalone,'lg')}
      <div>
        <div class="detail-title">${esc(S.displayTitle(b))}</div>
        <div class="detail-sub">${esc(subParts.join(' · '))}</div>
      </div>
    </div>

    <div class="detail-section">
      <section class="collapse" data-open="${!synopsisCollapsed.has(id)}">
        <button type="button" class="collapse-head" data-act="synopsis-toggle" data-id="${id}">
          <span>Synopsis</span><span class="series-caret" aria-hidden="true">&#8250;</span>
        </button>
        <div class="collapse-body">${synopsisHtml(id)}</div>
      </section>
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
      <h4>Cover art</h4>
      ${d.cover
        ? `<p class="sub" style="margin:0 0 8px">Using a real cover.</p>
           <button class="btn ghost sm" data-act="cover-clear" data-id="${id}">Remove cover</button>`
        : st==='reading'
          ? `<p class="sub" style="margin:0 0 8px">Pull the real cover out of an EPUB or CBZ file — shown while you’re reading it.</p>
             <button class="btn ghost sm" data-act="cover-pull" data-id="${id}">Pull cover from file&hellip;</button>`
          : `<p class="sub" style="margin:0">Mark this book Reading to pull a real cover from an EPUB or CBZ file.</p>`}
    </div>

    <div class="detail-section">
      <h4>Cover color</h4>
      <div>${swatches}<button class="btn ghost sm" data-act="color-clear" data-id="${id}" style="margin-left:8px">Auto</button></div>
    </div>

    <div class="detail-section">
      <h4>Genres</h4>
      ${genresHtml(id)}
      <div class="btnrow" style="margin-top:8px">
        ${!d.cover ? `<button class="btn ghost sm" data-act="cover-fetch" data-id="${id}" ${coverFetchLoading.has(id)?'disabled':''}>${coverFetchLoading.has(id)?'Fetching cover…':'Fetch cover'}</button>` : ''}
        <button class="btn ghost sm" data-act="discover-open" data-id="${id}">Find similar books</button>
      </div>
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
let editingNoteId=null;
function openDetail(id){
  editingNoteId=null;
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
      else if(act==='cover-clear'){ S.clearCover(bid); rerenderDetail(bid); toast('Cover removed.'); }
      else if(act==='cover-pull'){ pullCoverFromFile(bid); }
      else if(act==='genres-fetch'||act==='genres-refetch'){ fetchGenres(bid); }
      else if(act==='cover-fetch'){ fetchCoverFromApi(bid); }
      else if(act==='synopsis-fetch'||act==='synopsis-refetch'){ fetchSynopsis(bid); }
      else if(act==='synopsis-toggle'){
        if(synopsisCollapsed.has(bid)) synopsisCollapsed.delete(bid); else synopsisCollapsed.add(bid);
        rerenderDetail(bid);
      }
      else if(act==='discover-open'){
        const found=S.bookById(bid); if(!found) return;
        discoverSeeds=[S.displayTitle(found.b)];
        discoverPageTab='similar';
        closeModal(); setView('discover');
      }
      else if(act==='next-on'){ S.toggleNext(bid); rerenderDetail(bid); }
      else if(act==='next-off'){ S.toggleNext(bid); rerenderDetail(bid); }
      else if(act==='note-add'){ const ta=t.querySelector('[name="text"]'); if(S.addNote(bid,ta.value)){ rerenderDetail(bid); toast('Note added'); } }
      else if(act==='note-delete'){ S.deleteNote(t.dataset.nid); rerenderDetail(bid||currentDetailId); }
      else if(act==='note-edit-start'){ editingNoteId=t.dataset.nid; rerenderDetail(bid||currentDetailId); }
      else if(act==='note-edit-cancel'){ editingNoteId=null; rerenderDetail(bid||currentDetailId); }
      else if(act==='note-edit-save'){
        const ta=t.querySelector('[name="text"]'); S.editNote(t.dataset.nid,ta.value);
        editingNoteId=null; rerenderDetail(bid||currentDetailId);
      }
      else if(act==='read-entry-delete'){ S.removeReadEntry(bid,+t.dataset.idx); rerenderDetail(bid); }
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
  if(S.synopsisFor(id)==null) fetchSynopsis(id);
}
let currentDetailId=null;
function rerenderDetail(id){ if(!modalCtx) return;
  modalCtx.m.querySelector('.modal-body').innerHTML=detailHtml(id);
  refreshView();
}
function rerenderDashboardOnly(){ if(currentView==='dashboard') renderView(); }

function pullCoverFromFile(id){
  const input=document.createElement('input');
  input.type='file'; input.accept='.epub,.cbz,application/epub+zip,application/vnd.comicbook+zip'; input.hidden=true;
  document.body.appendChild(input);
  input.addEventListener('change',async ()=>{
    const file=input.files[0]; input.remove(); if(!file) return;
    toast('Reading cover from '+(/\.cbz$/i.test(file.name)?'CBZ':'EPUB')+'…');
    try{
      const dataUrl=await Covers.coverFromFile(file);
      if(S.statusOf(id)!=='reading'){ toast('This book is no longer marked as reading — cover not saved.'); return; }
      S.setCover(id,dataUrl);
      if(currentDetailId===id) rerenderDetail(id); else refreshView();
      toast('Cover added ✓');
    }catch(err){ toast(err&&err.message ? err.message : 'Couldn’t read a cover from that file.'); }
  });
  input.click();
}

const genresLoading=new Set();
function genresHtml(id){
  const g=S.genresFor(id);
  if(genresLoading.has(id)) return '<div class="empty-row">Looking up genres…</div>';
  if(g && g.length){
    return '<div class="genre-tags">'+g.map(x=>`<span class="genre-tag">${esc(x)}</span>`).join('')+'</div>'
      +`<button class="btn ghost sm" data-act="genres-refetch" data-id="${id}" style="margin-top:8px">Refresh</button>`;
  }
  if(g && !g.length){
    return '<p class="sub" style="margin:0 0 8px">No genres found for this one on Open Library.</p>'
      +`<button class="btn ghost sm" data-act="genres-fetch" data-id="${id}">Try again</button>`;
  }
  return `<button class="btn ghost sm" data-act="genres-fetch" data-id="${id}">Fetch genres</button>`;
}
function fetchGenres(id){
  const found=S.bookById(id); if(!found) return;
  const {s,b}=found;
  genresLoading.add(id); rerenderDetail(id);
  Discover.openLibrarySubjects(S.displayTitle(b),S.authorOf(s,b)).then(arr=>{
    genresLoading.delete(id); S.setGenres(id,arr); rerenderDetail(id);
  }).catch(err=>{
    genresLoading.delete(id); toast((err&&err.message)||'Could not fetch genres.'); rerenderDetail(id);
  });
}

// pulls a real cover from Open Library/Google Books by title+author — the
// non-EPUB counterpart to "Pull cover from file" above, for books you
// aren't reading from a file at all. One-at-a-time, on demand: no reason to
// guess at covers for books nobody's looked at yet.
const coverFetchLoading=new Set();
function fetchCoverFromApi(id){
  const found=S.bookById(id); if(!found) return;
  const {s,b}=found;
  const title=S.displayTitle(b), author=S.authorOf(s,b);
  coverFetchLoading.add(id); rerenderDetail(id);
  Discover.openLibrarySearch([title,author].filter(Boolean).join(' '),1).then(results=>{
    coverFetchLoading.delete(id);
    const match=results && results[0];
    if(match && match.coverUrl){ S.setCover(id,match.coverUrl); toast('Cover added ✓'); }
    else toast('No cover found for this one.');
    rerenderDetail(id);
  }).catch(err=>{
    coverFetchLoading.delete(id); toast((err&&err.message)||'Could not fetch a cover.'); rerenderDetail(id);
  });
}

// the Synopsis section reads like a book's back cover: open by default and
// fetched automatically the moment a book's detail is opened (see
// openDetail), not gated behind a click. synopsisCollapsed tracks only the
// ids a user has explicitly collapsed this session — same session-only
// pattern as openSeries for the Library accordion, just inverted (default
// shown, not default hidden)
const synopsisLoading=new Set();
const synopsisCollapsed=new Set();
function synopsisHtml(id){
  if(synopsisLoading.has(id)) return '<div class="empty-row">Looking up a synopsis…</div>';
  const text=S.synopsisFor(id);
  if(text) return `<p class="sub" style="margin:0 0 8px;white-space:pre-wrap">${esc(text)}</p>`
    +`<button class="btn ghost sm" data-act="synopsis-refetch" data-id="${id}">Refresh</button>`;
  if(text===''){
    return '<p class="sub" style="margin:0 0 8px">No synopsis found for this one on Open Library.</p>'
      +`<button class="btn ghost sm" data-act="synopsis-fetch" data-id="${id}">Try again</button>`;
  }
  return `<button class="btn ghost sm" data-act="synopsis-fetch" data-id="${id}">Fetch synopsis</button>`;
}
function fetchSynopsis(id){
  const found=S.bookById(id); if(!found) return;
  const {s,b}=found;
  synopsisLoading.add(id); rerenderDetail(id);
  Discover.openLibrarySynopsis(S.displayTitle(b),S.authorOf(s,b)).then(text=>{
    synopsisLoading.delete(id); S.setSynopsis(id,text||''); rerenderDetail(id);
  }).catch(err=>{
    synopsisLoading.delete(id); toast((err&&err.message)||'Could not fetch a synopsis.'); rerenderDetail(id);
  });
}

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

// ================= DISCOVERY "ADD A BOOK" SEARCH ASSIST =================
// last Open Library search results shown on the Discovery page's "Add a
// book" tab, and the query that produced them. Picking a result opens the
// full preview (cover/synopsis/genres/series) rather than autofilling a
// form — there's no "pending cover" to stage anymore, the preview modal
// applies it directly on add.
let addSearchResults=[];
let addSearchQuery='';

// ---------- book cart (manual series-building) ----------
// series auto-detection (Open Library's text/field, Wikidata's structured
// claims) is a best effort — some series just aren't tagged anywhere, or
// get mismatched. The cart is the manual fallback: search, stage several
// books, reorder them, then commit the whole set as one series in its own
// order rather than whatever a lookup guessed. New items are inserted at
// their chronological slot by publication year (unknown years sort last),
// not appended — that's the "sorted by publication date by default" — but
// once in the cart, order is entirely under manual control via the arrows.
let bookCart=[];
function addToCart(item){
  if(!item || !item.title) return;
  if(bookCart.some(x=>x.title.toLowerCase()===item.title.toLowerCase())){ toast('Already in your cart.'); return; }
  const y=parseInt(item.year,10)||Infinity;
  let idx=bookCart.findIndex(x=>(parseInt(x.year,10)||Infinity)>y);
  if(idx<0) idx=bookCart.length;
  bookCart.splice(idx,0,item);
  refreshView();
  toast('Added to cart ✓');
}
function moveCartItem(idx,dir){
  const j=idx+dir; if(j<0||j>=bookCart.length) return;
  const tmp=bookCart[idx]; bookCart[idx]=bookCart[j]; bookCart[j]=tmp;
  refreshView();
}
function cartHtml(){
  if(!bookCart.length) return '';
  const rows=bookCart.map((item,i)=>`
      <div class="cart-row">
        <span class="cart-pos">${i+1}</span>
        ${item.coverUrl?`<img src="${esc(item.coverUrl)}" alt="" loading="lazy">`:'<span class="addsearch-nocoverthumb" aria-hidden="true"></span>'}
        <span class="addsearch-meta"><b>${esc(item.title)}</b>${item.author?' &mdash; '+esc(item.author):''}${item.year?' ('+item.year+')':''}</span>
        <span class="cart-ctl">
          <button type="button" data-act="cart-up" data-idx="${i}" ${i===0?'disabled':''} aria-label="Move up">&uarr;</button>
          <button type="button" data-act="cart-down" data-idx="${i}" ${i===bookCart.length-1?'disabled':''} aria-label="Move down">&darr;</button>
          <button type="button" data-act="cart-remove" data-idx="${i}" aria-label="Remove">&times;</button>
        </span>
      </div>`).join('');
  return `<div class="detail-section">
    <h4>Cart (${bookCart.length})</h4>
    <p class="sub" style="margin:0 0 10px">Sorted by publication date &mdash; use the arrows to reorder, then add it all as one series.</p>
    <div class="cart-list">${rows}</div>
    <form data-act="cart-create" class="field" style="margin-top:10px">
      <label>Series name</label>
      <div class="seekrow">
        <input type="text" name="seriesName" list="seriesList" placeholder="New or existing series name" required autocomplete="off">
        <button type="submit" class="btn primary">Add as series</button>
      </div>
    </form>
    ${seriesDatalistHtml()}
    <button type="button" class="btn ghost sm" data-act="cart-clear">Clear cart</button>
  </div>`;
}
function addSearchResultsHtml(){
  const bookList = addSearchResults.length
    ? '<div class="addsearch-results">'+addSearchResults.map((r,i)=>`
        <div class="addsearch-row">
          <button type="button" class="addsearch-item" data-act="add-search-preview" data-idx="${i}">
            ${r.coverUrl?`<img src="${esc(r.coverUrl)}" alt="" loading="lazy">`:'<span class="addsearch-nocoverthumb" aria-hidden="true"></span>'}
            <span class="addsearch-meta"><b>${esc(r.title)}</b>${r.author?' &mdash; '+esc(r.author):''}${r.year?' ('+r.year+')':''}${r.series?`<br><i>${esc(r.series+(r.num?' #'+r.num:''))}</i>`:''}</span>
          </button>
          <div class="addsearch-actions">
            <button type="button" class="btn ghost sm" data-act="cart-add" data-idx="${i}">+ Cart</button>
            ${r.series?`<button type="button" class="btn ghost sm addseries-link" data-act="add-series-open" data-series="${esc(r.series)}">Add the whole "${esc(r.series)}" series&hellip;</button>`:''}
          </div>
        </div>`).join('')+'</div>'
    : (addSearchQuery ? '<div class="empty-row">No book matches.</div>' : '');
  // search also works as a series-name lookup: whatever you typed is tried
  // directly as an exact series name, independent of whether any individual
  // book result came back — covers searching "Between Earth and Sky" itself
  // rather than one of its books' titles
  const seriesShortcut = addSearchQuery
    ? `<button type="button" class="btn ghost sm addseries-link" data-act="add-series-open" data-series="${esc(addSearchQuery)}" style="margin-top:8px">Looking for a series instead? Add the whole &ldquo;${esc(addSearchQuery)}&rdquo; series&hellip;</button>`
    : '';
  return bookList+seriesShortcut;
}
// its own tiny <form> (not nested in anything else) so Enter in the search
// box searches rather than triggering some other submit — handled by a
// dedicated 'submit' listener on #view (this lives on the page now, not in
// a modal, so the modal system's own submit routing doesn't cover it)
function searchAssistHtml(){
  return `<form data-act="add-search" class="field">
    <div class="seekrow">
      <input type="text" name="q" placeholder="Search by title…" autocomplete="off">
      <button type="submit" class="btn primary">Search</button>
    </div>
    <div id="addSearchResults">${addSearchResultsHtml()}</div>
  </form>`;
}
// ---------- "add entire series" modal ----------
// opened from a search result that has a detected series — fetches every
// volume Open Library has tagged with that exact series name and lets the
// person review/deselect before actually adding anything, since the series
// match is a best-effort text parse (see discover.js openLibrarySeries)
let addSeriesName='';
let addSeriesStatus='loading'; // loading|ok|error
let addSeriesError='';
let addSeriesVolumes=[];
let addSeriesChecked=new Set();
// no filtering of any kind here — every volume Open Library returns for
// this series is shown, including ones already in the library. Dedup is
// the person's own call via the checkboxes (or the existing "Merge
// duplicate series" tool in Settings afterward), not something to guess at
// silently; a book that matches by title but is actually a different
// edition, translation, or printing is a real case auto-filtering would
// have hidden with no way to override it.
function addSeriesModalHtml(){
  let body;
  if(addSeriesStatus==='loading') body='<div class="empty-row">Looking up the series on Open Library…</div>';
  else if(addSeriesStatus==='error') body=`<div class="empty-row">${esc(addSeriesError)}</div>`;
  else if(!addSeriesVolumes.length) body='<div class="empty-row">No volumes found with that exact series name on Open Library. Try the Paste list tab instead.</div>';
  else body='<div class="seriesvol-list">'+addSeriesVolumes.map((v,i)=>`
      <label class="seriesvol-row">
        <input type="checkbox" data-act="addseries-toggle" data-idx="${i}" ${addSeriesChecked.has(i)?'checked':''}>
        ${v.coverUrl?`<img src="${esc(v.coverUrl)}" alt="" loading="lazy">`:'<span class="addsearch-nocoverthumb" aria-hidden="true"></span>'}
        <span class="addsearch-meta"><b>${v.num?('#'+esc(v.num)+' &mdash; '):''}${esc(v.title)}</b>${v.author?'<br>'+esc(v.author):''}${v.owned?' <i>(already in your library)</i>':''}</span>
      </label>`).join('')+'</div>';
  const n=addSeriesChecked.size;
  return `<h3>Add &ldquo;${esc(addSeriesName)}&rdquo;</h3>
    ${addSeriesVolumes.length ? `<p class="sub" style="margin:0 0 10px">Found on Open Library &mdash; uncheck any you don&rsquo;t want.</p>` : ''}
    ${body}
    <div class="btnrow" style="margin-top:14px">
      <button class="btn ghost" data-act="close">Close</button>
      ${addSeriesVolumes.length ? `<button class="btn primary" data-act="addseries-confirm" ${n?'':'disabled'}>Add ${n||''} book${n===1?'':'s'}</button>` : ''}
    </div>`;
}
function rerenderAddSeriesModal(){ if(!modalCtx) return; modalCtx.m.querySelector('.modal-body').innerHTML=addSeriesModalHtml(); }
function openAddSeriesModal(seriesName){
  addSeriesName=seriesName; addSeriesStatus='loading'; addSeriesVolumes=[]; addSeriesChecked=new Set();
  showModal(addSeriesModalHtml(),{
    onAction:(t)=>{
      if(t.dataset.act==='close'){ closeModal(); return; }
      if(t.dataset.act==='addseries-toggle'){
        // reads the checkbox's own current .checked rather than toggling Set
        // membership blindly: clicking anywhere in its <label> natively
        // flips the box and fires both 'click' and 'change' (both routed
        // here), so syncing to its actual state is what stays correct
        // either way, instead of a toggle that would double-fire and cancel
        const idx=+t.dataset.idx;
        if(t.checked) addSeriesChecked.add(idx); else addSeriesChecked.delete(idx);
        rerenderAddSeriesModal();
        return;
      }
      if(t.dataset.act==='addseries-confirm'){
        let added=0;
        addSeriesVolumes.forEach((v,i)=>{
          if(!addSeriesChecked.has(i)) return;
          const entry=S.addBook({series:addSeriesName,num:v.num,title:v.title,author:v.author,status:'unread'});
          if(entry){ added++; if(v.coverUrl) S.setCover(entry.id,v.coverUrl); }
        });
        toast(added+' book'+(added===1?'':'s')+' added to “'+addSeriesName+'” ✓');
        closeModal(); refreshView();
        return;
      }
    }
  });
  // Open Library's text search and Wikidata's structured "part of series"
  // data each catch books the other misses — merge both rather than
  // picking one, deduping by title (Open Library's copy wins on a title
  // both have, since it usually carries a cover and Wikidata never does)
  Promise.allSettled([
    Discover.openLibrarySeries(seriesName),
    Discover.wikidataSeriesVolumes(seriesName)
  ]).then(([olRes,wdRes])=>{
    const olVols=olRes.status==='fulfilled' ? olRes.value : [];
    const wdVols=wdRes.status==='fulfilled' ? wdRes.value : [];
    if(olRes.status==='rejected' && wdRes.status==='rejected'){
      addSeriesStatus='error';
      addSeriesError=(olRes.reason&&olRes.reason.message)||'Could not fetch the series.';
      rerenderAddSeriesModal();
      return;
    }
    const seen=new Set(), merged=[];
    [...olVols,...wdVols].forEach(v=>{
      const key=v.title.toLowerCase(); if(seen.has(key)) return; seen.add(key);
      merged.push(v);
    });
    merged.sort((a,b)=>(parseFloat(a.num)||999)-(parseFloat(b.num)||999));
    // every volume is kept and shown, checked by default — "owned" is just
    // a label on rows that match a title already in the library, not a
    // reason to exclude or pre-uncheck them
    const existingTitles=new Set(S.allBooks().map(x=>S.displayTitle(x.b).toLowerCase()));
    addSeriesVolumes=merged.map(v=>({...v, owned:existingTitles.has(v.title.toLowerCase())}));
    addSeriesStatus='ok';
    addSeriesChecked=new Set(addSeriesVolumes.map((_,i)=>i));
    rerenderAddSeriesModal();
  });
}

// ---------- "finished a book" modal ----------
// hitting "Finished" used to just flip the status with a toast — no chance
// to rate it or jot a note while it's fresh. This brings back a dedicated
// step for that: star rating, the finished date (defaults to today), and
// an optional note, all saved together when you confirm.
let finishBookId=null, finishRating=0, finishDate='';
function finishModalHtml(){
  const found=S.bookById(finishBookId);
  if(!found) return '<h3>Finished</h3><div class="empty-row">That book isn’t in your library anymore.</div>';
  const {s,b}=found; const standalone=s.series==='Standalone';
  return `<h3>Finished</h3>
    <div class="sub" style="margin:0 0 14px">${esc(S.displayTitle(b))}${standalone?'':' &mdash; '+esc(s.series)}</div>
    <div class="field"><label>Your rating</label>
      <div class="stars" role="group" aria-label="Your rating">
        ${[1,2,3,4,5].map(i=>`<button type="button" data-act="finish-rate" data-n="${i}" class="${i<=finishRating?'on':''}" aria-label="${i} star">&#9733;</button>`).join('')}
      </div>
    </div>
    <div class="field"><label for="finishDate">Finished</label><input id="finishDate" type="date" value="${esc(finishDate)}"></div>
    <div class="field"><label for="finishNotes">Notes (optional)</label>
      <textarea id="finishNotes" placeholder="Thoughts, quotes, how it landed&hellip;"></textarea>
    </div>
    <div class="btnrow">
      <button type="button" class="btn ghost" data-act="close">Cancel</button>
      <button type="button" class="btn primary" data-act="finish-save">Save &amp; finish</button>
    </div>`;
}
function rerenderFinishModal(){ if(!modalCtx) return; modalCtx.m.querySelector('.modal-body').innerHTML=finishModalHtml(); }
function openFinishModal(id){
  const found=S.bookById(id); if(!found){ S.markRead(id); refreshView(); toast('Marked finished ✓'); return; }
  finishBookId=id; finishRating=S.ratings[id]||0; finishDate=S.det(id).finished||S.today();
  showModal(finishModalHtml(),{
    onAction:(t)=>{
      if(t.dataset.act==='finish-rate'){
        const n=+t.dataset.n; finishRating=(finishRating===n?0:n); rerenderFinishModal(); return;
      }
      if(t.dataset.act==='finish-save'){
        const dateVal=document.getElementById('finishDate').value||S.today();
        const noteVal=(document.getElementById('finishNotes').value||'').trim();
        S.finishBook(finishBookId,{rating:finishRating,finished:dateVal,note:noteVal});
        closeModal(); refreshView(); toast('Marked finished ✓');
        return;
      }
    }
  });
}
function seriesDatalistHtml(){
  const seriesNames=S.catalog.series.filter(x=>x.series!=='Standalone').map(x=>x.series);
  return `<datalist id="seriesList">${seriesNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
}
// fallback paths off the Discovery page's "Add a book" tab, for when
// searching isn't what you want: typing a book in by hand (Open Library
// doesn't have everything), bulk-pasting a series list, or importing a
// Goodreads/StoryGraph/exported file. Each is its own small modal now
// rather than a tab inside one big Add modal, since there's no longer a
// shared "Add" modal wrapping them.
function openManualAddModal(){
  showModal(`<h3>Add a book manually</h3>
    <form data-act="quick-submit">
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
    </form>${seriesDatalistHtml()}`,{
    onAction:(t,e,m)=>{
      const act=t.dataset.act;
      if(act==='close'){ closeModal(); return; }
      if(act==='quick-fmt'){ setPressed(m,'[data-act="quick-fmt"]',t); m.querySelector('[name="fmt"]').value=t.dataset.fmt; return; }
      if(act==='quick-status'){ setPressed(m,'[data-act="quick-status"]',t); m.querySelector('[name="status"]').value=t.dataset.status; return; }
      if(act==='quick-submit'){
        const f=t;
        const entry=S.addBook({series:f.series.value,num:f.num.value,title:f.title.value,author:f.author.value,fmt:f.fmt.value,status:f.status.value});
        if(entry){
          toast('Added “'+S.displayTitle(entry)+'” ✓'); refreshView();
          f.title.value=''; f.num.value=''; f.author.value=''; f.title.focus();
        }
      }
    }
  });
}
function openPasteListModal(){
  showModal(`<h3>Paste a list of books</h3>
    <form data-act="paste-submit">
      <div class="field"><label>Series</label><input name="series" list="seriesList" placeholder="New or existing series name" required autofocus></div>
      <div class="field"><label>One book per line</label>
        <textarea name="text" rows="6" placeholder="1. First Book&#10;2. Second Book&#10;2.5. A Novella"></textarea></div>
      <div class="btnrow"><button type="button" class="btn ghost" data-act="close">Close</button><button type="submit" class="btn primary">Add list</button></div>
    </form>${seriesDatalistHtml()}`,{
    onAction:(t)=>{
      if(t.dataset.act==='close'){ closeModal(); return; }
      if(t.dataset.act==='paste-submit'){
        const f=t;
        const sn=f.series.value.trim(); if(!sn) return;
        if(!S.findSeries(sn)) S.addSeries(sn,'');
        const res=S.addList(sn,f.text.value);
        toast((res.added||0)+' book'+(res.added===1?'':'s')+' added.'); refreshView(); closeModal();
      }
    }
  });
}
function openImportModal(){
  showModal(`<h3>Import a file</h3>
    <p class="sub">Bring in a Goodreads or StoryGraph CSV export, or a .txt list exported from this app. Existing books are skipped.</p>
    <div class="btnrow"><button class="btn primary" data-act="import-choose">Choose file&hellip;</button></div>
    <div class="btnrow"><button class="btn ghost" data-act="close">Close</button></div>`,{
    onAction:(t)=>{
      if(t.dataset.act==='close'){ closeModal(); return; }
      if(t.dataset.act==='import-choose'){ document.getElementById('impfile').click(); }
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
document.getElementById('btnAdd').addEventListener('click',()=>{ discoverPageTab='add'; addSearchResults=[]; addSearchQuery=''; setView('discover'); });
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
  else if(act==='finish'){ openFinishModal(id); }
  else if(act==='pgcur-edit'){ startPcurEdit(t,id); }
  else if(act==='reminders-open') openReminders();
  else if(act==='goal-open') openGoalModal();
  else if(act==='open-settings') setView('settings');
  else if(act==='open-discover'){ discoverPageTab='similar'; setView('discover'); }
  else if(act==='discoverpage-tab'){ discoverPageTab=t.dataset.tab; refreshView(); }
  else if(act==='manual-add-open') openManualAddModal();
  else if(act==='paste-list-open') openPasteListModal();
  else if(act==='import-file-open') openImportModal();
  else if(act==='add-series-open') openAddSeriesModal(t.dataset.series);
  else if(act==='add-search-preview'){
    const r=addSearchResults[+t.dataset.idx]; if(r) openDiscoverPreview(r.title,r.series,r.num,r.author,r.coverUrl);
  }
  else if(act==='cart-add'){ addToCart(addSearchResults[+t.dataset.idx]); }
  else if(act==='cart-up'){ moveCartItem(+t.dataset.idx,-1); }
  else if(act==='cart-down'){ moveCartItem(+t.dataset.idx,1); }
  else if(act==='cart-remove'){ bookCart.splice(+t.dataset.idx,1); refreshView(); }
  else if(act==='cart-clear'){ bookCart=[]; refreshView(); }
  else if(act==='discoverseed-add'){ const inp=document.getElementById('discoverSeedInput'); addDiscoverSeed(inp&&inp.value); }
  else if(act==='discoverseed-remove'){ removeDiscoverSeed(+t.dataset.idx); }
  else if(act==='discoverseeds-clear'){ discoverSeeds=[]; refreshView(); }
  else if(act==='discover-retry'){ discoverCache.delete(t.dataset.seed); refreshView(); }
  else if(act==='discover-preview'){ openDiscoverPreview(t.dataset.title,t.dataset.series,t.dataset.num,t.dataset.author,t.dataset.cover); }
  else if(act==='discover-add'){
    const entry=S.addBook({series:t.dataset.series,num:t.dataset.num,title:t.dataset.title,author:t.dataset.author,status:'unread'});
    if(entry){
      if(t.dataset.cover) S.setCover(entry.id,t.dataset.cover);
      const c=discoverCache.get(t.dataset.seed);
      if(c && c.status==='ok') c.items=c.items.filter(it=>it.title!==t.dataset.title);
      toast('Added “'+S.displayTitle(entry)+'” ✓');
      refreshView();
    }
  }
  else if(act==='filter'){ statusFilter=t.dataset.filter; refreshView(); }
  else if(act==='seg'){ libTab=t.dataset.tab; refreshView(); }
  else if(act==='series-toggle'){ const sid=t.dataset.sid; openSeries.has(sid)?openSeries.delete(sid):openSeries.add(sid); refreshView(); }
  else if(act==='book-move-up'){ S.moveBookInSeries(t.dataset.sid,t.dataset.id,-1); refreshView(); }
  else if(act==='book-move-down'){ S.moveBookInSeries(t.dataset.sid,t.dataset.id,1); refreshView(); }
  else if(act==='series-move-up'||act==='series-move-down'){
    const dir=act==='series-move-up'?-1:1;
    const name=t.dataset.series;
    const list=S.catalog.series.filter(x=>x.series!=='Standalone');
    const i=list.findIndex(x=>x.series===name), j=i+dir;
    if(i>=0 && j>=0 && j<list.length) S.swapSeriesOrder(name,list[j].series);
    refreshView();
  }
  else if(act==='series-delete'){
    const name=t.dataset.series;
    const found=S.findSeries(name); if(!found) return;
    const n=found.books.length;
    if(confirm('Delete the whole "'+name+'" series ('+n+' book'+(n===1?'':'s')+')? This can’t be undone.')){
      S.removeSeries(name); refreshView(); toast('Series deleted.');
    }
  }
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
  else if(act==='force-refresh'){ forceRefreshApp(); }
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
  else if(act==='taste-connect'){
    const k=(document.getElementById('tasteInput').value||'').trim();
    const p=(document.getElementById('tasteProxyInput').value||'').trim();
    if(!k){ toast('Paste your TasteDive key first.'); return; }
    if(!p){ toast('Paste your proxy URL too — see the setup steps link above.'); return; }
    S.setTasteDiveKey(k); S.setTasteDiveProxy(p); discoverCache.clear(); refreshView(); toast('Connected ✓');
  }
  else if(act==='taste-disconnect'){ S.setTasteDiveKey(''); S.setTasteDiveProxy(''); discoverCache.clear(); refreshView(); toast('Disconnected on this device.'); }
});
document.getElementById('view').addEventListener('change',e=>{
  const t=e.target.closest('[data-act]'); if(!t) return;
  if(t.dataset.act==='fmt-filter'){ fmtFilter=t.value; refreshView(); }
  else if(t.dataset.act==='rating-filter'){ ratingFilter=t.value; refreshView(); }
  else if(t.dataset.act==='devname-input'){ Sync.setDevName(t.value); }
});
document.getElementById('view').addEventListener('keydown',e=>{
  if(e.key!=='Enter' && e.key!==' ') return;
  const t=e.target.closest('[data-act="pgcur-edit"]'); if(!t) return;
  e.preventDefault(); startPcurEdit(t,t.dataset.id);
});
// the only page-level <form>s outside a modal — Discovery's "Add a book"
// search box and the cart's "add as series" form — so one dedicated
// listener covers both rather than building out the modal system's
// generic form-routing for page content
document.getElementById('view').addEventListener('submit',e=>{
  const t=e.target.closest('form'); if(!t) return;
  if(t.dataset.act==='add-search'){
    e.preventDefault();
    const q=(t.q.value||'').trim();
    addSearchQuery=q; addSearchResults=[];
    const box=document.getElementById('addSearchResults');
    if(!q){ if(box) box.innerHTML=''; return; }
    if(box) box.innerHTML='<div class="empty-row">Searching Open Library…</div>';
    Discover.openLibrarySearch(q).then(results=>{
      addSearchResults=results;
      const liveBox=document.getElementById('addSearchResults');
      if(liveBox) liveBox.innerHTML=addSearchResultsHtml();
    }).catch(err=>{
      const liveBox=document.getElementById('addSearchResults');
      if(liveBox) liveBox.innerHTML=`<div class="empty-row">${esc((err&&err.message)||'Search failed.')}</div>`;
    });
    return;
  }
  if(t.dataset.act==='cart-create'){
    e.preventDefault();
    const sn=(t.seriesName.value||'').trim(); if(!sn || !bookCart.length) return;
    // appends after whatever the series already has, rather than always
    // starting numbering at 1 — lets the cart be used to add a few more
    // volumes to an existing series too, not just build a brand-new one
    const existing=S.findSeries(sn);
    const startNum=existing ? existing.books.length : 0;
    let added=0;
    bookCart.forEach((item,i)=>{
      const entry=S.addBook({series:sn,num:String(startNum+i+1),title:item.title,author:item.author,status:'unread'});
      if(entry){ added++; if(item.coverUrl) S.setCover(entry.id,item.coverUrl); }
    });
    bookCart=[];
    toast(added+' book'+(added===1?'':'s')+' added to “'+sn+'” ✓');
    refreshView();
  }
});
function startPcurEdit(span,id){
  const inp=document.createElement('input');
  inp.type='number'; inp.inputMode='numeric'; inp.min='0'; inp.className='pgcur-input';
  inp.value=S.det(id).pcur||''; inp.setAttribute('aria-label','Set exact progress');
  span.replaceWith(inp); inp.focus(); inp.select();
  let done=false;
  const commit=()=>{ if(done) return; done=true; S.setPages(id,'pcur',inp.value); refreshView(); };
  const cancel=()=>{ if(done) return; done=true; refreshView(); };
  inp.addEventListener('keydown',ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); commit(); } else if(ev.key==='Escape'){ ev.preventDefault(); cancel(); } });
  inp.addEventListener('blur',commit);
}

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

// unregisters the service worker and clears every cache this origin owns, then
// reloads with a cache-busting URL so even a stubborn HTTP cache can't serve
// the old index.html — the "I updated but it still looks old" escape hatch
async function forceRefreshApp(){
  toast('Refreshing…');
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){ /* best effort — reload regardless */ }
  const url=new URL(location.href);
  url.searchParams.set('_r', Date.now().toString(36));
  location.replace(url.toString());
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
