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
    try{
      // A Worker's default outbound fetch carries no User-Agent/Accept headers
      // a real browser would send, which some sites' bot-protection (TasteDive
      // included) flags on sight — regardless of whether the API key is valid.
      // Looking like an ordinary browser request avoids that false block.
      resp=await fetch(upstream.toString(),{headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        'Accept':'application/json, text/plain, */*',
        'Accept-Language':'en-US,en;q=0.9',
      }});
    }
    catch(e){ return new Response(JSON.stringify({error:'Could not reach the upstream API.'}),
      {status:502,headers:{'Content-Type':'application/json',...CORS_HEADERS}}); }

    const contentType=resp.headers.get('content-type')||'';
    const body=await resp.text();

    // Some upstreams answer a blocked/suspicious request with an HTML
    // challenge or "Attention Required" page instead of a real API error.
    // Forwarding that as-is would look like a 200/403 JSON response to the
    // app and get misread as "your API key is invalid" — so call it out
    // distinctly instead of passing it through.
    const looksLikeHtmlBlock = !contentType.includes('json') && /^\s*<(!doctype|html)/i.test(body);
    if(looksLikeHtmlBlock){
      return new Response(JSON.stringify({error:'upstream_blocked',detail:'The upstream API blocked this request (not a sign your key is wrong) — try again in a bit.'}),
        {status:503,headers:{'Content-Type':'application/json',...CORS_HEADERS}});
    }

    return new Response(body,{status:resp.status,headers:{'Content-Type':'application/json',...CORS_HEADERS}});
  }
};
