const CACHE = 'cinox-v1';
const STATIC = [
  '/',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Ne pas mettre en cache les requêtes API, socket.io, ou les uploads
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/socket.io') ||
      url.pathname.startsWith('/uploads/') ||
      e.request.method !== 'GET') {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Notifications push (futur)
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  self.registration.showNotification(data.title || 'CinoX', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    data: data
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
