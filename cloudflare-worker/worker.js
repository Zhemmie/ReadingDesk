// Reading Desk CORS proxy — deploy this as a Cloudflare Worker.
//
// TasteDive's API doesn't send an Access-Control-Allow-Origin header, so a
// browser refuses to let page JavaScript read its response even though the
// request itself succeeds (paste the URL directly into the address bar and
// it works fine — that's not subject to CORS, only in-page fetch() is).
// This Worker runs server-side, so it isn't subject to CORS either; it just
// forwards the request and adds the header the browser is waiting for.
//
// Your TasteDive key only ever travels from your device to this Worker
// (which you own) to TasteDive. It never touches any third party.
//
// Setup (a few minutes, free):
//  1. https://dash.cloudflare.com -> sign up / log in (free account is fine)
//  2. Workers & Pages -> Create -> Create Worker
//  3. Give it any name (e.g. "reading-desk-proxy") -> this becomes part of
//     its URL: https://reading-desk-proxy.<your-subdomain>.workers.dev
//  4. Delete the default "Hello World" code in the editor and paste in this
//     entire file instead
//  5. Deploy. Copy the URL it gives you.
//  6. Paste that URL into The Reading Desk's Settings -> Discovery, in the
//     "CORS proxy URL" field, alongside your TasteDive key.

// which upstream APIs this proxy is willing to forward to — never make this
// an open proxy to arbitrary URLs, that turns your Worker into something
// anyone could abuse to hide their traffic's origin
const ALLOWED = {
  tastedive: 'https://tastedive.com/api/similar',
  openlibrary: 'https://openlibrary.org/search.json',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if(request.method==='OPTIONS') return new Response(null,{headers:CORS_HEADERS});

    const url=new URL(request.url);
    const api=url.searchParams.get('api');
    const base=ALLOWED[api];
    if(!base) return new Response(JSON.stringify({error:'Unknown or missing "api" parameter.'}),
      {status:400,headers:{'Content-Type':'application/json',...CORS_HEADERS}});

    const upstream=new URL(base);
    for(const [k,v] of url.searchParams){ if(k!=='api') upstream.searchParams.set(k,v); }

    let resp;
    try{ resp=await fetch(upstream.toString()); }
    catch(e){ return new Response(JSON.stringify({error:'Could not reach the upstream API.'}),
      {status:502,headers:{'Content-Type':'application/json',...CORS_HEADERS}}); }

    const body=await resp.text();
    return new Response(body,{status:resp.status,headers:{'Content-Type':'application/json',...CORS_HEADERS}});
  }
};
