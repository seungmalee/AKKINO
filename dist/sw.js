// Offline support. Online: always fetch fresh files (bypassing the browser's
// HTTP cache) and keep a copy. Offline: serve the saved copy.
// Bump CACHE when shipping changes so old copies are cleared.
var CACHE = "akkino-v4";
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
      // cache: "reload" skips the HTTP cache so a new release never stores old files.
      return cache.addAll(SHELL.map(function (url) {
        return new Request(url, { cache: "reload" });
      }));
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
  var navigate = request.mode === "navigate";
  var key = navigate ? "index.html" : request;
  // A navigate-mode Request can't be re-issued with options, so rebuild it from the URL.
  var fresh = navigate
    ? new Request(request.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(request, { cache: "no-cache" });
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return fetch(fresh).then(function (response) {
        if (response && response.ok) cache.put(key, response.clone());
        return response;
      }).catch(function () {
        return cache.match(key, { ignoreSearch: true }).then(function (cached) {
          return cached || Response.error();
        });
      });
    })
  );
});
