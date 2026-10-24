// Taksi yolu / pist geometrisi: OpenStreetMap (Overpass) → twy/{ICAO}.json
// Haftada bir çalışır; meydan koordinatları OurAirports'tan. Çıktı: {icao,lat,lon,at,n,ways:[{t:'r'|'t',n:'C9',g:[[lat,lon],...]}]}
import fs from 'fs'; import path from 'path';
const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(x=>{ const [k,...v]=x.trim().split(/\s+/); return [k, v.join(' ')||'1']; }));
const OUT=args.out||'pub', MAXAGE=(+args.maxage||6)*864e5, LIMIT=+args.limit||0;
const OVERPASS=['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];
const UA='mylayovers.app taxiway map (github actions; contact via site)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const list=fs.readFileSync(args.list||'airports.txt','utf8').split(/\s+/).filter(x=>/^[A-Z0-9]{4}$/.test(x));
fs.mkdirSync(path.join(OUT,'twy'),{recursive:true});
// koordinatlar
const csv=await (await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv',{headers:{'User-Agent':UA}})).text();
const head=csv.slice(0,csv.indexOf('\n')).trim().split(',').map(x=>x.replace(/^"|"$/g,'')); const I={ident:head.indexOf('ident'),lat:head.indexOf('latitude_deg'),lon:head.indexOf('longitude_deg'),type:head.indexOf('type')};
const coord={};
for(const line of csv.split('\n')){ const f=line.match(/("([^"]|"")*"|[^,]*)(,|$)/g); if(!f) continue; const c=f.map(x=>x.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"')); const id=c[I.ident]; if(list.includes(id)&&c[I.type]!=='closed') coord[id]=[+c[I.lat],+c[I.lon]]; }
if(Object.keys(coord).length<10){ console.error('koordinat listesi boş', Object.keys(coord).length, head.slice(0,6)); process.exit(1); }
console.log('meydan', list.length, 'koordinat', Object.keys(coord).length);
let done=0, skipped=0, failed=[]; const T0=Date.now();
const metaFile=path.join(OUT,'twy','_meta.json');
const writeMeta=()=>fs.writeFileSync(metaFile, JSON.stringify({at:Date.now(), done, skipped, failed, total:list.length, mins:Math.round((Date.now()-T0)/6e4)}));
writeMeta();   // ara sonuçlar da yayınlansın (süre dolsa bile)
// kuyruk: taze olanlar atlanır
const queue=[];
for(const icao of list){
  const fp=path.join(OUT,'twy',icao+'.json');
  try{ const old=JSON.parse(fs.readFileSync(fp,'utf8')); if(old.at&&Date.now()-old.at<MAXAGE&&old.n>0){ skipped++; continue; } }catch(e){}
  if(!coord[icao]){ failed.push(icao+':noll'); continue; }
  queue.push(icao);
}
console.log('çekilecek', queue.length, 'atlanan', skipped);
async function fetchOne(u, icao){
  const ll=coord[icao];
  const q=`[out:json][timeout:60];(way["aeroway"="runway"](around:5500,${ll[0]},${ll[1]});way["aeroway"="taxiway"](around:5500,${ll[0]},${ll[1]}););out geom tags;`;
  const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA},body:'data='+encodeURIComponent(q),signal:AbortSignal.timeout(90000)});
  if(!r.ok){ const e=new Error('http '+r.status); e.status=r.status; e.retryAfter=+(r.headers.get('retry-after')||0); throw e; }
  const j=await r.json();
  if(j.remark&&/timed out|error/i.test(j.remark)) throw new Error('remark');
  return (j.elements||[]).filter(e=>e.type==='way'&&Array.isArray(e.geometry)&&e.geometry.length>1).map(e=>({t:e.tags.aeroway==='runway'?'r':'t', n:String(e.tags.ref||e.tags.name||'').toUpperCase().trim(), g:e.geometry.map(p=>[+p.lat.toFixed(5),+p.lon.toFixed(5)])}));
}
// her ayna için bir işçi; kuyruktan sırayla alır
const tries={};
async function worker(u){
  let bad=0;
  while(queue.length&&(!LIMIT||done<LIMIT)){
    const icao=queue.shift(); if(!icao) break;
    try{
      const ways=await fetchOne(u, icao);
      fs.writeFileSync(path.join(OUT,'twy',icao+'.json'), JSON.stringify({icao, lat:coord[icao][0], lon:coord[icao][1], at:Date.now(), n:ways.length, ways}));
      done++; bad=0; console.log(icao, ways.length, '·', u.split('/')[2], '·', Math.round((Date.now()-T0)/6e4)+'dk'); writeMeta();
      await sleep(1500);
    }catch(e){
      tries[icao]=(tries[icao]||0)+1; bad++;
      console.log(icao, 'olmadı', u.split('/')[2], e.status||e.name||e.message);
      if(tries[icao]<4) queue.push(icao); else failed.push(icao);
      const wait=e.status===429?Math.max(20, e.retryAfter||0):e.status===504?15:bad>=3?60:8;
      await sleep(wait*1000);
    }
  }
}
await Promise.all(OVERPASS.map(worker));
writeMeta();
console.log('bitti', {done, skipped, failed:failed.length, dk:Math.round((Date.now()-T0)/6e4)});
