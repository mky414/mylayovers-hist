// Taksi yolu / pist geometrisi: OpenStreetMap (Overpass) → twy/{ICAO}.json
// Haftada bir çalışır; meydan koordinatları OurAirports'tan. Çıktı: {icao,lat,lon,at,n,ways:[{t:'r'|'t',n:'C9',g:[[lat,lon],...]}]}
import fs from 'fs'; import path from 'path';
const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(x=>{ const [k,...v]=x.trim().split(/\s+/); return [k, v.join(' ')||'1']; }));
const OUT=args.out||'pub', MAXAGE=(+args.maxage||6)*864e5, LIMIT=+args.limit||0;
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];
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
let done=0, skipped=0, failed=[];
for(const icao of list){
  if(LIMIT&&done>=LIMIT) break;
  const fp=path.join(OUT,'twy',icao+'.json');
  try{ const old=JSON.parse(fs.readFileSync(fp,'utf8')); if(old.at&&Date.now()-old.at<MAXAGE&&old.n>0){ skipped++; continue; } }catch(e){}
  const ll=coord[icao]; if(!ll){ failed.push(icao+':noll'); continue; }
  const q=`[out:json][timeout:90];(way["aeroway"="runway"](around:5500,${ll[0]},${ll[1]});way["aeroway"="taxiway"](around:5500,${ll[0]},${ll[1]}););out geom tags;`;
  let ways=null;
  for(const u of OVERPASS){
    try{
      const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':UA},body:'data='+encodeURIComponent(q),signal:AbortSignal.timeout(120000)});
      if(r.status===429||r.status===504){ await sleep(30000); continue; }
      if(!r.ok) continue;
      const j=await r.json();
      ways=(j.elements||[]).filter(e=>e.type==='way'&&Array.isArray(e.geometry)&&e.geometry.length>1).map(e=>({t:e.tags.aeroway==='runway'?'r':'t', n:String(e.tags.ref||e.tags.name||'').toUpperCase().trim(), g:e.geometry.map(p=>[+p.lat.toFixed(5),+p.lon.toFixed(5)])}));
      break;
    }catch(e){ await sleep(5000); }
  }
  if(!ways){ failed.push(icao); await sleep(5000); continue; }
  fs.writeFileSync(fp, JSON.stringify({icao, lat:ll[0], lon:ll[1], at:Date.now(), n:ways.length, ways}));
  done++; console.log(icao, ways.length); await sleep(2500);
}
fs.writeFileSync(path.join(OUT,'twy','_meta.json'), JSON.stringify({at:Date.now(), done, skipped, failed, total:list.length}));
console.log('bitti', {done, skipped, failed:failed.length});
