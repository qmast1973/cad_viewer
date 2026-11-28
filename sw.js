// CAD 뷰어 서비스 워커: ① 앱 파일을 폰·PC 에 저장해 인터넷 없이도 열림(오프라인) ② 설치한 앱으로 "공유 → CAD 뷰어" 로 DWG·DXF 를 바로 열기(share target).
// 고칠 때마다 VER 을 화면 버전(index.html 의 #appVersion)과 같이 올린다 → 옛 캐시가 지워지고 새 파일이 내려온다.
const VER = 'v1.23';
const CACHE = 'cadviewer-' + VER;
const SHARED = 'cadviewer-shared';
const CORE = ['./', 'index.html', 'cad-tools.js', 'dwg-worker.js', 'vendor/cad-vendor.bundle.js', 'wasm/dwg2lite.wasm', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('cadviewer-') && k !== CACHE && k !== SHARED).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function handleShare(req) {
  try {
    const fd = await req.formData();
    const f = fd.get('file');
    if (f && f.size) {
      const c = await caches.open(SHARED);
      await c.put(self.registration.scope + 'shared-file', new Response(f, { headers: { 'X-File-Name': encodeURIComponent(f.name || 'shared.dwg'), 'Content-Type': 'application/octet-stream' } }));
    }
  } catch (err) { /* 공유 파일을 못 읽어도 앱은 열어 준다 */ }
  return Response.redirect(self.registration.scope + 'index.html?pwa=1&shared=1', 303);
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
    return res;
  } catch (err) {
    return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(handleShare(req)); return; }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;                 // 이 PC 의 로컬 서버 API 는 건드리지 않는다
  e.respondWith(/\.wasm$|\/vendor\//.test(url.pathname) ? cacheFirst(req) : networkFirst(req));
});
