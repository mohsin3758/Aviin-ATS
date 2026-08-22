const CACHE='aviin-v2';
// BUG FIX (2026-08-22, found while verifying Reminder System Phase 2 push
// notifications): '/' 307-redirects to '/dashboard' (an unauthenticated
// visitor gets redirected client-side, but the raw HTTP response itself
// is a 307), and Cache.addAll() rejects the ENTIRE call atomically if any
// one of its URLs doesn't fetch as a plain 2xx — confirmed directly via a
// real cache.addAll() probe (same call with '/' -> "Request failed";
// without it -> succeeds cleanly). This meant the 'install' event's
// waitUntil() promise had been rejecting on every single page load since
// this service worker was first built, so it never activated — the whole
// PWA offline-support feature (and now, push notifications, which need a
// real activated SW registration) had silently never worked, on any
// page, ever. Cache version bumped so returning visitors' already-broken
// registration (permanently stuck installing, never active) gets
// replaced rather than staying wedged.
const STATIC=['/dashboard','/candidates','/pipeline','/offline.html'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||e.request.url.includes('/api/'))return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>caches.match('/offline.html'))));});

// Reminder System Phase 2 — real browser push (W3C Push API + VAPID).
self.addEventListener('push',e=>{
  let data={title:'AVIIN ATS',body:'You have a new notification.',url:'/reminders'};
  try{if(e.data)data={...data,...e.data.json()};}catch(_){}
  e.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',
    data:{url:data.url||'/reminders'},
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/reminders';
  e.waitUntil(self.clients.matchAll({type:'window'}).then(list=>{
    for(const c of list){if(c.url.includes(url)&&'focus' in c)return c.focus();}
    if(self.clients.openWindow)return self.clients.openWindow(url);
  }));
});