/* Her gece: adsb.lol günlük arşivinden (globe_history, ODbL) THY uçuşlarının
   iniş/kalkış pisti ve park pozisyonunu çıkarır, pub/ altına meydan ve çağrı adı bazında yazar.
   Kullanım: node scripts/update.mjs [--max 4] [--days 32] [--out pub] */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { loadRunways, extractEvents } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MAX = +arg('max', 4), DAYS = +arg('days', 32), OUT = arg('out', 'pub'), PFX = arg('prefix', 'THY');
const KEEP = 35 * 86400;
const HEX = '4b[89abcdef]';   // Türkiye tescilli uçaklar (TC-)

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };

async function getText(url) {
  if (url.startsWith('file://')) return fs.readFileSync(url.slice(7), 'utf8');   // yerel deneme
  for (let i = 0; i < 3; i++) { try { const r = await fetch(url); if (r.ok) return await r.text(); log('http', r.status, url); } catch (e) { log('hata', e.message); } await new Promise(r => setTimeout(r, 3000)); }
  throw new Error('indirilemedi: ' + url);
}

// 1) hangi günler işlenecek
const meta = readJson(path.join(OUT, '_meta.json'), { days: [] });
const done = new Set(meta.days || []);
const today = new Date(); const years = [today.getUTCFullYear()]; if (today.getUTCMonth() === 0) years.push(today.getUTCFullYear() - 1);
const rel = new Map();
for (const y of years) {
  let txt = '';
  try { txt = await getText(arg('releases', '') || `https://raw.githubusercontent.com/adsblol/globe_history_${y}/main/PREFERRED_RELEASES.txt`); } catch (e) { log(e.message); continue; }
  for (const line of txt.split('\n')) {
    const urls = line.trim().split(',').filter(Boolean); if (!urls.length) continue;
    const m = urls[0].match(/\/v(\d{4})\.(\d{2})\.(\d{2})-planes-readsb-([a-z]+)-\d/); if (!m) continue;
    if (m[4] === 'mlatonly') continue;                 // yalnız MLAT: işe yaramaz
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    if (!rel.has(day)) rel.set(day, urls);
  }
}
const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10);
const todo = [...rel.keys()].filter(d => d >= cutoff && !done.has(d)).sort().reverse().slice(0, MAX);
log('arşivde', rel.size, 'gün · işlenecek:', todo.join(' ') || 'yok');
if (!todo.length) process.exit(0);

// 2) pist eşikleri
const R = loadRunways(await getText(arg('runways', 'https://davidmegginson.github.io/ourairports-data/runways.csv')));
log('meydan', R.aps.size);

// 3) her gün: indir → yalnız TC- izlerini çıkar → olaylar
const touched = { a: new Map(), d: new Map() };   // ap -> cs -> rows
const stats = [];
for (const day of todo) {
  const tmp = fs.mkdtempSync('/tmp/gh-');
  const urls = rel.get(day).map(u => `'${u}'`).join(' ');
  log(day, 'indiriliyor', rel.get(day).length, 'parça');
  try {
    execSync(`set -o pipefail; curl -sfL --retry 4 --retry-delay 10 ${urls} | tar -x -C ${tmp} --wildcards --no-anchored 'trace_full_${HEX}*' 2>&1 | grep -v 'Not found' || true`, { shell: '/bin/bash', stdio: 'inherit', timeout: 50 * 60e3 });
  } catch (e) { log(day, 'indirme hatası', e.message); fs.rmSync(tmp, { recursive: true, force: true }); continue; }
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.startsWith('trace_full_')) files.push(p); } })(tmp);
  let nA = 0, nD = 0, nRw = 0, nSt = 0, bad = 0;
  for (const f of files) {
    let J;
    try { let b = fs.readFileSync(f); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); J = JSON.parse(b.toString('utf8')); } catch (e) { bad++; continue; }
    for (const ev of extractEvents(J, R, PFX)) {
      const M = touched[ev.kind]; if (!M.has(ev.ap)) M.set(ev.ap, new Map());
      const C = M.get(ev.ap); if (!C.has(ev.cs)) C.set(ev.cs, []);
      C.get(ev.cs).push([ev.ts, ev.rwy, ev.slat, ev.slon, ev.reg, ev.type]);
      ev.kind === 'a' ? nA++ : nD++; if (ev.rwy) nRw++; if (ev.slat != null) nSt++;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  log(day, `${files.length} iz · ${nA} iniş · ${nD} kalkış · pist ${nRw} · park ${nSt}${bad ? ' · okunamayan ' + bad : ''}`);
  if (files.length) { done.add(day); stats.push({ day, files: files.length, arr: nA, dep: nD, rwy: nRw, stand: nSt }); }
}

// 4) birleştir, 35 günden eskileri at, özet dosyaları yaz
const now = Date.now() / 1000;
for (const kind of ['a', 'd']) {
  for (const [ap, C] of touched[kind]) {
    for (const [cs, rows] of C) {
      const f = path.join(OUT, kind, ap, cs + '.json');
      const old = readJson(f, []);
      const seen = new Set(), all = [];
      for (const r of [...old, ...rows]) { const k = Math.round(r[0] / 60); if (seen.has(k) || now - r[0] > KEEP) continue; seen.add(k); all.push(r); }
      all.sort((x, y) => y[0] - x[0]);
      writeJson(f, all);
    }
    // meydan özeti: tüm çağrı adları — pist sayıları ve park pozisyonları (yakın olanlar birleştirilir)
    const dir = path.join(OUT, kind, ap), sum = { n: 0, rwy: {}, st: [], cs: {} };
    for (const fn of fs.readdirSync(dir)) {
      if (!fn.endsWith('.json') || fn.startsWith('_')) continue;
      const rows = readJson(path.join(dir, fn), []).filter(r => now - r[0] <= KEEP);
      sum.cs[fn.slice(0, -5)] = rows.length;
      for (const r of rows) {
        sum.n++; if (r[1]) sum.rwy[r[1]] = (sum.rwy[r[1]] || 0) + 1;
        if (r[2] != null) { const s = sum.st.find(x => Math.abs(x[0] - r[2]) < 0.0003 && Math.abs(x[1] - r[3]) < 0.0003); if (s) s[2]++; else sum.st.push([r[2], r[3], 1]); }
      }
    }
    sum.st.sort((x, y) => y[2] - x[2]); sum.st = sum.st.slice(0, 80);
    writeJson(path.join(dir, '_sum.json'), sum);
  }
}
meta.days = [...done].filter(d => d >= new Date(Date.now() - 40 * 86400e3).toISOString().slice(0, 10)).sort();
meta.updated = new Date().toISOString();
meta.last = stats.concat((meta.last || []).filter(s => !stats.find(x => x.day === s.day))).slice(0, 10);
writeJson(path.join(OUT, '_meta.json'), meta);
log('bitti', stats.length, 'gün işlendi');
