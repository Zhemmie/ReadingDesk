// store.js — all persisted state and pure data operations. No DOM here.
// Keys are kept compatible with the previous single-file app (v51) so an
// existing library on this device, or in a connected Gist, carries over.

export const K_CAT='rl.catalog.v2', K_ST='readinglist.v1', K_RT='readinglist.ratings.v1', K_DET='rl.details.v1';
export const K_UPD='rl.updatedAt', K_META='rl.meta.v1', K_DAYS='rl.activedays.v1';
export const K_NOTES='rl.notes.v1', K_REM='rl.reminders.v1';
export const K_GOAL='rl.goal', K_THEME='rl.theme', K_BKUP='rl.lastBackupAt';
export const SK_TOKEN='rl.sync.token', SK_GIST='rl.sync.gist', SK_LAST='rl.sync.lastAt';
export const SK_DEVID='rl.sync.devid', SK_DEVNAME='rl.sync.devname';

export const ORDER=['unread','reading','read','dnf'];
export const ST_LABEL={unread:'Unread',reading:'Reading',read:'Read',dnf:'Set aside'};
const SEED={series:[]};
const BACKUP_EVERY=14*24*60*60*1000;

let mem=false;
export let status={}, ratings={}, details={}, catalog, meta, activeDays={}, notes={}, reminders={};
export let applyingRemote=false;
export let dataUpdatedAt=0;

function safeParse(raw,fallback){ try{ return raw==null?fallback:JSON.parse(raw); }catch(e){ return fallback; } }

export function load(){
  try{ status=JSON.parse(localStorage.getItem(K_ST)||'{}'); }catch(e){ status={}; mem=true; }
  try{ ratings=JSON.parse(localStorage.getItem(K_RT)||'{}'); }catch(e){ ratings={}; }
  try{ details=JSON.parse(localStorage.getItem(K_DET)||'{}'); }catch(e){ details={}; }
  try{ const s=localStorage.getItem(K_CAT); catalog=s?JSON.parse(s):structuredClone(SEED); }catch(e){ catalog=structuredClone(SEED); }
  try{ meta=JSON.parse(localStorage.getItem(K_META)||'{"t":{},"del":{}}'); }catch(e){ meta={t:{},del:{}}; }
  if(!meta.t) meta.t={}; if(!meta.del) meta.del={}; if(!meta.devices) meta.devices={};
  notes=safeParse(localStorage.getItem(K_NOTES),{});
  reminders=safeParse(localStorage.getItem(K_REM),{});

  let daysLoadedFresh=true;
  try{ const raw=localStorage.getItem(K_DAYS); if(raw!==null){ activeDays=JSON.parse(raw); daysLoadedFresh=false; } }catch(e){ activeDays={}; }
  if(daysLoadedFresh){
    Object.values(details).forEach(d=>{
      if(d && d.pcurAt){ const dt=new Date(d.pcurAt); activeDays[ymd(dt)]=true; }
      if(d && d.started) activeDays[d.started]=true;
      if(d && d.finished) activeDays[d.finished]=true;
    });
    saveDays();
  }

  dataUpdatedAt=+localStorage.getItem(K_UPD)||0;
  normalizeCatalog();
  migrateLegacyNotes();
  if(!dataUpdatedAt && hasAnyBooks()){ dataUpdatedAt=Date.now(); try{localStorage.setItem(K_UPD,String(dataUpdatedAt));}catch(e){} }
}

// ---------- ids ----------
export function newId(p){ return p+Date.now().toString(36)+Math.random().toString(36).slice(2,9); }
export function hashStr(s){ s=String(s||''); let h=2166136261>>>0;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function detId(prefix,key,used){ let id=prefix+(hashStr(key)>>>0).toString(36);
  while(used && used.has(id)) id+='x'; if(used) used.add(id); return id; }

export function normalizeCatalog(){
  let changed=false;
  const usedS=new Set((catalog.series||[]).map(s=>s.sid).filter(Boolean));
  (catalog.series||[]).forEach(s=>{
    if(!s.sid){ s.sid=detId('s_','S|'+(s.series||''),usedS); changed=true; }
    const usedB=new Set((s.books||[]).map(b=>b.id).filter(Boolean));
    (s.books||[]).forEach(b=>{
      if(!b.id){
        const legacy=s.series+'|'+b.num+'|'+b.title;
        b.id=detId('b_','B|'+(s.series||'')+'|'+(b.num||'')+'|'+(b.title||''),usedB); changed=true;
        if(status[legacy]!==undefined){ status[b.id]=status[legacy]; delete status[legacy]; }
        if(ratings[legacy]!==undefined){ ratings[b.id]=ratings[legacy]; delete ratings[legacy]; }
        if(details[legacy]!==undefined){ details[b.id]=details[legacy]; delete details[legacy]; }
      }
    });
  });
  ensureStandalone();
  if(changed){ try{ localStorage.setItem(K_CAT,JSON.stringify(catalog));
    localStorage.setItem(K_ST,JSON.stringify(status)); localStorage.setItem(K_RT,JSON.stringify(ratings));
    localStorage.setItem(K_DET,JSON.stringify(details)); }catch(e){} }
  return changed;
}

// migrate a legacy single notes string on a book into the new timestamped notes log, once
function migrateLegacyNotes(){
  const MIGRATED='rl.notes.migrated.v1';
  if(localStorage.getItem(MIGRATED)) return;
  let did=false;
  Object.keys(details).forEach(id=>{
    const d=details[id]; if(!d || !d.notes) return;
    const already=Object.values(notes).some(n=>n.bookId===id);
    if(already) return;
    const nid=newId('n_');
    notes[nid]={bookId:id, at: d.finished || d.started || today(), text: String(d.notes)};
    touch(nid); did=true;
  });
  try{ localStorage.setItem(MIGRATED,'1'); }catch(e){}
  if(did) sNotes();
}

export function hasAnyBooks(){ return catalog.series.some(s=>s.books.length>0); }

// ---------- touch/tombstone (per-item last-write-wins for sync) ----------
export function touch(id){ if(!applyingRemote && id){ meta.t[id]=Date.now(); delete meta.del[id]; } }
export function tomb(id){ if(!applyingRemote && id){ meta.del[id]=Date.now(); delete meta.t[id]; } }
export function setApplyingRemote(v){ applyingRemote=v; }

// ---------- whole-value setters, for sync.js (merge/replace needs to swap these wholesale) ----------
export function setCatalog(v){ catalog=v; }
export function setStatus(v){ status=v; }
export function setRatings(v){ ratings=v; }
export function setDetails(v){ details=v; }
export function setMeta(v){ meta=v; }
export function setActiveDays(v){ activeDays=v; }
export function setNotes(v){ notes=v; }
export function setReminders(v){ reminders=v; }
export function setDataUpdatedAt(v){ dataUpdatedAt=v; try{localStorage.setItem(K_UPD,String(dataUpdatedAt));}catch(e){} }

// ---------- save helpers ----------
const onSaveCbs=[];
export function onSave(cb){ onSaveCbs.push(cb); }
function onDataSaved(){ if(applyingRemote) return; dataUpdatedAt=Date.now();
  try{localStorage.setItem(K_UPD,String(dataUpdatedAt));}catch(e){} sMeta(); onSaveCbs.forEach(cb=>cb()); }
export function sMeta(){ if(!mem){ try{ localStorage.setItem(K_META,JSON.stringify(meta)); }catch(e){} } }
export function sCat(){ if(!mem){try{localStorage.setItem(K_CAT,JSON.stringify(catalog));}catch(e){mem=true;}} onDataSaved(); }
export function sSt(){ if(!mem){try{localStorage.setItem(K_ST,JSON.stringify(status));}catch(e){mem=true;}} onDataSaved(); }
export function sRt(){ if(!mem){try{localStorage.setItem(K_RT,JSON.stringify(ratings));}catch(e){mem=true;}} onDataSaved(); }
export function sDet(){ if(!mem){try{localStorage.setItem(K_DET,JSON.stringify(details));}catch(e){mem=true;}} onDataSaved(); }
export function sNotes(){ if(!mem){try{localStorage.setItem(K_NOTES,JSON.stringify(notes));}catch(e){mem=true;}} onDataSaved(); }
export function sRem(){ if(!mem){try{localStorage.setItem(K_REM,JSON.stringify(reminders));}catch(e){mem=true;}} onDataSaved(); }
export function saveDays(){ if(!mem){ try{ localStorage.setItem(K_DAYS,JSON.stringify(activeDays)); }catch(e){} } }
export function markActiveToday(){ const day=ymd(new Date()); if(!activeDays[day]){ activeDays[day]=true; saveDays(); onDataSaved(); } }

// ---------- dates ----------
export function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export function today(){ return ymd(new Date()); }
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(s){ if(!s) return ''; const p=String(s).split('-'); if(p.length<3) return s;
  return MON[(+p[1]-1)]+" "+(+p[2])+" ’"+p[0].slice(2); }
export function fmtDateTime(ms){ if(!ms) return ''; const d=new Date(ms);
  return fmtDate(ymd(d))+' · '+d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}); }
export function relTime(ms){ if(!ms) return 'never'; const s=Math.round((Date.now()-ms)/1000);
  if(s<5) return 'just now'; if(s<60) return s+'s ago'; const m=Math.round(s/60); if(m<60) return m+'m ago';
  const h=Math.round(m/60); if(h<24) return h+'h ago'; const dd=Math.round(h/24); return dd+'d ago'; }

// ---------- catalog accessors ----------
export function idOf(sn,b){ return b.id; }
export function statusOf(id){ return status[id]||'unread'; }
export function det(id){ return details[id] || (details[id]={}); }
export function hasDet(id){ const d=details[id]; return d && (d.started||d.finished||d.notes||d.ptot||d.pcur||(d.reads&&d.reads.length)); }
export function findSeries(n){ return catalog.series.find(s=>s.series===n); }
export function ensureStandalone(){ const s=catalog.series.find(s=>s.series==='Standalone');
  if(!s) catalog.series.push({sid:newId('s_'),series:'Standalone',author:'',books:[]}); }
export function authorOf(s,b){ return (b&&b.author) ? b.author : (s?s.author:'') || ''; }
export function displayTitle(b){ return b.title || (b.num?('Vol. '+b.num):'Untitled'); }
export function bookById(id){ for(const s of catalog.series){ for(const b of s.books){ if(b.id===id) return {s,b}; } } return null; }
export function hayFor(s,b){ return (s.series+' '+(authorOf(s,b)||'')+' '+displayTitle(b)).toLowerCase(); }

export function allBooks(){ const out=[]; catalog.series.forEach(s=>s.books.forEach(b=>out.push({s,b}))); return out; }
export function readingList(){ return allBooks().filter(x=>statusOf(x.b.id)==='reading'); }

export function naturalCmp(a,b){
  const ax=String(a), bx=String(b);
  const ar=ax.match(/^(\d+(?:\.\d+)?)/), br=bx.match(/^(\d+(?:\.\d+)?)/);
  if(ar && br){ const d=parseFloat(ar[1])-parseFloat(br[1]); if(d) return d; }
  return ax.localeCompare(bx,undefined,{numeric:true,sensitivity:'base'});
}
function parseNum(n){ const f=parseFloat(n); return isNaN(f)?Infinity:f; }
export function insertByNumber(books,entry){
  const n=parseNum(entry.num);
  let i=books.findIndex(b=>parseNum(b.num)>n);
  if(i<0) i=books.length; books.splice(i,0,entry);
}

// ---------- CRUD: series/books ----------
export function addSeries(name,author){
  name=(name||'').trim(); author=(author||'').trim(); if(!name) return null;
  let s=findSeries(name);
  if(!s){ s={sid:newId('s_'),series:name,author,books:[]};
    const si=catalog.series.findIndex(x=>x.series==='Standalone');
    if(name!=='Standalone' && si>=0) catalog.series.splice(si,0,s); else catalog.series.push(s);
    touch(s.sid); touch('__order'); sCat();
  } else if(author && !s.author){ s.author=author; touch(s.sid); sCat(); }
  return s;
}
export function addBook({series,num,title,author,fmt,status:initStatus}){
  title=(title||'').trim(); if(!title) return null;
  const sName=(series||'').trim() || 'Standalone';
  let s=findSeries(sName);
  if(!s) s=addSeries(sName,'');
  const entry={id:newId('b_'), num:(sName==='Standalone'?'':(num||'').trim()), title};
  if(sName==='Standalone' && author) entry.author=(author||'').trim();
  if(entry.num) insertByNumber(s.books,entry); else s.books.push(entry);
  touch(entry.id); touch(s.sid);
  if(fmt==='audio'||fmt==='manga'){ det(entry.id).fmt=fmt; }
  if(initStatus && initStatus!=='unread'){
    status[entry.id]=initStatus;
    if(initStatus==='read') det(entry.id).finished=today();
    if(initStatus==='reading') det(entry.id).started=today();
    markActiveToday();
  }
  sCat(); sSt(); sDet();
  return entry;
}
export function renameBook(sn,b,num,title,author){
  title=(title||'').trim(); num=(num||'').trim();
  const s=findSeries(sn); if(!s || !title) return;
  b.title=title;
  if(sn==='Standalone'){ if(author!==undefined) b.author=(author||'').trim(); delete b.num; }
  else { if(num!==b.num){ s.books.splice(s.books.indexOf(b),1); b.num=num; if(num) insertByNumber(s.books,b); else s.books.push(b); } }
  touch(b.id); sCat();
}
export function saveSeriesEdit(oldName,newName,newAuthor){
  newName=(newName||'').trim(); newAuthor=(newAuthor||'').trim();
  const s=findSeries(oldName); if(!s || !newName) return;
  s.series=newName; s.author=newAuthor; touch(s.sid); sCat();
}
export function removeBook(sn,b){
  const s=findSeries(sn); if(!s) return; const i=s.books.indexOf(b); if(i<0) return;
  s.books.splice(i,1); tomb(b.id);
  delete status[b.id]; delete ratings[b.id]; delete details[b.id];
  Object.keys(notes).forEach(nid=>{ if(notes[nid].bookId===b.id){ tomb(nid); delete notes[nid]; } });
  Object.keys(reminders).forEach(rid=>{ if(reminders[rid].bookId===b.id){ tomb(rid); delete reminders[rid]; } });
  sCat(); sSt(); sRt(); sDet(); sNotes(); sRem();
}
export function removeSeries(name){
  const i=catalog.series.findIndex(s=>s.series===name); if(i<0) return;
  const s=catalog.series[i];
  s.books.forEach(b=>{ tomb(b.id); delete status[b.id]; delete ratings[b.id]; delete details[b.id]; });
  tomb(s.sid); catalog.series.splice(i,1);
  sCat(); sSt(); sRt(); sDet();
}
export function moveSeries(name,dir){ const i=catalog.series.findIndex(s=>s.series===name); const j=i+dir;
  if(i<0||j<0||j>=catalog.series.length) return;
  const [s]=catalog.series.splice(i,1); catalog.series.splice(j,0,s); touch('__order'); sCat(); }

// ---------- status / progress ----------
export function cycle(id){ const cur=statusOf(id); const i=ORDER.indexOf(cur); return ORDER[(i+1)%ORDER.length]; }
export function applyStatus(id,next){
  const cur=statusOf(id); if(cur===next) return;
  const d=det(id);
  if(next==='reading' && !d.started) d.started=today();
  if(next==='read'){ if(!d.finished) d.finished=today(); markActiveToday(); }
  if(cur==='reading' && next!=='reading') clearCoverIfDone(id);
  status[id]=next; touch(id); sSt(); sDet();
}
export function clearCoverIfDone(id){ const d=details[id]; if(d && d.cover && statusOf(id)!=='reading'){ delete d.cover; sDet(); } }
export function setCover(id,dataUrl){ det(id).cover=dataUrl; touch(id); sDet(); }
export function clearCover(id){ const d=details[id]; if(d && d.cover){ delete d.cover; touch(id); sDet(); } }
export function markRead(id){ status[id]='read'; if(!det(id).finished) det(id).finished=today();
  markActiveToday(); clearCoverIfDone(id); touch(id); sSt(); sDet(); }
export function setPages(id,which,val){ const d=det(id); const n=Math.max(0,Math.round(+val||0));
  d[which]=n||undefined; if(!n) delete d[which]; if(which==='pcur') d.pcurAt=Date.now();
  touch(id); sDet(); markActiveToday(); }
export function setRating(id,i){ if(ratings[id]===i) delete ratings[id]; else ratings[id]=i; touch(id); sRt(); }
export function setFormat(id,fmt){ const d=det(id); if(fmt==='audio'||fmt==='manga') d.fmt=fmt; else delete d.fmt; touch(id); sDet(); }
export function setColor(id,hex){ const d=det(id); if(hex) d.color=hex; else delete d.color; touch(id); sDet(); }
export function toggleNext(id){ const d=det(id); if(d.next) delete d.next; else d.next=1; touch(id); sDet(); }

export function startReread(id){
  const d=det(id); d.reads=d.reads||[];
  if(d.started||d.finished) d.reads.push({started:d.started||'',finished:d.finished||today()});
  d.started=today(); delete d.finished; status[id]='reading'; touch(id); sSt(); sDet();
}
export function setReadEntry(id,i,patch){ const d=det(id); if(!d.reads||!d.reads[i]) return;
  Object.assign(d.reads[i],patch); touch(id); sDet(); }
export function removeReadEntry(id,i){ const d=det(id); if(!d.reads||!d.reads[i]) return;
  d.reads.splice(i,1); touch(id); sDet(); }

// ---------- streak ----------
export function currentStreak(){
  const dates=new Set(Object.keys(activeDays));
  let n=0, d=new Date();
  if(!dates.has(ymd(d))){ d.setDate(d.getDate()-1); if(!dates.has(ymd(d))) return 0; }
  while(dates.has(ymd(d))){ n++; d.setDate(d.getDate()-1); }
  return n;
}

// ---------- notes (flat map, merges like status/ratings) ----------
export function notesFor(bookId){
  return Object.entries(notes).filter(([,n])=>n.bookId===bookId).map(([nid,n])=>({nid,...n}))
    .sort((a,b)=> (b.at||'').localeCompare(a.at||'') || 0);
}
export function addNote(bookId,text){ text=(text||'').trim(); if(!text) return null;
  const nid=newId('n_'); notes[nid]={bookId, at:Date.now(), text}; touch(nid); sNotes(); return nid; }
export function editNote(nid,text){ text=(text||'').trim(); if(!notes[nid]) return;
  if(!text){ deleteNote(nid); return; } notes[nid].text=text; notes[nid].editedAt=Date.now(); touch(nid); sNotes(); }
export function deleteNote(nid){ if(!notes[nid]) return; tomb(nid); delete notes[nid]; sNotes(); }

// ---------- reminders (flat map) ----------
export function remindersFor(bookId){
  return Object.entries(reminders).filter(([,r])=>r.bookId===bookId).map(([rid,r])=>({rid,...r}));
}
export function allReminders(){ return Object.entries(reminders).map(([rid,r])=>({rid,...r})).sort((a,b)=>a.at-b.at); }
export function dueReminders(){ const now=Date.now(); return allReminders().filter(r=>!r.done && r.at<=now); }
export function upcomingReminders(){ const now=Date.now(); return allReminders().filter(r=>!r.done && r.at>now); }
export function addReminder({bookId,title,at,note}){
  const rid=newId('r_'); reminders[rid]={bookId:bookId||null, title:(title||'').trim(), at:+at, note:(note||'').trim(), done:false};
  touch(rid); sRem(); return rid;
}
export function completeReminder(rid){ if(!reminders[rid]) return; reminders[rid].done=true; touch(rid); sRem(); }
export function snoozeReminder(rid,ms){ if(!reminders[rid]) return; reminders[rid].at=Date.now()+ms; reminders[rid].notifiedAt=null; touch(rid); sRem(); }
export function deleteReminder(rid){ if(!reminders[rid]) return; tomb(rid); delete reminders[rid]; sRem(); }
export function markNotified(rid){ if(!reminders[rid]) return; reminders[rid].notifiedAt=Date.now(); sRem(); }

// ---------- recommendations (purely from the user's own data; no network) ----------
export function recommendations(limit=6){
  const unread=allBooks().filter(x=>statusOf(x.b.id)==='unread');
  if(!unread.length) return [];
  const authorScore={};
  allBooks().forEach(({s,b})=>{
    const r=ratings[b.id]; if(!r) return;
    const a=(authorOf(s,b)||'').trim(); if(!a) return;
    authorScore[a]=Math.max(authorScore[a]||0,r);
  });
  const reading=new Set(readingList().map(x=>x.s.series));
  const scored=unread.map(({s,b})=>{
    let score=0, reason='';
    if(reading.has(s.series)){ score=100; reason='Next in '+s.series; }
    else {
      const a=(authorOf(s,b)||'').trim();
      if(a && authorScore[a]){ score=50+authorScore[a]*5; reason='You rated '+a+' '+authorScore[a]+'★'; }
      else { score=1; reason='In your library a while'; }
    }
    const d=det(b.id);
    if(!d.added) d.added=dataUpdatedAt||Date.now();
    return {s,b,score,reason,added:d.added||0};
  });
  scored.sort((x,y)=> y.score-x.score || x.added-y.added);
  // keep at most one pick per series so the list isn't dominated by one shelf
  const seen=new Set(), out=[];
  for(const item of scored){ if(seen.has(item.s.sid)) continue; seen.add(item.s.sid); out.push(item); if(out.length>=limit) break; }
  return out;
}

export function surprise(){
  const pool=allBooks().filter(x=>statusOf(x.b.id)==='unread');
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}
export function upNextList(){
  return allBooks().filter(x=>det(x.b.id).next && statusOf(x.b.id)==='unread');
}

// ---------- goal ----------
export function getGoal(){ try{ const g=JSON.parse(localStorage.getItem(K_GOAL)||'null');
  if(g && g.year===new Date().getFullYear() && g.target>0) return g; }catch(e){} return null; }
export function setGoalTarget(n){ n=Math.max(1,Math.round(+n||0)); if(!n) return;
  try{ localStorage.setItem(K_GOAL, JSON.stringify({year:new Date().getFullYear(), target:n})); }catch(e){} }
export function clearGoal(){ try{ localStorage.removeItem(K_GOAL); }catch(e){} }

// ---------- stats ----------
export function computeStats(){
  const st={read:0,reading:0,unread:0,dnf:0,rated:0,ratingSum:0,pages:0,chapters:0,
    byYear:{},authors:{},finishes:[],rereads:0};
  catalog.series.forEach(s=>s.books.forEach(b=>{
    const id=b.id, sta=statusOf(id), d=details[id]||{};
    st[sta]=(st[sta]||0)+1;
    const r=ratings[id]||0; if(r){ st.rated++; st.ratingSum+=r; }
    if(d.reads&&d.reads.length) st.rereads+=d.reads.length;
    const all=[].concat(d.reads||[], (sta==='read'&&d.finished)?[{finished:d.finished}]:[]);
    all.forEach(x=>{ if(!x.finished) return; const y=String(x.finished).slice(0,4);
      st.byYear[y]=(st.byYear[y]||0)+1; st.finishes.push(x.finished);
      const a=(authorOf(s,b)||'').trim(); if(a) st.authors[a]=(st.authors[a]||0)+1; });
    if(sta==='read'&&d.ptot){ if(d.fmt==='audio') st.chapters+=+d.ptot||0; else st.pages+=+d.ptot||0; }
  }));
  st.avg=st.rated?(st.ratingSum/st.rated):0;
  st.total=st.read+st.reading+st.unread+st.dnf;
  return st;
}

// ---------- backup nudge ----------
export function noteBackup(){ try{ localStorage.setItem(K_BKUP,String(Date.now())); }catch(e){} }
export function backupDue(){
  const st=computeStats(); if(st.total<10) return false;
  const last=+localStorage.getItem(K_BKUP)||0;
  if(last && Date.now()-last < BACKUP_EVERY) return false;
  if(!last){ noteBackup(); return false; }
  return true;
}

// ---------- import / export ----------
export function parseCSV(text){
  const rows=[]; let row=[], cur='', q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=c; }
    else if(c==='"') q=true;
    else if(c===','){ row.push(cur); cur=''; }
    else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
    else if(c!=='\r') cur+=c; }
  if(cur.length||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=>r.some(c=>c.trim()!==''));
}
function splitSeriesTitle(raw){
  const m=String(raw||'').match(/^(.*?)\s*\(([^()]*?),?\s*#([\d.]+)\s*\)\s*$/);
  if(m) return {title:m[1].trim(), series:m[2].trim().replace(/\s*,\s*$/,''), num:m[3]};
  return {title:String(raw||'').trim(), series:'', num:''};
}
function mapShelf(v){ const t=String(v||'').toLowerCase().replace(/[_-]/g,' ').trim();
  if(t==='read'||t==='finished') return 'read';
  if(t.indexOf('currently')===0||t==='reading') return 'reading';
  if(t.indexOf('did not finish')===0||t==='dnf') return 'dnf';
  return 'unread'; }
function normDate(v){ if(!v) return '';
  const t=String(v).trim(); let m=t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if(m) return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
  const d=new Date(t); if(!isNaN(d)) return ymd(d);
  return ''; }

export function importCSV(text){
  const rows=parseCSV(text); if(rows.length<2) return {added:0,skipped:0,error:'That CSV looks empty.'};
  const head=rows[0].map(h=>h.trim().toLowerCase().replace(/^﻿/,''));
  const col=(...names)=>{ for(const n of names){ const i=head.indexOf(n); if(i>=0) return i; } return -1; };
  const cT=col('title'), cA=col('author','authors','primary author'),
        cR=col('my rating','star rating','rating'), cS=col('exclusive shelf','read status','shelf','status'),
        cD=col('date read','last date read','date finished'), cP=col('number of pages','pages'),
        cN=col('my review','review','notes'), cSer=col('series');
  if(cT<0) return {added:0,skipped:0,error:'No Title column found in that CSV.'};
  let added=0, skipped=0;
  const existing=new Set();
  catalog.series.forEach(s=>s.books.forEach(b=>existing.add((s.series+'|'+b.title).toLowerCase())));
  rows.slice(1).forEach(r=>{
    const rawTitle=(r[cT]||'').trim(); if(!rawTitle) return;
    const parsed=splitSeriesTitle(rawTitle);
    let seriesName=(cSer>=0 && (r[cSer]||'').trim()) || parsed.series;
    const title=parsed.title || rawTitle;
    const author=cA>=0?(r[cA]||'').trim():'';
    if(!seriesName) seriesName='Standalone';
    if(existing.has((seriesName+'|'+title).toLowerCase())){ skipped++; return; }
    let s=findSeries(seriesName);
    if(!s){ s={sid:newId('s_'),series:seriesName,author,books:[]};
      const si=catalog.series.findIndex(x=>x.series==='Standalone');
      if(seriesName!=='Standalone' && si>=0) catalog.series.splice(si,0,s); else catalog.series.push(s);
      touch(s.sid); touch('__order'); }
    else if(!s.author && author){ s.author=author; touch(s.sid); }
    const entry={id:newId('b_'), num:(seriesName==='Standalone'?'':parsed.num||''), title};
    if(seriesName==='Standalone' && author) entry.author=author;
    if(entry.num) insertByNumber(s.books,entry); else s.books.push(entry);
    existing.add((seriesName+'|'+title).toLowerCase());
    const st=cS>=0?mapShelf(r[cS]):'unread';
    if(st!=='unread') status[entry.id]=st;
    const rt=cR>=0?parseFloat(r[cR]):0; if(rt>0) ratings[entry.id]=Math.max(1,Math.min(5,Math.round(rt)));
    const d={};
    const fin=cD>=0?normDate(r[cD]):''; if(fin && st==='read') d.finished=fin;
    const pg=cP>=0?parseInt(r[cP],10):0; if(pg>0) d.ptot=pg;
    const rv=cN>=0?(r[cN]||'').trim():''; if(rv) d.notes=rv;
    if(Object.keys(d).length) details[entry.id]=d;
    touch(entry.id); touch(s.sid); added++;
  });
  if(added){ ensureStandalone(); sCat(); sSt(); sRt(); sDet(); migrateLegacyNotes(); }
  return {added,skipped};
}

function parseLine(raw){ let t=(raw||'').trim(); if(!t) return null; t=t.replace(/^[-*•]\s+/,'');
  const m=t.match(/^(\d+(?:\.\d+)?)[.)]?\s+(.+)$/);
  if(m) return {num:m[1],title:m[2].trim()};
  return {num:'',title:t};
}
export function importTxt(text){
  const lines=String(text).split(/\r?\n/);
  let mode='series', cur=null, added=0, skipped=0;
  const existing=new Set();
  catalog.series.forEach(s=>s.books.forEach(b=>existing.add((s.series+'|'+b.title).toLowerCase())));
  const addTo=(sname,num,title,bauthor)=>{
    if(!title) return;
    if(existing.has((sname+'|'+title).toLowerCase())){ skipped++; return; }
    let s=findSeries(sname);
    if(!s){ s={sid:newId('s_'),series:sname,author:'',books:[]};
      const si=catalog.series.findIndex(x=>x.series==='Standalone');
      if(sname!=='Standalone'&&si>=0) catalog.series.splice(si,0,s); else catalog.series.push(s);
      touch(s.sid); touch('__order'); }
    const e={id:newId('b_'),num:num||'',title}; if(bauthor) e.author=bauthor;
    if(e.num) insertByNumber(s.books,e); else s.books.push(e);
    existing.add((sname+'|'+title).toLowerCase()); touch(e.id); touch(s.sid); added++;
  };
  lines.forEach(raw=>{
    const line=raw.replace(/\s+$/,''); if(!line.trim()) return;
    const t=line.trim();
    if(/^my reading list$/i.test(t)) return;
    if(/^book series$/i.test(t)){ mode='series'; cur=null; return; }
    if(/^stand ?alone books$/i.test(t)){ mode='single'; cur=null; return; }
    if(mode==='single'){ const dash=t.split(' - '); const ttl=dash[0].trim(); const au=dash.length>1?dash.slice(1).join(' - ').trim():'';
      if(ttl) addTo('Standalone','',ttl,au); return; }
    if(/^[\t ]{1,}/.test(line) && cur){ const p=parseLine(t); if(p) addTo(cur,p.num,p.title); return; }
    const dash=t.split(' - ');
    const name=dash[0].trim(); const auth=dash.length>1?dash.slice(1).join(' - ').trim():'';
    cur=name; let s=findSeries(name);
    if(!s){ s={sid:newId('s_'),series:name,author:auth,books:[]};
      const si=catalog.series.findIndex(x=>x.series==='Standalone');
      if(si>=0) catalog.series.splice(si,0,s); else catalog.series.push(s); touch(s.sid); touch('__order'); }
    else if(auth && !s.author){ s.author=auth; touch(s.sid); }
  });
  if(added){ ensureStandalone(); sCat(); sSt(); sRt(); sDet(); }
  return {added,skipped};
}
export function addList(sn,text){
  const s=findSeries(sn); if(!s) return {added:0,error:'Pick a series to paste into.'};
  let added=0;
  String(text).split(/\r?\n/).forEach(raw=>{
    const p=parseLine(raw); if(!p || !p.title) return;
    const entry={id:newId('b_'), num:p.num, title:p.title};
    if(entry.num) insertByNumber(s.books,entry); else s.books.push(entry);
    touch(entry.id); added++;
  });
  if(added){ touch(s.sid); sCat(); }
  return {added};
}

export function exportTxt(){
  const out=['My Reading List','',''];
  const singles=findSeries('Standalone');
  const seriesList=catalog.series.filter(s=>s.series!=='Standalone' && s.books.length);
  if(seriesList.length){ out.push('Book Series',''); seriesList.forEach(s=>{
    out.push(s.series+(s.author?' - '+s.author:''));
    s.books.forEach(b=>out.push('\t'+(b.num?b.num+'. ':'')+displayTitle(b)));
    out.push(''); }); }
  if(singles && singles.books.length){ out.push('Standalone Books',''); singles.books.forEach(b=>{
    out.push(displayTitle(b)+(b.author?' - '+b.author:'')); }); }
  return out.join('\n');
}
export function exportMarkdown(){
  const out=['# The Reading Desk','', '_'+computeStats().read+' finished · exported '+fmtDate(today())+'_',''];
  catalog.series.forEach(s=>{
    if(!s.books.length) return;
    out.push('## '+s.series+(s.author?' — '+s.author:''),'');
    s.books.forEach(b=>{
      const id=b.id, st=statusOf(id), d=details[id]||{}, r=ratings[id]||0;
      const box=st==='read'?'x':' ';
      let line='- ['+box+'] '+(b.num?b.num+'. ':'')+displayTitle(b);
      const bits=[];
      if(r) bits.push('★'.repeat(r));
      if(d.fmt==='audio') bits.push('audiobook');
      if(d.fmt==='manga') bits.push('manga');
      if(st==='reading') bits.push('reading');
      if(st==='dnf') bits.push('set aside');
      if(d.finished) bits.push('finished '+fmtDate(d.finished));
      if(d.reads&&d.reads.length) bits.push('read '+(d.reads.length+1)+'×');
      if(bits.length) line+='  — '+bits.join(' · ');
      out.push(line);
      const bookNotes=notesFor(id);
      bookNotes.forEach(n=>out.push('  > '+String(n.text).replace(/\n/g,'\n  > ')));
    });
    out.push('');
  });
  return out.join('\n');
}
export function exportCSV(){
  const esc=v=>{ const t=String(v==null?'':v); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; };
  const rows=[['Series','Author','Number','Title','Format','Status','Rating','Started','Finished','Progress','Total','Times read','Notes']];
  catalog.series.forEach(s=>s.books.forEach(b=>{
    const id=b.id, d=details[id]||{};
    const noteText=notesFor(id).map(n=>n.text).join(' / ');
    rows.push([s.series,authorOf(s,b),b.num,displayTitle(b),(d.fmt==='audio'?'Audiobook':d.fmt==='manga'?'Manga':'Book'),
      ST_LABEL[statusOf(id)]||'Unread', ratings[id]||'', d.started||'', d.finished||'',
      d.pcur||'', d.ptot||'', (d.reads?d.reads.length+1:(statusOf(id)==='read'?1:0)), noteText]);
  }));
  return rows.map(r=>r.map(esc).join(',')).join('\n');
}

// ---------- duplicate series merge ----------
function normName(n){ return String(n||'').trim().toLowerCase(); }
function bookKey(b){ return (String(b.num||'').trim())+'|'+String(b.title||'').trim().toLowerCase(); }
function progScore(id){ let n=0; if(ratings[id]!=null) n+=2;
  const d=details[id]; if(d){ if(d.started)n++; if(d.finished)n++; if(d.ptot)n++; if(d.notes)n++; if(d.reads&&d.reads.length)n+=2; }
  if(status[id] && status[id]!=='unread') n++;
  return n; }
export function countDuplicates(){
  const byName={}; catalog.series.forEach(s=>{ const k=normName(s.series); (byName[k]=byName[k]||[]).push(s); });
  return Object.values(byName).filter(g=>g.length>1).length;
}
export function mergeDuplicatesNow(){
  const byName={}; catalog.series.forEach(s=>{ const k=normName(s.series); (byName[k]=byName[k]||[]).push(s); });
  let merges=0;
  Object.values(byName).forEach(group=>{
    if(group.length<2) return;
    group.sort((a,b)=> (b.books||[]).reduce((n,x)=>n+progScore(x.id),0) - (a.books||[]).reduce((n,x)=>n+progScore(x.id),0));
    const keep=group[0];
    for(let i=1;i<group.length;i++){
      const dupe=group[i];
      const haveKeys=new Set(keep.books.map(bookKey));
      dupe.books.forEach(b=>{
        if(haveKeys.has(bookKey(b))) { tomb(b.id); return; }
        keep.books.push(b); haveKeys.add(bookKey(b));
      });
      if(!keep.author && dupe.author) keep.author=dupe.author;
      tomb(dupe.sid);
      catalog.series.splice(catalog.series.indexOf(dupe),1);
      merges++;
    }
    touch(keep.sid);
  });
  if(merges) sCat();
  return merges;
}

export function syncPayload(){ return {version:6, updatedAt:dataUpdatedAt, meta, catalog}; }
export function progressPayload(){ return {version:6, updatedAt:dataUpdatedAt, status, ratings, details, activeDays, notes, reminders}; }
export function backupPayload(){ return {version:6, catalog, status, ratings, details, meta, activeDays, notes, reminders}; }

// ---------- restore from a downloaded backup .json ----------
// Handles three shapes: a full catalog+progress backup, a progress-only file
// (recovers ratings/status/notes by id without touching the catalog), or a
// bare legacy {id: status} map from the very oldest exports.
export function restoreBackup(p){
  const hasCat = p && p.catalog && Array.isArray(p.catalog.series);
  const hasProg = p && (p.status||p.ratings||p.details||p.notes||p.reminders);
  if(hasCat){
    setCatalog(p.catalog);
    if(hasProg){
      setStatus(p.status||{}); setRatings(p.ratings||{}); setDetails(p.details||{});
      setNotes(p.notes||{}); setReminders(p.reminders||{});
    }
    if(p.meta && p.meta.t) setMeta(p.meta);
    if(p.activeDays) setActiveDays(Object.assign({}, activeDays, p.activeDays));
    normalizeCatalog(); ensureStandalone();
    meta.del={}; const now=Date.now();
    catalog.series.forEach(s=>{ meta.t[s.sid]=now; (s.books||[]).forEach(b=>meta.t[b.id]=now); });
    meta.t['__order']=now; sMeta();
    sCat(); sSt(); sRt(); sDet(); sNotes(); sRem(); saveDays();
    return {mode:'full'};
  }
  if(hasProg){
    let hits=0; const now=Date.now();
    Object.entries(p.status||{}).forEach(([id,v])=>{ status[id]=v; });
    Object.entries(p.ratings||{}).forEach(([id,v])=>{ if(v) ratings[id]=v; });
    Object.entries(p.details||{}).forEach(([id,v])=>{ if(v && Object.keys(v).length) details[id]=v; });
    Object.entries(p.notes||{}).forEach(([nid,v])=>{ if(v) notes[nid]=v; });
    const live=new Set(); catalog.series.forEach(s=>s.books.forEach(b=>live.add(b.id)));
    const ids=[...new Set([].concat(Object.keys(p.status||{}),Object.keys(p.ratings||{}),Object.keys(p.details||{})))];
    ids.forEach(id=>{ meta.t[id]=now; delete meta.del[id]; if(live.has(id)) hits++; });
    sSt(); sRt(); sDet(); sNotes(); sMeta();
    return {mode:'progress', hits, total:ids.length};
  }
  if(p && typeof p==='object'){
    setStatus(p); setRatings({}); setDetails({}); ensureStandalone();
    sSt(); sRt(); sDet();
    return {mode:'legacy'};
  }
  return {mode:'invalid'};
}
