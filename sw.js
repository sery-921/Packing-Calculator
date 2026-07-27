const CACHE = "packaging-optimizer-v25";
const ASSETS = ["./", "./index.html", "./style.css", "./common-cartons.js", "./epe-foam-skus.js", "./epe-foam-face-maps.js", "./mixed-packing.js", "./app.js", "./preview3d.js", "./vendor/three/three.module.js", "./vendor/three/OrbitControls.js", "./manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener("fetch", event => {
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
