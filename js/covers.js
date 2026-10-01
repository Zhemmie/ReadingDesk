// covers.js — pull the real cover image out of an .epub or .cbz file.
// Self-contained, no dependencies: a minimal ZIP central-directory reader
// (using the browser's built-in DecompressionStream for the 'deflate' entries
// most EPUB/CBZ files use), ported from the single-file app. Pure file-in,
// data-URL-out; the caller decides which book it belongs to.

async function zipEntries(buf){
  const view=new DataView(buf), bytes=new Uint8Array(buf);
  let eocd=-1;
  for(let i=bytes.length-22; i>=Math.max(0,bytes.length-22-65557); i--){
    if(view.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('Not a zip file');
  const cdOffset=view.getUint32(eocd+16,true), cdCount=view.getUint16(eocd+10,true);
  const entries=[]; let off=cdOffset;
  for(let i=0;i<cdCount;i++){
    if(view.getUint32(off,true)!==0x02014b50) break;
    const compMethod=view.getUint16(off+10,true), compSize=view.getUint32(off+20,true),
      nameLen=view.getUint16(off+28,true), extraLen=view.getUint16(off+30,true), commentLen=view.getUint16(off+32,true),
      localOff=view.getUint32(off+42,true);
    const name=new TextDecoder().decode(bytes.slice(off+46,off+46+nameLen));
    entries.push({name,compMethod,compSize,localOff});
    off+=46+nameLen+extraLen+commentLen;
  }
  async function extract(entry){
    if(view.getUint32(entry.localOff,true)!==0x04034b50) throw new Error('Bad zip entry');
    const nameLen=view.getUint16(entry.localOff+26,true), extraLen=view.getUint16(entry.localOff+28,true);
    const start=entry.localOff+30+nameLen+extraLen;
    const raw=bytes.slice(start,start+entry.compSize);
    if(entry.compMethod===0) return raw;
    if(entry.compMethod===8){
      const ds=new DecompressionStream('deflate-raw');
      const writer=ds.writable.getWriter(); writer.write(raw); writer.close();
      const chunks=[]; const reader=ds.readable.getReader();
      while(true){ const {done,value}=await reader.read(); if(done) break; chunks.push(value); }
      const total=chunks.reduce((a,c)=>a+c.length,0); const out=new Uint8Array(total); let p=0;
      chunks.forEach(c=>{ out.set(c,p); p+=c.length; }); return out;
    }
    throw new Error('Unsupported compression in this file');
  }
  return {entries, extract, find:(name)=>entries.find(e=>e.name===name)};
}
function resolveEpubPath(base,href){
  const dir=base.includes('/')?base.slice(0,base.lastIndexOf('/')+1):'';
  const parts=(dir+href).split('/'), out=[];
  parts.forEach(seg=>{ if(seg==='..') out.pop(); else if(seg!=='.'&&seg!=='') out.push(seg); });
  return out.join('/');
}
async function extractEpubCover(file){
  const buf=await file.arrayBuffer();
  const zip=await zipEntries(buf);
  const containerEntry=zip.find('META-INF/container.xml');
  if(!containerEntry) throw new Error('That doesn’t look like a valid EPUB.');
  const containerXml=new TextDecoder().decode(await zip.extract(containerEntry));
  const containerDoc=new DOMParser().parseFromString(containerXml,'application/xml');
  const rootfile=containerDoc.querySelector('rootfile'); if(!rootfile) throw new Error('No content file listed in this EPUB.');
  const opfPath=rootfile.getAttribute('full-path');
  const opfEntry=zip.find(opfPath); if(!opfEntry) throw new Error('EPUB content file is missing.');
  const opfXml=new TextDecoder().decode(await zip.extract(opfEntry));
  const opfDoc=new DOMParser().parseFromString(opfXml,'application/xml');
  let coverHref=null;
  const item3=opfDoc.querySelector('item[properties~="cover-image"]');
  if(item3) coverHref=item3.getAttribute('href');
  if(!coverHref){ const metaCover=opfDoc.querySelector('meta[name="cover"]');
    if(metaCover){ const cid=metaCover.getAttribute('content');
      const item=[...opfDoc.querySelectorAll('item')].find(it=>it.getAttribute('id')===cid);
      if(item) coverHref=item.getAttribute('href'); } }
  if(!coverHref){ const guess=[...opfDoc.querySelectorAll('item')].find(it=>
      /cover/i.test(it.getAttribute('id')||'') && /^image\//.test(it.getAttribute('media-type')||''));
    if(guess) coverHref=guess.getAttribute('href'); }
  if(!coverHref) throw new Error('No cover image found inside this EPUB.');
  const imgPath=resolveEpubPath(opfPath,coverHref);
  const imgEntry=zip.find(imgPath)||zip.find(coverHref);
  if(!imgEntry) throw new Error('Cover image is listed but missing from the file.');
  const imgData=await zip.extract(imgEntry);
  const ext=imgPath.split('.').pop().toLowerCase();
  const mime= ext==='png'?'image/png' : ext==='gif'?'image/gif' : ext==='webp'?'image/webp' : 'image/jpeg';
  return new Blob([imgData],{type:mime});
}
// CBZ: no manifest, just a zipped folder of page images. The cover is
// whichever image is explicitly named "cover", else the first page by
// natural (numeric-aware) sort so "page2" doesn't sort after "page10"
function naturalCmp(a,b){
  const ax=a.match(/\d+|\D+/g)||[], bx=b.match(/\d+|\D+/g)||[];
  for(let i=0;i<Math.max(ax.length,bx.length);i++){
    const as=ax[i]||'', bs=bx[i]||'';
    const an=/^\d+$/.test(as), bn=/^\d+$/.test(bs);
    if(an&&bn){ const d=(+as)-(+bs); if(d) return d; }
    else if(as!==bs) return as<bs?-1:1;
  }
  return 0;
}
async function extractCbzCover(file){
  const buf=await file.arrayBuffer();
  const zip=await zipEntries(buf);
  const IMG_RE=/\.(jpe?g|png|gif|webp)$/i;
  const candidates=zip.entries.filter(e=>{
    const base=e.name.split('/').pop();
    return IMG_RE.test(e.name) && !e.name.includes('__MACOSX') && base && !base.startsWith('.');
  });
  if(!candidates.length) throw new Error('No images found inside this file.');
  let coverEntry=candidates.find(e=>/cover/i.test(e.name));
  if(!coverEntry) coverEntry=[...candidates].sort((a,b)=>naturalCmp(a.name,b.name))[0];
  const imgData=await zip.extract(coverEntry);
  const ext=coverEntry.name.split('.').pop().toLowerCase();
  const mime= ext==='png'?'image/png' : ext==='gif'?'image/gif' : ext==='webp'?'image/webp' : 'image/jpeg';
  return new Blob([imgData],{type:mime});
}
// shrink to a small, sync-friendly jpeg — covers only live for as long as a
// book is actively being read, but keep them cheap regardless
async function resizeCoverToDataUrl(blob,maxW,maxH){
  const bitmap=await createImageBitmap(blob);
  const scale=Math.min(maxW/bitmap.width, maxH/bitmap.height, 1);
  const w=Math.max(1,Math.round(bitmap.width*scale)), h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d'); ctx.drawImage(bitmap,0,0,w,h);
  return new Promise((resolve,reject)=>{ canvas.toBlob(b=>{ if(!b){ reject(new Error('Could not process that image.')); return; }
    const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('Could not read the image.'));
    reader.readAsDataURL(b); }, 'image/jpeg', 0.78); });
}

// returns a small data: URL, or throws a message fit to show the user directly
export async function coverFromFile(file){
  const name=(file.name||'').toLowerCase();
  const isCbz = name.endsWith('.cbz') || file.type==='application/vnd.comicbook+zip';
  const isEpub = name.endsWith('.epub') || file.type==='application/epub+zip';
  if(!isCbz && !isEpub) throw new Error('Choose an .epub or .cbz file.');
  const blob = isCbz ? await extractCbzCover(file) : await extractEpubCover(file);
  return resizeCoverToDataUrl(blob,340,500);
}
