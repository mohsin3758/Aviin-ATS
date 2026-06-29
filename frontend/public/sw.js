const CACHE='aviin-v1';
const STATIC=['/','/dashboard','/candidates','/pipeline','/offline.html'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||e.request.url.includes('/api/'))return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>caches.match('/offline.html'))));});