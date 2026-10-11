/* İz incelemesi — iniş/kalkış pisti ve park pozisyonu.
   Girdi: readsb trace_full biçimi (adsb.lol globe_history). Çıktı: olay listesi. */

// ---- Pist geometrisi (OurAirports runways.csv) ----
export function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
export function loadRunways(csvText) {
  const lines = csvText.split('\n'), head = splitCsv(lines[0].trim()), col = n => head.indexOf(n);
  const I = { ap: col('airport_ident'), len: col('length_ft'), closed: col('closed'), le: col('le_ident'), he: col('he_ident'),
    lla: col('le_latitude_deg'), llo: col('le_longitude_deg'), hla: col('he_latitude_deg'), hlo: col('he_longitude_deg'), lel: col('le_elevation_ft'), hel: col('he_elevation_ft') };
  const aps = new Map();
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i].trim(); if (!ln) continue;
    const f = splitCsv(ln);
    if (f[I.closed] === '1' || !f[I.lla] || !f[I.hla] || !(+f[I.len] >= 5000)) continue;
    const ap = f[I.ap]; if (!/^[A-Z]{4}$/.test(ap)) continue;
    const r = { le: f[I.le], he: f[I.he], a: [+f[I.lla], +f[I.llo]], b: [+f[I.hla], +f[I.hlo]], el: +f[I.lel] || +f[I.hel] || 0 };
    if (!aps.has(ap)) aps.set(ap, { icao: ap, rw: [] });
    aps.get(ap).rw.push(r);
  }
  // 1°'lik hücrelere yerleştir
  const grid = new Map();
  for (const g of aps.values()) {
    const cells = new Set();
    g.rw.forEach(r => [r.a, r.b].forEach(p => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.add(`${Math.floor(p[0]) + dy},${Math.floor(p[1]) + dx}`); }));
    cells.forEach(c => { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(g); });
  }
  return { aps, grid };
}
const proj = (lat0, lon0) => { const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540; return (la, lo) => [(lo - lon0) * kx, (la - lat0) * ky]; };
// bir noktanın pist merkez hattına uzaklığı (m) — pist boyunca değilse uçlara uzaklık
export function rwyDist(g, lat, lon) {
  const P = proj(lat, lon); let best = 1e12;
  for (const r of g.rw) {
    const A = P(r.a[0], r.a[1]), B = P(r.b[0], r.b[1]), dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((-A[0]) * dx + (-A[1]) * dy) / L2));
    const d = Math.hypot(A[0] + t * dx, A[1] + t * dy);
    if (d < best) best = d;
  }
  return best;
}
export function nearestAirport(R, lat, lon, maxM = 3000) {
  const L = R.grid.get(`${Math.floor(lat)},${Math.floor(lon)}`) || [];
  let best = null, bd = maxM;
  for (const g of L) { const d = rwyDist(g, lat, lon); if (d < bd) { bd = d; best = g; } }
  return best;
}

// ---- Pist tahmini: path = [[t, lat, lon, baroAlt(m)|null, track, onGround], ...] ----
export function histAnalyze(path, geo, mode) {
  if (!geo || !geo.rw || !geo.rw.length || !path || path.length < 2) return {};
  const r0 = geo.rw[0], lat0 = r0.a[0], lon0 = r0.a[1];
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const P = (la, lo) => [(lo - lon0) * kx, (la - lat0) * ky];
  const elevM = (geo.rw.find(r => r.el) || {}).el * 0.3048 || 0;
  const ends = [];
  geo.rw.forEach(r => {
    const A = P(r.a[0], r.a[1]), B = P(r.b[0], r.b[1]), dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
    if (len < 300) return;
    const h = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    ends.push({ id: r.le, T: A, u: [dx / len, dy / len], h, len });
    ends.push({ id: r.he, T: B, u: [-dx / len, -dy / len], h: (h + 180) % 360, len });
  });
  if (!ends.length) return {};
  const hd = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const pts = path.filter(p => p && isFinite(p[1]) && isFinite(p[2])).map(p => { const xy = P(p[1], p[2]); return { t: p[0], x: xy[0], y: xy[1], alt: p[3], trk: p[4], gnd: !!p[5] }; });
  if (pts.length < 2) return {};
  const near = q => Math.hypot(q.x, q.y) < 30000;
  const rel = (e, q) => { const vx = q.x - e.T[0], vy = q.y - e.T[1]; return { al: vx * e.u[0] + vy * e.u[1], lt: vx * e.u[1] - vy * e.u[0] }; };
  const score = {}, add = (id, s) => { score[id] = (score[id] || 0) + s; };
  const seq = mode === 'arr' ? pts.slice().reverse() : pts;
  let gCount = 0;
  if (mode === 'arr') {
    const lastAir = pts.map(q => !q.gnd).lastIndexOf(true);
    for (let i = Math.max(0, lastAir + 1); i < pts.length && gCount < 4; i++) {
      const q = pts[i]; if (!q.gnd || !near(q)) continue;
      ends.forEach(e => { const r = rel(e, q); if (r.al > -150 && r.al < e.len + 150 && Math.abs(r.lt) < 50 && (q.trk == null || hd(q.trk, e.h) < 30)) add(e.id, 3); });
      gCount++;
    }
  } else {
    const firstAir = pts.findIndex(q => !q.gnd);
    for (let i = firstAir - 1; i >= 0 && gCount < 4; i--) {
      const q = pts[i]; if (!q.gnd || !near(q)) continue;
      ends.forEach(e => { const r = rel(e, q); if (r.al > -150 && r.al < e.len + 150 && Math.abs(r.lt) < 50 && q.trk != null && hd(q.trk, e.h) < 30) add(e.id, 3); });
      gCount++;
    }
  }
  let used = 0;
  for (const q of seq) {
    if (q.gnd) continue;
    if (!near(q)) { if (used) break; else continue; }
    if (q.alt != null && q.alt - elevM > 1300) { if (used > 2) break; continue; }
    let best = null;
    ends.forEach(e => {
      const r = rel(e, q);
      const inCone = mode === 'arr' ? (r.al > -22000 && r.al < e.len) : (r.al > 0 && r.al < e.len + 22000);
      const dist = mode === 'arr' ? Math.max(0, -r.al) : Math.max(0, r.al - e.len);
      if (!inCone || Math.abs(r.lt) > 250 + 0.07 * dist) return;
      if (q.trk != null && hd(q.trk, e.h) > 25) return;
      const s = Math.abs(r.lt);
      if (!best || s < best.s) best = { id: e.id, s, dist };
    });
    if (best) { add(best.id, best.dist < 8000 ? 2 : 1); used++; }
    if (used >= 12) break;
  }
  let rwy = '', top = 0, second = 0;
  for (const id in score) { if (score[id] > top) { second = top; top = score[id]; rwy = id; } else if (score[id] > second) second = score[id]; }
  if (top < 2 || top === second) rwy = '';
  return { rwy };
}

// ---- Bir uçağın günlük izinden iniş ve kalkış olayları ----
const FT = 0.3048;
const dm = (a, b) => { const kx = 111320 * Math.cos(a.lat * Math.PI / 180); return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 110540); };
export function extractEvents(J, R, wantPrefix = 'THY') {
  const base = +J.timestamp || 0, tr = Array.isArray(J.trace) ? J.trace : [];
  const pts = [], flights = [];
  for (const p of tr) {
    if (!Array.isArray(p) || !isFinite(p[1]) || !isFinite(p[2])) continue;
    const t = base + (+p[0] || 0);
    const ac = p[8] && typeof p[8] === 'object' ? p[8] : null;
    if (ac && ac.flight) flights.push({ t, cs: String(ac.flight).trim().toUpperCase() });
    pts.push({ t, lat: +p[1], lon: +p[2], gnd: p[3] === 'ground', alt: typeof p[3] === 'number' ? p[3] : null, gs: typeof p[4] === 'number' ? p[4] : null, trk: typeof p[5] === 'number' ? p[5] : null });
  }
  if (pts.length < 3) return [];
  const csAt = (t, prefer) => {
    let best = null, bd = 1e12;
    for (const f of flights) { let d = Math.abs(f.t - t); if ((prefer === 'before' && f.t > t) || (prefer === 'after' && f.t < t)) d += 1800; if (d < bd) { bd = d; best = f; } }
    return best && bd < 4 * 3600 ? best.cs : '';
  };
  const toPath = (a, b) => pts.slice(a, b).map(q => [q.t, q.lat, q.lon, q.alt == null ? null : q.alt * FT, q.trk, q.gnd]);
  // yerdeki duruş kümeleri (≤3 kt, 40 m içinde)
  const clusters = (a, b) => {
    const C = []; let c = null;
    for (let i = a; i < b; i++) {
      const q = pts[i];
      if (!q.gnd || (q.gs != null && q.gs > 3)) { c = null; continue; }
      if (c && dm(c, q) <= 40) { c.t2 = q.t; c.n++; c.i2 = i; }
      else { c = { lat: q.lat, lon: q.lon, t1: q.t, t2: q.t, n: 1, i1: i, i2: i }; C.push(c); }
    }
    return C;
  };
  const pick = (C, sc) => { let best = null, bs = 120; C.forEach((c, k) => { const v = sc(c, k); if (v >= bs) { bs = v; best = c; } }); return best; };
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.t - a.t > 240) continue;
    const landing = !a.gnd && a.alt != null && b.gnd, takeoff = a.gnd && !b.gnd && b.alt != null;
    if (!landing && !takeoff) continue;
    const ref = landing ? b : a;
    const g = nearestAirport(R, ref.lat, ref.lon, 2500); if (!g) continue;
    const cs = csAt(ref.t, landing ? 'before' : 'after');
    if (!cs.startsWith(wantPrefix)) continue;
    // pist: inişte son 15 dk + 2 dk yer, kalkışta 2 dk yer + ilk 15 dk
    let s = i, e = i;
    if (landing) { while (s > 0 && ref.t - pts[s - 1].t < 900) s--; while (e < pts.length && pts[e].t - ref.t < 120) e++; }
    else { s = i - 1; while (s > 0 && ref.t - pts[s - 1].t < 120) s--; while (e < pts.length && pts[e].t - ref.t < 900) e++; }
    const rwy = histAnalyze(toPath(s, e), g, landing ? 'arr' : 'dep').rwy || '';
    // park pozisyonu: yerde kalınan bölüm
    let st = null;
    if (landing) {
      let j = i; while (j < pts.length && pts[j].gnd) j++;
      const C = clusters(i, j).filter(c => rwyDist(g, c.lat, c.lon) >= 200);
      const endGap = j >= pts.length || pts[j].t - pts[j - 1].t > 900;
      // en uzun duruş; iz park yerinde kesildiyse son duruş
      st = pick(C, (c, k) => (c.t2 - c.t1) + (k === C.length - 1 && endGap && c.i2 === j - 1 ? 7200 : 0));
    } else {
      let j = i - 1; while (j > 0 && pts[j - 1].gnd) j--;
      const C = clusters(j, i).filter(c => rwyDist(g, c.lat, c.lon) >= 200);
      const startGap = j === 0 || pts[j].t - pts[j - 1].t > 900;
      st = pick(C, (c, k) => (c.t2 - c.t1) + (k === 0 && startGap && c.i1 === j ? 7200 : 0));
    }
    out.push({ kind: landing ? 'a' : 'd', ap: g.icao, cs, ts: Math.round(ref.t), rwy, slat: st ? +st.lat.toFixed(5) : null, slon: st ? +st.lon.toFixed(5) : null, reg: J.r || '', type: J.t || '' });
  }
  return out;
}
