const CACHE='reading-desk-v71';
const ASSETS=['./','./index.html','./manifest.webmanifest',
  './icon-192.png','./icon-512.png','./icon-180.png','./icon-maskable-512.png',
  './css/base.css','./css/theme-library.css','./css/theme-cyberpunk.css','./css/fonts.css','./css/fonts-cyberpunk.css',
  './js/store.js','./js/sync.js','./js/app.js','./js/covers.js','./js/discover.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{ if(e.data==='skipWaiting') self.skipWaiting(); });
function isDoc(req){ return req.mode==='navigate' || (req.headers.get('accept')||'').includes('text/html'); }
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET') return;
  if(isDoc(req)){
    // network-first for the page: fresh HTML whenever online, cached copy offline
    e.respondWith(
      fetch(req).then(resp=>{ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put('./index.html',cp)); return resp; })
      .catch(()=> caches.match('./index.html').then(r=> r || caches.match('./')))
    );
    return;
  }
  // cache-first for static assets (css/js/icons/manifest)
  e.respondWith(
    caches.match(req).then(r=> r || fetch(req).then(resp=>{
      if(resp && resp.status===200 && resp.type==='basic'){ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(req,cp)); }
      return resp;
    }))
  );
});
