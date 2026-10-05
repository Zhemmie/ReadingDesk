// sync.js — GitHub Gist sync. Ported from the previous app, extended to carry
// notes + reminders. Per-item merge (newest edit wins, field by field;
// deletions stick via tombstones) so two devices never silently clobber
// each other.
import * as S from './store.js';

const GIST_FILE='reading-desk.json';
const GIST_PROG='reading-desk-progress.json';
const DEVICE_STAMP_GAP=15*60*1000;

export let syncToken=localStorage.getItem(S.SK_TOKEN)||'';
export let gistId=localStorage.getItem(S.SK_GIST)||'';
export let lastSyncAt=+localStorage.getItem(S.SK_LAST)||0;
export let syncing=false, dirty=false, syncMsg='';
let pushTimer=null, lastSent={cat:'',prog:''};

let onChange=null;
export function onSyncChange(cb){ onChange=cb; }
function notify(){ if(onChange) onChange(); }

function guessDeviceName(){
  const ua=navigator.userAgent||''; const plat=navigator.platform||'';
  let os = /iPhone|iPad|iPod/.test(ua)?'iPhone/iPad' : /Android/.test(ua)?'Android' :
    /Mac/.test(plat)?'Mac' : /Win/.test(plat)?'Windows' : /Linux/.test(plat)?'Linux' : 'this device';
  let browser = /Edg\//.test(ua)?'Edge' : /OPR\//.test(ua)?'Opera' : /Chrome\//.test(ua)?'Chrome' :
    /Firefox\//.test(ua)?'Firefox' : /Safari\//.test(ua)?'Safari' : 'Browser';
  return browser+' on '+os;
}
export let DEV_ID=localStorage.getItem(S.SK_DEVID)||'';
if(!DEV_ID){ DEV_ID='d_'+Date.now().toString(36)+Math.random().toString(36).slice(2,9); try{localStorage.setItem(S.SK_DEVID,DEV_ID);}catch(e){} }
export let devName=localStorage.getItem(S.SK_DEVNAME)||guessDeviceName();
export function setDevName(n){ n=(n||'').trim()||guessDeviceName(); devName=n; try{localStorage.setItem(S.SK_DEVNAME,devName);}catch(e){}
  stampDevice(); S.sMeta(); notify();
  if(syncToken) pushNow(true).then(notify).catch(e=>{ syncMsg=friendlyError(e); notify(); }); }
function stampDevice(){ S.meta.devices=S.meta.devices||{}; S.meta.devices[DEV_ID]={name:devName,lastSyncAt:Date.now()}; S.touch(DEV_ID); }
export function removeDevice(devId){
  const rec=(S.meta.devices||{})[devId]; if(!rec) return;
  delete S.meta.devices[devId]; S.tomb(devId); S.sMeta(); notify();
  const restore=()=>{ S.meta.devices=S.meta.devices||{}; S.meta.devices[devId]=rec; S.touch(devId); S.sMeta();
    if(syncToken) pushNow(true).catch(()=>{}); notify(); };
  if(syncToken) pushNow(true).then(notify).catch(e=>{ syncMsg=friendlyError(e); notify(); });
  return {name:rec.name, undo:restore};
}

function isIdd(cat){ return !!(cat && Array.isArray(cat.series) &&
  cat.series.every(s=>s.sid && (s.books||[]).every(b=>b.id))); }

// legacy fallback: a copy still in the old wholesale format overwrites by timestamp
function applyPayload(p){
  S.setApplyingRemote(true);
  S.setCatalog(p.catalog||{series:[]}); S.setStatus(p.status||{}); S.setRatings(p.ratings||{}); S.setDetails(p.details||{});
  S.setActiveDays(Object.assign({}, S.activeDays, p.activeDays||{})); S.saveDays();
  S.setNotes(p.notes||S.notes||{}); S.setReminders(p.reminders||S.reminders||{});
  S.setDataUpdatedAt(+p.updatedAt||Date.now());
  S.normalizeCatalog();
  Object.keys(S.details).forEach(id=>{ if(S.details[id] && S.details[id].cover && S.statusOf(id)!=='reading') delete S.details[id].cover; });
  S.sCat(); S.sSt(); S.sRt(); S.sDet(); S.sNotes(); S.sRem();
  S.setApplyingRemote(false);
}

function mergeRemote(R){
  if(!isIdd(R.catalog)){ applyPayload(R); return {mode:'replaced'}; }
  S.setApplyingRemote(true);
  const rm=(R.meta&&R.meta.t)?R.meta:{t:{},del:{}};
  const RT=k=>+(rm.t||{})[k]||0, LT=k=>+(S.meta.t||{})[k]||0;
  const RD=k=>+(rm.del||{})[k]||0, LD=k=>+(S.meta.del||{})[k]||0;
  const gone=k=>Math.max(RD(k),LD(k))>Math.max(RT(k),LT(k));

  const L=new Map(), Rs=new Map();
  (S.catalog.series||[]).forEach(s=>L.set(s.sid,s));
  (R.catalog.series||[]).forEach(s=>Rs.set(s.sid,s));

  const merged=[];
  const allSids=[...new Set([...L.keys(),...Rs.keys()])];
  allSids.forEach(sid=>{
    if(gone(sid)) return;
    const a=L.get(sid), b=Rs.get(sid);
    if(!a && !b) return;
    if(!a){ merged.push(structuredClone(b)); return; }
    if(!b){ merged.push(a); return; }
    const remoteNewer=RT(sid)>LT(sid);
    const out={sid, series:(remoteNewer?b.series:a.series), author:(remoteNewer?b.author:a.author), books:[]};
    const bl=new Map(), br=new Map();
    (a.books||[]).forEach(x=>bl.set(x.id,x));
    (b.books||[]).forEach(x=>br.set(x.id,x));
    const orderSrc=remoteNewer?(b.books||[]):(a.books||[]);
    const otherSrc=remoteNewer?(a.books||[]):(b.books||[]);
    const seen=new Set();
    const pick=id=>{ const x=bl.get(id), y=br.get(id);
      if(x&&y) return RT(id)>LT(id)?structuredClone(y):x;
      return x||structuredClone(y); };
    orderSrc.forEach(x=>{ if(gone(x.id)||seen.has(x.id)) return; seen.add(x.id); out.books.push(pick(x.id)); });
    otherSrc.forEach(x=>{ if(gone(x.id)||seen.has(x.id)) return; seen.add(x.id); out.books.push(pick(x.id)); });
    merged.push(out);
  });

  if(RT('__order')>LT('__order')){
    const seq=(R.catalog.series||[]).map(s=>s.sid);
    merged.sort((x,y)=>{ const i=seq.indexOf(x.sid), j=seq.indexOf(y.sid);
      return (i<0?1e9:i)-(j<0?1e9:j); });
  }
  S.setCatalog({series:merged});

  const mergeMap=(local,remote)=>{ const out={};
    [...new Set([...Object.keys(local||{}),...Object.keys(remote||{})])].forEach(k=>{
      if(gone(k)) return;
      const v=RT(k)>LT(k) ? (remote||{})[k] : (local||{})[k];
      if(v!==undefined) out[k]=v; });
    return out; };
  S.setStatus(mergeMap(S.status,R.status));
  S.setRatings(mergeMap(S.ratings,R.ratings));
  S.setDetails(mergeMap(S.details,R.details));
  S.setNotes(mergeMap(S.notes,R.notes));
  S.setReminders(mergeMap(S.reminders,R.reminders));
  S.setActiveDays(Object.assign({}, S.activeDays, R.activeDays||{})); S.saveDays();
  Object.keys(S.details).forEach(id=>{ if(S.details[id] && S.details[id].cover && S.statusOf(id)!=='reading') delete S.details[id].cover; });

  const t={}, del={};
  [...new Set([...Object.keys(S.meta.t||{}),...Object.keys(rm.t||{})])].forEach(k=>{ const v=Math.max(LT(k),RT(k)); if(v) t[k]=v; });
  [...new Set([...Object.keys(S.meta.del||{}),...Object.keys(rm.del||{})])].forEach(k=>{ const v=Math.max(LD(k),RD(k)); if(v) del[k]=v; });
  const devices={};
  const rDevs=(rm.devices)||{}, lDevs=S.meta.devices||{};
  [...new Set([...Object.keys(lDevs),...Object.keys(rDevs)])].forEach(k=>{
    if(gone(k)) return;
    const a=lDevs[k], b=rDevs[k];
    devices[k] = (!a) ? b : (!b) ? a : ((+b.lastSyncAt||0) > (+a.lastSyncAt||0) ? b : a); });
  S.setMeta({t,del,devices});

  const live=new Set(); S.catalog.series.forEach(s=>s.books.forEach(b=>live.add(b.id)));
  [S.status,S.ratings,S.details].forEach(m=>Object.keys(m).forEach(k=>{ if(!live.has(k)) delete m[k]; }));
  Object.keys(S.notes).forEach(nid=>{ if(!live.has(S.notes[nid].bookId)) delete S.notes[nid]; });

  S.ensureStandalone(); S.normalizeCatalog();
  S.setDataUpdatedAt(Math.max(S.dataUpdatedAt, +R.updatedAt||0));
  S.sCat(); S.sSt(); S.sRt(); S.sDet(); S.sNotes(); S.sRem(); S.sMeta();
  S.setApplyingRemote(false);
  return {mode:'merged'};
}

function friendlyError(e){
  const msg=String((e&&e.message)||e||'');
  if(/Failed to fetch|NetworkError|network/i.test(msg)) return 'Can’t reach GitHub right now. Check your connection and try again.';
  const m=msg.match(/(\d{3})\s*$/); const code=m?+m[1]:0;
  if(code===401) return 'That token isn’t valid anymore. Reconnect with a fresh one from github.com/settings/tokens.';
  if(code===403) return 'GitHub turned that down — either the token is missing the “gist” scope, or too many requests went out. Wait a bit and try again.';
  if(code===404) return 'The cloud copy couldn’t be found. It may have been deleted — try “Reconnect to shared copy” below.';
  if(code>=500) return 'GitHub’s servers are having trouble right now. Try again shortly.';
  return 'Something went wrong talking to GitHub. Try again, and if it keeps happening, disconnect and reconnect.';
}
function ghFetch(url,opts,keepalive){ opts=opts||{}; return fetch(url,Object.assign({},opts,{keepalive:!!keepalive,headers:Object.assign(
  {'Authorization':'Bearer '+syncToken,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}, opts.headers||{})})); }
function gistSize(g){ let n=0; [GIST_FILE,GIST_PROG].forEach(f=>{ if(g.files&&g.files[f]) n+=g.files[f].size||0; }); return n; }
async function findGist(){ const r=await ghFetch('https://api.github.com/gists?per_page=100'); if(!r.ok) return null;
  const arr=await r.json(); if(!Array.isArray(arr)) return null;
  const cands=arr.filter(x=>x.files&&x.files[GIST_FILE]);
  if(!cands.length) return null;
  cands.sort((a,b)=> gistSize(b)-gistSize(a) || String(a.id).localeCompare(String(b.id)));
  return cands[0].id; }

function stampDeviceIfDue(force){
  const rec=(S.meta.devices||{})[DEV_ID];
  const due = force || !rec || (Date.now()-(+rec.lastSyncAt||0))>DEVICE_STAMP_GAP;
  if(due){ stampDevice(); S.sMeta(); }
}
function changedFiles(force){
  stampDeviceIfDue(force);
  const cat=JSON.stringify(S.syncPayload()), prog=JSON.stringify(S.progressPayload());
  const files={};
  if(cat!==lastSent.cat) files[GIST_FILE]={content:cat};
  if(prog!==lastSent.prog) files[GIST_PROG]={content:prog};
  return {files, cat, prog};
}
async function createGist(force,keepalive){ const {cat,prog}=changedFiles(force);
  const body={description:'The Reading Desk data — synced automatically, do not edit by hand',public:false,
    files:{[GIST_FILE]:{content:cat},[GIST_PROG]:{content:prog}}};
  const r=await ghFetch('https://api.github.com/gists',{method:'POST',body:JSON.stringify(body)},keepalive);
  if(!r.ok) throw new Error('create '+r.status); const j=await r.json();
  gistId=j.id; localStorage.setItem(S.SK_GIST,gistId); lastSent={cat,prog};
  clearDirty(); return j; }
export async function pushNow(force,keepalive){ if(!syncToken) return; if(!gistId){ await createGist(force,keepalive); markSynced(); return; }
  const {files,cat,prog}=changedFiles(force);
  if(!Object.keys(files).length){ clearDirty(); markSynced(); return; }
  const r=await ghFetch('https://api.github.com/gists/'+gistId,{method:'PATCH',body:JSON.stringify({files})},keepalive);
  if(r.status===404){ gistId=''; localStorage.removeItem(S.SK_GIST); lastSent={cat:'',prog:''}; await createGist(force,keepalive); markSynced(); return; }
  if(!r.ok) throw new Error('push '+r.status);
  lastSent={cat,prog}; clearDirty(); markSynced(); }
async function readGistFile(j,name){ const f=j.files&&j.files[name]; if(!f) return null;
  let content=f.content; if(f.truncated&&f.raw_url){ const rr=await fetch(f.raw_url); content=await rr.text(); }
  try{ return JSON.parse(content); }catch(e){ return null; } }
async function pullRemote(){ const r=await ghFetch('https://api.github.com/gists/'+gistId);
  if(r.status===404) return null; if(!r.ok) throw new Error('pull '+r.status);
  const j=await r.json();
  const head=await readGistFile(j,GIST_FILE); if(!head) return null;
  const prog=await readGistFile(j,GIST_PROG);
  if(prog){ head.status=prog.status; head.ratings=prog.ratings; head.details=prog.details; head.activeDays=prog.activeDays;
    head.notes=prog.notes; head.reminders=prog.reminders;
    head.updatedAt=Math.max(+head.updatedAt||0, +prog.updatedAt||0); }
  return head; }
function markSynced(){ lastSyncAt=Date.now(); try{localStorage.setItem(S.SK_LAST,String(lastSyncAt));}catch(e){} }

function markDirty(){ if(!syncToken) return; dirty=true; notify(); }
function clearDirty(){ dirty=false; notify(); }
export function schedulePush(){ if(!syncToken) return; clearTimeout(pushTimer); pushTimer=setTimeout(()=>{ pushNow().then(notify).catch(e=>{ syncMsg=friendlyError(e); notify(); }); }, 2500); }
S.onSave(()=>{ markDirty(); schedulePush(); });

// The 2.5s debounce above exists to batch rapid-fire edits into one API
// call, but it's just a setTimeout — if the tab gets backgrounded or the
// PWA gets swiped away before it fires (the common case on a phone: mark a
// book done, then immediately switch apps), the scheduled push never runs
// and the change just sits there until something syncs again. Flush
// immediately on both signals, with keepalive so the request has a chance
// to actually finish while the page is being torn down.
function flushPendingPush(){
  if(!syncToken || !dirty || syncing) return;
  clearTimeout(pushTimer); pushTimer=null;
  pushNow(false,true).then(notify).catch(e=>{ syncMsg=friendlyError(e); notify(); });
}
if(typeof document!=='undefined'){
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushPendingPush(); });
  window.addEventListener('pagehide',flushPendingPush);
}

export async function syncNow(manual){
  if(!syncToken){ syncMsg='Add a token to connect.'; notify(); return; }
  if(syncing) return; syncing=true; syncMsg='Syncing…'; notify();
  try{
    if(!gistId){ const found=await findGist(); if(found){ gistId=found; localStorage.setItem(S.SK_GIST,gistId); } }
    if(!gistId){ await createGist(manual); markSynced(); syncMsg='Connected · cloud copy created'; }
    else {
      const remote=await pullRemote();
      if(!remote){ await pushNow(manual); syncMsg='Connected · pushed your library up'; }
      else{ const rt=+remote.updatedAt||0;
        const res=mergeRemote(remote);
        if(res.mode==='replaced'){ markSynced(); syncMsg='Updated from the cloud'; await pushNow(manual); }
        else { await pushNow(manual); markSynced();
          syncMsg=rt>lastSyncAt?'Merged changes from your other devices':'Up to date'; } }
    }
  }catch(e){ syncMsg=friendlyError(e); }
  syncing=false; notify();
}
export function connectToken(tok){ tok=(tok||'').trim();
  if(!tok) return {ok:false, msg:'Paste a token first.'};
  const warn = !/^(ghp_|github_pat_)/.test(tok) ?
    'That doesn’t look like a GitHub token — classic tokens start with “ghp_”. Double-check you copied the whole thing.' : null;
  syncToken=tok; localStorage.setItem(S.SK_TOKEN,syncToken); gistId=localStorage.getItem(S.SK_GIST)||''; syncNow(true);
  return {ok:true, warn};
}
export function disconnectSync(){ syncToken=''; localStorage.removeItem(S.SK_TOKEN); localStorage.removeItem(S.SK_GIST); gistId='';
  syncMsg=''; notify(); }

export async function reconnectSharedGist(){
  if(!syncToken){ syncMsg='Add a token to connect.'; notify(); return; }
  syncing=true; syncMsg='Reconnecting…'; notify();
  try{
    const found=await findGist();
    if(!found){ syncMsg='No shared copy found on this account yet.'; syncing=false; notify(); return; }
    gistId=found; localStorage.setItem(S.SK_GIST,gistId); lastSent={cat:'',prog:''};
    const remote=await pullRemote();
    if(remote) mergeRemote(remote);
    markSynced(); syncMsg='Reconnected to the shared copy';
  }catch(e){ syncMsg=friendlyError(e); }
  syncing=false; notify();
}
export function isConnected(){ return !!syncToken; }
export { friendlyError };
