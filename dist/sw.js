// Offline support: serve the app shell from cache, refresh it in the background.
// Bump CACHE when shipping changes so installed apps pick up the new files.
var CACHE = "akkino-v2";
var SHELL = [
  "./",
  "index.html",
  "styles.css",
  "intro.css",
  "ledger.js",
  "app.js",
  "akkino-logo.svg",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      var lookup = request.mode === "navigate" ? "index.html" : request;
      return cache.match(lookup, { ignoreSearch: true }).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && response.ok) cache.put(lookup, response.clone());
          return response;
        }).catch(function () {
          return cached;
        });
        return cached || network;
      });
    })
  );
});
