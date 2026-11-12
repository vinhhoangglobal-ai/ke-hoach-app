// Service worker: lưu vỏ app để mở được khi mạng yếu. Dữ liệu luôn lấy mới, không cache.
const CACHE = 'khkh-v3';
const VO_APP = [
  './', './index.html', './style.css', './app.js', './lib.js', './store.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(VO_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // Mạng trước (để nhận bản app mới ngay), rớt mạng thì dùng bản đã lưu.
  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const ban = res.clone();
          caches.open(CACHE).then((c) => c.put(req, ban));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});
