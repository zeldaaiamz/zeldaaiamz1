// Only public tool/report HTML navigations. No caching, Supabase or other tool interception.
const RELEASE='management-20261014-1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||request.mode!=='navigate'||url.origin!==self.location.origin||!/(?:\/tool\/|\/report\/)(?:index\.html)?$/.test(url.pathname))return;url.searchParams.set('v',RELEASE);event.respondWith(fetch(url.href,{cache:'no-store',credentials:'same-origin'}));});
