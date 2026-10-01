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

// Open Library's own "series" field is a plain string like "Between Earth
// and Sky" or sometimes "Between Earth and Sky ; 1" / "Between Earth and
// Sky, book 1" — split off a trailing volume number where there is one.
function parseSeriesField(raw){
  const s=String(raw||'').trim();
  if(!s) return {series:'',num:''};
  let m=s.match(/^(.*?)\s*[;,]?\s*(?:book|bk\.?|vol\.?|volume|no\.?|#)\s*(\d+(?:\.\d+)?)\s*$/i);
  if(m) return {series:m[1].trim(),num:m[2]};
  m=s.match(/^(.*?)\s*[;,]\s*(\d+(?:\.\d+)?)\s*$/);
  if(m) return {series:m[1].trim(),num:m[2]};
  return {series:s,num:''};
}
// Open Library records series membership two different, inconsistent ways:
// sometimes baked right into the title text ("Black Sun (Between Earth and
// Sky, #1)"), sometimes as the record's own separate "series" field
// (just "Between Earth and Sky", often with no volume number attached at
// all). Checking only the title text — the old behavior — silently missed
// every book tagged the second way. This merges both, preferring the
// series field when it's there since it's the more deliberate tag.
function seriesInfoFor(d){
  const fromField=parseSeriesField(Array.isArray(d.series) ? d.series[0] : d.series);
  const fromTitle=cleanTitle(d.title);
  return {
    title: fromTitle.title || String(d.title||'').trim(),
    series: fromField.series || fromTitle.series,
    num: fromField.num || fromTitle.num
  };
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
// seedTitles may be a single string or an array — TasteDive's q parameter
// accepts a comma-separated list of type:value pairs and blends them into
// one set of recommendations, which is how several books can tailor a
// single search (capped at 8 to stay within what the API accepts).
export async function tasteDiveSimilar(seedTitles,key,limit,proxyUrl){
  limit=limit||8;
  const titles=(Array.isArray(seedTitles)?seedTitles:[seedTitles]).map(t=>String(t||'').trim()).filter(Boolean).slice(0,8);
  if(!titles.length) throw new Error('No seed title given.');
  if(!key) throw new Error('No TasteDive API key configured.');
  if(!proxyUrl) throw new Error('No CORS proxy URL configured — see Settings > Discovery for setup steps.');
  const qVal=titles.map(t=>qParam('book',t)).join(',');
  const url=proxyUrl+(proxyUrl.includes('?')?'&':'?')+'api=tastedive&q='+qVal+'&type=book&k='+encodeURIComponent(key)+'&limit='+limit;
  const json=await fetchJson(url);
  const results=json && json.similar && Array.isArray(json.similar.results) ? json.similar.results : null;
  if(!results) throw new Error('Unexpected response from TasteDive — check that your API key is valid.');
  return results.map(r=>cleanTitle(r.name)).filter(r=>r.title);
}

// ---------- Google Books (fallback when Open Library errors or is empty) ----------
// Open Library is the primary source everywhere — better genre/subject tags,
// and its own cover service — but it's a volunteer-run, sometimes-slow
// service that occasionally times out or returns nothing for a title it
// should have. Google Books needs no API key for this kind of light,
// client-side use and is generally fast and reliable, so it's used as an
// automatic fallback, never a replacement: only reached for when Open
// Library's own call actually failed or came back empty.
async function googleBooksSearch(query,limit){
  limit=limit||8;
  const q=String(query||'').trim();
  if(!q) return [];
  const url='https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent(q)+'&maxResults='+limit;
  const json=await fetchJson(url);
  const items=json && Array.isArray(json.items) ? json.items : [];
  return items.map(it=>{
    const v=it.volumeInfo||{};
    const parsed=cleanTitle(v.title);
    const img=v.imageLinks||{};
    return {
      title: parsed.title || String(v.title||'').trim(),
      series: parsed.series,
      num: parsed.num,
      author: Array.isArray(v.authors) ? v.authors[0] : '',
      year: v.publishedDate ? String(v.publishedDate).slice(0,4) : '',
      coverUrl: (img.thumbnail||img.smallThumbnail||'').replace(/^http:/,'https:'),
      synopsis: v.description || '',
      genres: Array.isArray(v.categories) ? v.categories : []
    };
  }).filter(r=>r.title);
}

// returns up to `limit` {title,series,num,author,year,coverUrl} candidates for
// a title search — used to autofill the add-book form instead of typing
// everything by hand. coverUrl points straight at Open Library's cover
// service (no fetching/re-encoding needed — an <img src> doesn't need CORS,
// only reading the bytes back out in JS would)
export async function openLibrarySearch(query,limit){
  limit=limit||8;
  const q=String(query||'').trim();
  if(!q) return [];
  try{
    const params=new URLSearchParams({q, fields:'title,author_name,first_publish_year,cover_i,series', limit:String(limit)});
    const url='https://openlibrary.org/search.json?'+params.toString();
    const json=await fetchJson(url);
    const docs=json && Array.isArray(json.docs) ? json.docs : [];
    const results=docs.map(d=>{
      const info=seriesInfoFor(d);
      return {
        title: info.title,
        series: info.series,
        num: info.num,
        author: Array.isArray(d.author_name) ? d.author_name[0] : '',
        year: d.first_publish_year || '',
        coverUrl: d.cover_i ? ('https://covers.openlibrary.org/b/id/'+d.cover_i+'-M.jpg') : ''
      };
    }).filter(r=>r.title);
    if(results.length) return results;
  }catch(e){ /* Open Library errored — fall through to Google Books below */ }
  try{ return await googleBooksSearch(query,limit); }catch(e){ return []; }
}

// returns every volume of a series Open Library's search turns up, as
// {title,num,author,year,coverUrl}, sorted by number. Open Library has no
// "get series X" endpoint — this searches by the series name itself (a
// generous limit, since a long-running series needs many hits) and keeps
// only results matching that exact series, via either Open Library's own
// "series" field or a parenthetical in the title (see seriesInfoFor above).
// That still only finds what Open Library itself tagged one of those two
// ways — good for well-known series, easy to miss obscure ones — so the
// caller should let the person review and deselect before adding anything.
export async function openLibrarySeries(seriesName,limit){
  limit=limit||50;
  const q=String(seriesName||'').trim();
  if(!q) return [];
  const params=new URLSearchParams({q, fields:'title,author_name,first_publish_year,cover_i,series', limit:String(limit)});
  const url='https://openlibrary.org/search.json?'+params.toString();
  const json=await fetchJson(url);
  const docs=json && Array.isArray(json.docs) ? json.docs : [];
  const wantedSeries=q.toLowerCase();
  const seen=new Set(), out=[];
  for(const d of docs){
    const info=seriesInfoFor(d);
    if(!info.series || info.series.toLowerCase()!==wantedSeries) continue;
    const key=info.title.toLowerCase()+'|'+info.num;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: info.title,
      num: info.num,
      author: Array.isArray(d.author_name) ? d.author_name[0] : '',
      year: d.first_publish_year || '',
      coverUrl: d.cover_i ? ('https://covers.openlibrary.org/b/id/'+d.cover_i+'-M.jpg') : ''
    });
  }
  out.sort((a,b)=>(parseFloat(a.num)||0)-(parseFloat(b.num)||0));
  return out;
}

// ---------- Wikidata (structured series data) ----------
// Where Open Library's series info is text it (or Google Books) happened to
// record — a parenthetical in a title, a loose "series" string — Wikidata
// stores series membership as an actual structured claim: "part of the
// series" (P179), with the volume number as a qualifier (P1545) on that
// same claim. That makes it the one source worth asking specifically for
// series/number data, as a supplement when the others come up short. Two
// small requests rather than one big SPARQL query: find the item via the
// ordinary search API, then ask just that item for its series claim —
// easier to reason about, and a failure in one doesn't take down the other.
// origin=* is required for Wikidata's action API to answer with CORS
// headers at all; the query service is built for exactly this kind of
// client-side use and needs no such parameter itself.
async function wikidataFindEntity(label){
  const url='https://www.wikidata.org/w/api.php?action=wbsearchentities&search='+encodeURIComponent(label)+'&language=en&format=json&origin=*&type=item&limit=1';
  const json=await fetchJson(url);
  const hits=json && Array.isArray(json.search) ? json.search : [];
  return hits.length ? hits[0].id : '';
}
async function wikidataSparql(query){
  const url='https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(query);
  const json=await fetchJson(url);
  return json && json.results && Array.isArray(json.results.bindings) ? json.results.bindings : [];
}
// returns {series,num} for one book (num may be '' even when series isn't —
// not every series claim on Wikidata carries an ordinal), or {series:'',num:''}
export async function wikidataSeriesFor(title){
  const id=await wikidataFindEntity(title);
  if(!id) return {series:'',num:''};
  const bindings=await wikidataSparql(
    `SELECT ?seriesLabel ?ordinal WHERE { wd:${id} p:P179 ?stmt. ?stmt ps:P179 ?series. `+
    `OPTIONAL { ?stmt pq:P1545 ?ordinal. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 1`
  );
  const b=bindings[0];
  if(!b) return {series:'',num:''};
  return {series: b.seriesLabel ? b.seriesLabel.value : '', num: b.ordinal ? b.ordinal.value : ''};
}
// returns every book Wikidata has tagged as part of the given series, as
// {title,num,author}, sorted by number — a supplement to merge alongside
// Open Library's own series search, not a replacement for it (Wikidata has
// no cover images in a form as convenient as Open Library's cover service)
export async function wikidataSeriesVolumes(seriesName){
  const id=await wikidataFindEntity(seriesName);
  if(!id) return [];
  const bindings=await wikidataSparql(
    `SELECT ?bookLabel ?ordinal ?authorLabel WHERE { ?book wdt:P179 wd:${id}. `+
    `OPTIONAL { ?book p:P179 ?stmt. ?stmt ps:P179 wd:${id}. ?stmt pq:P1545 ?ordinal. } `+
    `OPTIONAL { ?book wdt:P50 ?author. } `+
    `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 200`
  );
  const out=bindings.map(b=>({
    title: b.bookLabel ? b.bookLabel.value : '',
    num: b.ordinal ? b.ordinal.value : '',
    author: b.authorLabel ? b.authorLabel.value : '',
    year:'', coverUrl:''
  })).filter(r=>r.title);
  out.sort((a,b)=>(parseFloat(a.num)||999)-(parseFloat(b.num)||999));
  return out;
}

// returns a synopsis string (possibly '' if nothing was found anywhere).
// Open Library's search results don't carry the full description, only a
// work "key" — so this is two requests: find the work, then fetch its full
// record. Falls back to the work's first_sentence if it has no description,
// then to Google Books' description if Open Library errored or had neither.
export async function openLibrarySynopsis(title,author){
  try{
    const params=new URLSearchParams({title:title||'', fields:'key,first_sentence', limit:'1'});
    if(author) params.set('author',author);
    const url='https://openlibrary.org/search.json?'+params.toString();
    const json=await fetchJson(url);
    const doc=json && Array.isArray(json.docs) ? json.docs[0] : null;
    if(doc){
      let text='';
      if(doc.key){
        try{
          const work=await fetchJson('https://openlibrary.org'+doc.key+'.json');
          let desc=work && work.description;
          if(desc && typeof desc==='object') desc=desc.value;
          if(desc) text=String(desc).trim();
        }catch(e){ /* no work record — fall back to first_sentence below */ }
      }
      if(!text && doc.first_sentence){
        const fs=Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : doc.first_sentence;
        if(fs) text=String(fs).trim();
      }
      if(text) return text;
    }
  }catch(e){ /* Open Library errored — fall through to Google Books below */ }
  try{
    const [gb]=await googleBooksSearch([title,author].filter(Boolean).join(' '),1);
    return (gb && gb.synopsis) ? gb.synopsis.trim() : '';
  }catch(e){ return ''; }
}

// returns a short array of genre/subject strings, or [] if none found
// anywhere. Falls back to Google Books' (broader, BISAC-style) categories
// if Open Library errored or had no subject tags for this title.
export async function openLibrarySubjects(title,author){
  try{
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
    if(out.length) return out;
  }catch(e){ /* Open Library errored — fall through to Google Books below */ }
  try{
    const [gb]=await googleBooksSearch([title,author].filter(Boolean).join(' '),1);
    return (gb && gb.genres) ? gb.genres.slice(0,6) : [];
  }catch(e){ return []; }
}
