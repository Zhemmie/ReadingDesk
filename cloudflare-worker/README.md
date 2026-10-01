# CORS proxy for TasteDive

TasteDive's API doesn't send an `Access-Control-Allow-Origin` header, so a
browser blocks The Reading Desk's own JavaScript from reading its response
— even though the exact same request works fine if you paste the URL
directly into your address bar (that's a top-level navigation, not subject
to CORS; only in-page `fetch()` calls are).

`worker.js` is a tiny proxy that runs on [Cloudflare Workers](https://workers.cloudflare.com/)
(free tier, no credit card needed for this kind of usage) to fix that. It
forwards your request to TasteDive server-side — which isn't subject to
CORS either — and adds the header back on the way out. Your TasteDive key
only ever travels from your device to this Worker (which you own) to
TasteDive. It never touches any third party.

It's written generically enough to also proxy Open Library if that ever
turns out to need it too, at no extra setup.

## Setup (~5 minutes, free)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up or
   log in — a free account is all you need.
2. **Workers & Pages** → **Create** → **Create Worker**.
3. Give it any name, e.g. `reading-desk-proxy`. This becomes part of its
   URL: `https://reading-desk-proxy.<your-subdomain>.workers.dev`.
4. Delete the default "Hello World" code in the editor, and paste in the
   entire contents of [`worker.js`](./worker.js) instead.
5. Click **Deploy**. Copy the URL it gives you.
6. In The Reading Desk, go to **Settings → Discovery**, and paste in both
   your TasteDive API key and this Worker URL. Connect.

That's it — the dashboard's "Discover" row should start working. Nothing
else in the app needs this Worker; it's entirely optional.
