// فلو باي — Service Worker
// HTML: الشبكة أولاً (حتى تصل التحديثات فوراً) ثم الكاش عند انقطاع النت.
// باقي الملفات: الكاش أولاً — روابطها تحمل رقم الإصدار (?v=) فلا تختلط نسختان.
const VERSION = '__BUILD__';
const CACHE = 'flowpay-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './app.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './native.js?v=' + VERSION,
  './vendor/qrcode.js',
  './vendor/jsQR.js',
  './manifest.json',
  './privacy.html',
  './img/logo.png',
  './icons/icon-192.png',
  './icons/favicon.png',
  './img/og-image.png'
];
// شعارات المحافظ قد لا تكون موجودة — لا نُفشل التثبيت بسببها
const OPTIONAL = ['./img/jawwalpay.png', './img/palpay.png', './img/bop.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(ASSETS).then(() => Promise.allSettled(OPTIONAL.map(u => cache.add(u))))
  ));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(req, cacheKey) {
  return fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(cacheKey || req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // رابط الدفع (?svc=...) يُخدم من نفس index.html
    const key = url.pathname.endsWith('/') ? './index.html' : req;
    e.respondWith(
      fromNetwork(req, key).catch(() =>
        caches.match(key, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))
      )
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => cached || fromNetwork(req).catch(() =>
      new Response('', { status: 503, statusText: 'offline' })
    ))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
