# The Reading Desk - installable app

A personal reading tracker with a proper dashboard, fast add flow, notes,
reminders, and two themes (Library and Cyberpunk). Installable, offline-
capable Android/desktop app. Everything runs on your device; no server
code, no accounts required.

## Files

```
index.html                 app shell (nav, mount points, loads js/app.js)
css/base.css                layout + components, theme-neutral
css/theme-library.css       warm "reading room" theme (default)
css/theme-cyberpunk.css     neon terminal/HUD theme (CRT scanlines, glow)
css/fonts.css                the embedded Cinzel heading font
css/fonts-cyberpunk.css      the embedded Orbitron + Share Tech Mono fonts
js/store.js                  all data: catalog, status, ratings, details,
                              notes, reminders, stats, import/export,
                              migrations from the old single-file version
js/sync.js                   GitHub Gist sync (unchanged format/behavior)
js/app.js                    rendering, modals, event wiring
manifest.webmanifest, sw.js  PWA install + offline caching
icon-*.png, icon-512.ico    app icons
```

No build step. Everything is plain ES modules and CSS, so you can keep
editing it by hand or re-uploading files the same way as before.

## Put it online once (free, ~5 minutes, no coding)
1. Sign in at github.com and click "New repository". Name it e.g. `reading-desk`,
   set it Public, and create it.
2. On the repo page: "Add file" -> "Upload files". Drag in the whole contents
   of this folder (index.html, manifest.webmanifest, sw.js, the css/ and js/
   folders, and the icon files), preserving the folder structure. Commit.
3. Go to Settings -> Pages. Under "Build and deployment", set Source to
   "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
4. Wait about a minute, then open the URL it shows:
   https://YOUR-USERNAME.github.io/reading-desk/

## Install on Android
- Open that URL in Chrome. You'll get an "Install app" prompt (or use the
  menu -> "Install app" / "Add to Home screen"). It installs as a standalone
  app with its own icon, works offline after the first load.

## Your data
- Saves on the device automatically. It is per-device unless you connect
  sync (Settings -> "Sync across devices", a GitHub personal access token
  with the `gist` scope). Use "Save backup" / "Load backup" in Settings to
  move a snapshot by hand. Keep a backup before clearing browser data.
- Upgrading from the old single-file version carries your library forward
  automatically (same `localStorage` keys, same Gist format) — nothing to
  migrate by hand.

## Updating later
- Re-upload changed files and bump the cache version at the top of `sw.js`
  (e.g. `reading-desk-v52` to `-v53`) so installed devices pick up the new
  version instead of serving the cached one.
