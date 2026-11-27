const CACHE='yunas-insurance-shell-1';
const BASE=new URL('./',self.location.href);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    const response=await fetch(new URL('offline-files.json',BASE),{cache:'reload'});
    if (!response.ok) throw new Error('오프라인 파일 목록을 읽을 수 없습니다.');
    const paths=await response.json();
    await cache.addAll(paths.map(path=>new URL(path,BASE).href));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith('yunas-insurance-shell-')&&name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if (event.request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if (event.request.mode==='navigate') {
      try {
        const response=await fetch(event.request);
        if (response.ok) return response;
      } catch {}
      return (await cache.match(new URL('index.html',BASE).href))||Response.error();
    }
    return (await cache.match(event.request))||fetch(event.request);
  })());
});
