// discover.js — optional external lookups: "similar books" via TasteDive and
// genre/subject tags via Open Library. Pure fetch/parse, no DOM, no store
// access. Neither of these was reachable from the dev sandbox that wrote
// this file (network egress there is locked to a short allowlist), so this
// was built against a confirmed real response sample rather than live
// testing — treat the first real use in a browser as the actual test.

// a handful of Open Library "subjects" that show up on nearly every record
// and aren't genres at all (library/ingest metadata, not useful to a reader)
const SUBJECT_NOISE=/^(fiction|large type books|protected daisy|accessible book|in library|internet archive wishlist|overdrive|lending library|popular print disabled books|large print books|open library staff picks|new york times bestseller|nyt:.*|reading level.*|juvenile works|long now manual for civilization)$/i;

function cleanTitle(raw){
  // "The Fellowship of the Ring (The Lord of the Rings, #1)" -> {title, series, num}
  const m=String(raw||'').match(/^(.*?)\s*\(([^()]*?),?\s*#([\d.]+)\s*\)\s*$/);
  if(m) return {title:m[1].trim(), series:m[2].trim().replace(/\s*,\s*$/,''), num:m[3]};
  return {title:String(raw||'').trim(), series:'', num:''};
}

function qParam(prefix,value){
  // TasteDive expects e.g. "book:The Hobbit" as the literal q value, spaces
  // as '+' (form-style), not the %20 encodeURIComponent would otherwise give
  return prefix+':'+encodeURIComponent(value).replace(/%20/g,'+');
}

async function fetchJson(url){
  let res;
  try{ res=await fetch(url); }
  catch(e){ throw new Error('Could not reach the server. This may be blocked by your browser, an ad blocker, or the site itself — check your connection and try again.'); }
  if(!res.ok){
    // the proxy Worker reports this distinctly when the upstream API itself
    // blocked the request (e.g. a bot-protection challenge page) rather than
    // actually rejecting the key — surface that instead of blaming the key
    if(res.status===503){
      let parsed=null; try{ parsed=await res.json(); }catch(e){}
      if(parsed && parsed.error==='upstream_blocked'){
        throw new Error('The book site temporarily blocked this request (not your API key) — try again in a minute.');
      }
      throw new Error('The server returned an error (503). Try again shortly.');
    }
    if(res.status===401||res.status===403) throw new Error('That API key was rejected. Double-check it in Settings.');
    if(res.status===429) throw new Error('Too many requests right now — wait a bit and try again.');
    throw new Error('The server returned an error ('+res.status+'). Try again shortly.');
  }
  try{ return await res.json(); }
  catch(e){ throw new Error('Got an unexpected response back. Try again.'); }
}

// returns [{title,series,num}], already stripped of series-number suffixes.
// TasteDive sends no CORS header, so this always goes through the user's own
// Cloudflare Worker proxy (see /cloudflare-worker/worker.js) rather than
// tastedive.com directly — a direct call would fail in every browser.
export async function tasteDiveSimilar(seedTitle,key,limit,proxyUrl){
  limit=limit||8;
  if(!key) throw new Error('No TasteDive API key configured.');
  if(!proxyUrl) throw new Error('No CORS proxy URL configured — see Settings > Discovery for setup steps.');
  const url=proxyUrl+(proxyUrl.includes('?')?'&':'?')+'api=tastedive&q='+qParam('book',seedTitle)+'&type=book&k='+encodeURIComponent(key)+'&limit='+limit;
  const json=await fetchJson(url);
  const results=json && json.similar && Array.isArray(json.similar.results) ? json.similar.results : null;
  if(!results) throw new Error('Unexpected response from TasteDive — check that your API key is valid.');
  return results.map(r=>cleanTitle(r.name)).filter(r=>r.title);
}

// returns a short array of genre/subject strings, or [] if none found
export async function openLibrarySubjects(title,author){
  const params=new URLSearchParams({title:title||'', fields:'subject', limit:'1'});
  if(author) params.set('author',author);
  const url='https://openlibrary.org/search.json?'+params.toString();
  const json=await fetchJson(url);
  const doc=json && Array.isArray(json.docs) ? json.docs[0] : null;
  const subjects=doc && Array.isArray(doc.subject) ? doc.subject : [];
  const seen=new Set(), out=[];
  for(const s of subjects){
    const t=String(s||'').trim(); if(!t || SUBJECT_NOISE.test(t)) continue;
    const key=t.toLowerCase(); if(seen.has(key)) continue; seen.add(key);
    out.push(t); if(out.length>=6) break;
  }
  return out;
}
