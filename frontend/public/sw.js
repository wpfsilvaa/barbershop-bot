self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Do NOT intercept API endpoints or SSE streams - let browser handle natively
  if (url.pathname.includes('/api/') || url.pathname.includes('/sse') || e.request.headers.get('accept')?.includes('text/event-stream')) {
    return;
  }
  e.respondWith(fetch(e.request));
});
