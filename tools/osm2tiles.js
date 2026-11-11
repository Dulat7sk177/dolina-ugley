// Конвертер OpenStreetMap → плитки города 500×500 м для игры (весь город, подгружается по мере движения)
// node tools/osm2tiles.js <outDir> <osm1.json> [osm2.json ...]
const fs = require('fs');
const path = require('path');
const [, , outDir, ...inFiles] = process.argv;
const LAT0 = 51.128207, LON0 = 71.430411; // Байтерек — начало координат
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MZ = 110574;
const TILE = 500, PAD = 24;
const LIM = [-10500, -13500, 13000, 10500]; // границы скачанной области (м)
const r1 = (v) => Math.round(v * 10) / 10;
const P = (g) => [r1((g.lon - LON0) * MX), r1(-(g.lat - LAT0) * MZ)];
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const k = (i + 2) % p.length; a += p[i] * p[k + 1] - p[k] * p[i + 1]; } return a / 2; };
const centroid = (p) => { let x = 0, z = 0; const n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; };
const bbox = (p) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } return [x0, z0, x1, z1]; };
const ring = (geom) => { const out = []; for (const g of geom) { if (!g) continue; const [x, z] = P(g); out.push(x, z); } if (out.length > 2 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2; return out; };
const pip = (p, x, z) => { let ins = false; for (let i = 0, k = p.length - 2; i < p.length; k = i, i += 2) { if ((p[i + 1] > z) !== (p[k + 1] > z) && x < ((p[k] - p[i]) * (z - p[i + 1])) / (p[k + 1] - p[i + 1]) + p[i]) ins = !ins; } return ins; };
// отсечение многоугольника прямоугольником (Сазерленд — Ходжман)
function clipPoly(p, x0, z0, x1, z1) {
  const edges = [[0, x0, 1], [0, x1, -1], [1, z0, 1], [1, z1, -1]];
  let cur = p;
  for (const [ax, v, s] of edges) {
    const out = [];
    for (let i = 0; i < cur.length; i += 2) {
      const k = (i + 2) % cur.length, a = [cur[i], cur[i + 1]], b = [cur[k], cur[k + 1]];
      const ia = (a[ax] - v) * s >= 0, ib = (b[ax] - v) * s >= 0;
      if (ia) out.push(a[0], a[1]);
      if (ia !== ib) { const t = (v - a[ax]) / (b[ax] - a[ax]); out.push(r1(a[0] + (b[0] - a[0]) * t), r1(a[1] + (b[1] - a[1]) * t)); }
    }
    cur = out;
    if (cur.length < 6) return null;
  }
  return cur;
}

const W = { motorway: 20, trunk: 18, primary: 16, secondary: 13, tertiary: 10, motorway_link: 9, trunk_link: 9, primary_link: 8, secondary_link: 7, tertiary_link: 7, residential: 7, unclassified: 7, living_street: 6, service: 4.5, pedestrian: 8, busway: 7, footway: 2.5, cycleway: 2, path: 1.6, steps: 2.5 };
const DEF_H = { apartments: 33, residential: 30, office: 40, commercial: 18, retail: 9, house: 6, detached: 6, semidetached_house: 6, garage: 3, garages: 3, kiosk: 3, roof: 5, industrial: 10, warehouse: 9, school: 13, kindergarten: 8, university: 18, hotel: 35, government: 25, construction: 20, service: 4, shed: 3, hut: 3, hospital: 16, church: 14, mosque: 16 };
// места, где боссы ждут боя: [название, шаблон имени в OSM, запасные координаты]
const PLACES = [
  ['Бульвар Нуржол', null, 51.1283, 71.4210],
  ['Хан Шатыр', /Хан Шатыр|Khan Shatyr/i, 51.1326, 71.4037],
  ['Ак Орда', /Ақорда|Акорда/i, 51.1259, 71.4463],
  ['Мечеть Хазрет Султан', /Хазрет Султан|Әзірет Сұлтан/i, 51.1255, 71.4720],
  ['Дворец мира и согласия', /Бейбітшілік және келісім сарайы|Дворец мира и согласия/i, 51.1232, 71.4636],
  ['EXPO — Нур Алем', /Нұр Әлем|Нур Алем|Nur Alem/i, 51.0893, 71.4160],
  ['Mega Silk Way', /Mega Silk Way|Мега Silk Way/i, 51.0890, 71.4075],
  ['Назарбаев Университет', /Назарбаев Университет|Nazarbayev University/i, 51.0906, 71.3985],
  ['Астана Арена', /Астана Арена|Astana Arena/i, 51.1083, 71.4025],
  ['Барыс Арена', /Барыс Арена|Barys Arena/i, 51.1052, 71.3975],
  ['Вокзал Нурлы Жол', /Нұрлы жол|Нурлы Жол/i, 51.1124, 71.5320],
  ['Вокзал Астана-1', /Астана-1|вокзал Астана/i, 51.1956, 71.4090],
  ['Центральный парк', /Орталық саябақ|Центральный парк|Столичный парк/i, 51.1560, 71.4190],
  ['Астана Опера', /Астана Опера|Astana Opera/i, 51.1352, 71.4105],
  ['ТРЦ Керуен', /Керуен|Keruen/i, 51.1281, 71.4247],
  ['Конгресс-холл', /Конгресс-холл|Конгресс холл/i, 51.1690, 71.4230],
  ['Столичный цирк', /цирк/i, 51.1337, 71.4012],
  ['ТРЦ Евразия', /Евразия/i, 51.1480, 71.4300],
  ['Думан', /Думан/i, 51.1447, 71.4155],
  ['Стадион им. Мунайтпасова', /Мұңайтпасов|Мунайтпасов/i, 51.1630, 71.4170],
];

// известные здания: по названию в OSM им назначается фасад с их настоящей фотографии
const MARKS = [
  [/Emerald|Изумрудн|Северноеs*[CС]ияние/i, 'rp_astana_emerald'],
  [/Темір Жолы|Темир Жолы/i, 'rp_astana_ktz'],
  [/Транспорт Тауэр/i, 'glassBronze'],
  [/НК "?КазМунайГаз/i, 'rp_astana_kmg'],
  [/Алтын Орда|межрайонный административн/i, 'rp_astana_gold'],
  [/Министрліктер үйі|Дом Министерств/i, 'rp_astana_beige'],
  [/Talan|Ritz-Carlton/i, 'rp_astana_talan'],
  [/Нурсая|Nursaya|Хайвил|Highvill|Триумф|Гранд Алатау/i, 'rp_astana_beige'],
  [/Abu Dhabi Plaza/i, 'rp_astana_w1'],
];
const marks = [];
const tiles = new Map();
const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
const T = (ix, iz) => { const k = ix + ',' + iz; if (!tiles.has(k)) tiles.set(k, { buildings: [], roads: [], water: [], green: [], areas: [], trees: [], parking: [], fences: [], stops: [], signals: [], benches: [] }); return tiles.get(k); };
const eachTile = (bb, pad, fn) => { for (let ix = Math.floor((bb[0] - pad) / TILE); ix <= Math.floor((bb[2] + pad) / TILE); ix++) for (let iz = Math.floor((bb[1] - pad) / TILE); iz <= Math.floor((bb[3] + pad) / TILE); iz++) fn(ix, iz); };
const addClipped = (key, p, extra) => { eachTile(bbox(p), PAD, (ix, iz) => { const c = clipPoly(p, ix * TILE - PAD, iz * TILE - PAD, (ix + 1) * TILE + PAD, (iz + 1) * TILE + PAD); if (c) T(ix, iz)[key].push({ ...extra, p: c }); }); };

const seen = new Set();
const buildings = [], parts = [], named = [], roadPts = [];
let akorda = null, khan = null;
let n = 0;
for (const f of inFiles) {
  const els = JSON.parse(fs.readFileSync(f)).elements;
  for (const e of els) {
    const key = e.type[0] + e.id;
    if (seen.has(key)) continue;
    seen.add(key); n++;
    const t = e.tags || {};
    const poly = () => {
      if (e.type === 'way') return e.geometry ? ring(e.geometry) : null;
      const outers = (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => ring(m.geometry));
      outers.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
      return outers[0];
    };
    if (t.name && (e.type === 'way' || e.type === 'relation') && (t.building || t.leisure || t.amenity || t.tourism || t.railway || t.shop)) {
      const p = poly();
      if (p && p.length >= 6) { const [cx, cz] = centroid(p); named.push({ n: t.name + ' ' + (t['name:ru'] || '') + ' ' + (t['name:en'] || ''), x: cx, z: cz, a: Math.abs(area(p)) }); }
    }
    if (t.name && e.type !== 'node' && (t.building || t['building:part'] || t.landuse || e.type === 'relation')) {
      const nm = t.name + ' ' + (t['name:ru'] || '') + ' ' + (t['name:en'] || '');
      const mk = MARKS.find(([re]) => re.test(nm));
      if (mk) {
        const rings = e.type === 'way' ? (e.geometry ? [ring(e.geometry)] : []) : (e.members || []).filter((m) => m.geometry).map((m) => ring(m.geometry));
        for (const p of rings) if (p.length >= 6) { const bb = bbox(p); if (bb[2] - bb[0] < 700 && bb[3] - bb[1] < 700) marks.push({ bb, s: mk[1] }); }
      }
    }
    if (t['building:part'] && e.type !== 'node') {
      const p = poly();
      if (!p || p.length < 6 || Math.abs(area(p)) < 6) continue;
      const lv = parseFloat(t['building:levels']);
      const h = parseFloat(t.height) || (lv ? lv * 3.3 + 1 : 0);
      if (!h) continue;
      const mh = parseFloat(t.min_height) || (parseFloat(t['building:min_level']) || 0) * 3.3;
      const [cx, cz] = centroid(p);
      parts.push({ p, h: r1(h), mh: mh ? r1(mh) : undefined, k: 'part', cx, cz });
      continue;
    }
    if (t.amenity === 'parking' && e.type === 'way' && e.geometry) { const p = ring(e.geometry); if (p.length >= 6) { const [cx, cz] = centroid(p); T(...tileOf(cx, cz)).parking.push({ p }); } continue; }
    if (t.barrier && /fence|wall/.test(t.barrier) && e.type === 'way' && e.geometry) { const p = e.geometry.map(P).flat(); if (p.length >= 4) T(...tileOf(p[0], p[1])).fences.push({ t: t.barrier === 'fence' ? 0 : 1, p }); continue; }
    if (e.type === 'node') {
      const [x, z] = P(e), tl = T(...tileOf(x, z));
      if (t.highway === 'bus_stop') tl.stops.push(x, z);
      else if (t.highway === 'traffic_signals') tl.signals.push(x, z);
      else if (t.amenity === 'bench') tl.benches.push(x, z);
      else if (t.natural === 'tree') tl.trees.push(x, z);
      continue;
    }
    if (t.building) {
      const p = poly();
      if (!p || p.length < 6 || Math.abs(area(p)) < 12) continue;
      const [cx, cz] = centroid(p);
      if (/Ақорда/.test(t.name || '') && Math.abs(area(p)) > 2000) { akorda = { x: cx, z: cz }; continue; }
      if (/Хан Шатыр/.test(t.name || '')) { khan = { x: cx, z: cz }; continue; }
      if (Math.hypot(cx, cz) < 30) continue; // место под Байтерек
      let h = parseFloat(t.height);
      const lv = parseFloat(t['building:levels']);
      if (!h) h = lv ? lv * 3.2 + 1 : (DEF_H[t.building] ?? 9) * (0.75 + hash(e.id) * 0.5);
      buildings.push({ p, h: r1(h), k: t.building, lv: lv || undefined, cx, cz, bb: bbox(p) });
    } else if (t.highway && e.type === 'way' && W[t.highway] && e.geometry) {
      const p = e.geometry.map(P).flat();
      if (p.length < 4) continue;
      const w = t.width ? Math.min(30, parseFloat(t.width) || W[t.highway]) : W[t.highway];
      const road = { w, t: t.highway, b: t.bridge && t.bridge !== 'no' ? 1 : undefined, tn: t.tunnel && t.tunnel !== 'no' ? 1 : undefined, n: t['name:ru'] || t.name || undefined }; // n — название улицы для мини-карты
      if (w >= 7 && !road.b && !road.tn) for (let i = 0; i < p.length; i += 2) roadPts.push(p[i], p[i + 1]);
      // в каждую плитку кладём только те отрезки дороги, что проходят рядом с ней
      const runs = new Map();
      for (let i = 0; i + 3 < p.length; i += 2) {
        const sb = [Math.min(p[i], p[i + 2]), Math.min(p[i + 1], p[i + 3]), Math.max(p[i], p[i + 2]), Math.max(p[i + 1], p[i + 3])];
        eachTile(sb, PAD + w, (ix, iz) => {
          const k = ix + ',' + iz; let r = runs.get(k);
          if (!r || r.last !== i) { if (r) T(ix, iz).roads.push({ ...road, p: r.p }); r = { p: [p[i], p[i + 1]] }; runs.set(k, r); }
          r.p.push(p[i + 2], p[i + 3]); r.last = i + 2;
        });
      }
      for (const [k, r] of runs) { const [ix, iz] = k.split(',').map(Number); T(ix, iz).roads.push({ ...road, p: r.p }); }
    } else if (t.natural === 'water') {
      const list = e.type === 'way' ? (e.geometry ? [ring(e.geometry)] : []) : (e.members || []).filter((m) => m.geometry && m.role === 'outer').map((m) => ring(m.geometry));
      for (const p of list) if (p.length >= 6) addClipped('water', p, {});
    } else if ((t.leisure || t.landuse) && e.type === 'way' && e.geometry) {
      const k = t.leisure || t.landuse, p = ring(e.geometry);
      if (p.length < 6) continue;
      if (k === 'playground' || k === 'pitch') { const [cx, cz] = centroid(p); T(...tileOf(cx, cz)).areas.push({ k, p }); }
      if (k !== 'playground') addClipped('green', p, {});
    }
  }
}
console.log('elements', n, 'buildings', buildings.length, 'parts', parts.length);

// контуры комплексов, у которых есть «части», не рисуем — вместо них настоящие башни
const pgrid = new Map();
for (const pt of parts) { const k = Math.floor(pt.cx / 200) + ',' + Math.floor(pt.cz / 200); if (!pgrid.has(k)) pgrid.set(k, []); pgrid.get(k).push(pt); }
const hasPart = (b) => { for (let gx = Math.floor(b.bb[0] / 200); gx <= Math.floor(b.bb[2] / 200); gx++) for (let gz = Math.floor(b.bb[1] / 200); gz <= Math.floor(b.bb[3] / 200); gz++) for (const pt of pgrid.get(gx + ',' + gz) || []) if (pip(b.p, pt.cx, pt.cz)) return true; return false; };
const skipNear = (x, z) => Math.hypot(x, z) < 30 || (akorda && Math.hypot(x - akorda.x, z - akorda.z) < 70) || (khan && Math.hypot(x - khan.x, z - khan.z) < 110);
const all = [...buildings.filter((b) => !hasPart(b)), ...parts.filter((pt) => !skipNear(pt.cx, pt.cz))];
const sky = {}, skyS = {};
let nTall = 0, nMark = 0;
const markOf = (b) => { for (const m of marks) if (b.cx > m.bb[0] - 6 && b.cx < m.bb[2] + 6 && b.cz > m.bb[1] - 6 && b.cz < m.bb[3] + 6) return m.s; };
for (const b of all) {
  const [ix, iz] = tileOf(b.cx, b.cz);
  const s = b.h >= 12 ? markOf(b) : undefined; if (s) nMark++;
  T(ix, iz).buildings.push({ p: b.p, h: b.h, mh: b.mh, k: b.k, lv: b.lv, s });
  if (b.h >= 22 && !(b.mh > 3)) { const l = (sky[ix + ',' + iz] ||= []); if (s) (skyS[ix + ',' + iz] ||= {})[l.length] = s; l.push([Math.round(b.h), ...b.p.map(Math.round)]); nTall++; }
}

// места для боссов: ближайшая широкая улица рядом с объектом
const bgrid = new Map();
for (const b of all) { const k = Math.floor(b.cx / 100) + ',' + Math.floor(b.cz / 100); if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b); }
const inBuilding = (x, z) => { const gx = Math.floor(x / 100), gz = Math.floor(z / 100); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of bgrid.get(gx + i + ',' + (gz + j)) || []) if (pip(b.p, x, z)) return true; return false; };
const places = [];
for (const [name, re, lat, lon] of PLACES) {
  let [x, z] = P({ lat, lon }), found = false;
  if (re) { const m = named.filter((o) => re.test(o.n)).sort((a, b) => b.a - a.a)[0]; if (m) { x = m.x; z = m.z; found = true; } }
  if (name === 'Ак Орда' && akorda) { x = akorda.x - 150; z = akorda.z; found = true; }
  if (name === 'Хан Шатыр' && khan) { x = khan.x; z = khan.z; found = true; }
  let best = Infinity, bx = x, bz = z;
  for (let i = 0; i < roadPts.length; i += 2) { const d = Math.hypot(roadPts[i] - x, roadPts[i + 1] - z); if (d < best && d > (name === 'Хан Шатыр' ? 120 : 15) && !inBuilding(roadPts[i], roadPts[i + 1])) { best = d; bx = roadPts[i]; bz = roadPts[i + 1]; } }
  if (best > 600) { console.log('  нет улицы рядом:', name); continue; }
  if (places.some((q) => Math.hypot(q.x - bx, q.z - bz) < 250)) { console.log('  слишком близко к другому месту:', name); continue; }
  places.push({ n: name, x: Math.round(bx), z: Math.round(bz) });
  console.log(' ', found ? 'OSM ' : 'коорд', name, Math.round(bx), Math.round(bz));
}

// запись
fs.rmSync(path.join(outDir, 't'), { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 't'), { recursive: true });
const list = [];
let bytes = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, nb = 0;
for (const [k, t] of tiles) {
  if (!t.buildings.length && !t.roads.length && !t.water.length) continue;
  { const [ix, iz] = k.split(',').map(Number); if (ix * TILE < LIM[0] || iz * TILE < LIM[1] || (ix + 1) * TILE > LIM[2] || (iz + 1) * TILE > LIM[3]) continue; }
  for (const key of Object.keys(t)) if (!t[key].length) delete t[key];
  const [ix, iz] = k.split(',').map(Number);
  const s = JSON.stringify(t);
  fs.writeFileSync(path.join(outDir, 't', `${ix}_${iz}.json`), s);
  bytes += s.length; list.push(k); nb += (t.buildings || []).length;
  x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz);
}
const index = { origin: [LAT0, LON0], tile: TILE, bounds: [x0 * TILE, z0 * TILE, (x1 + 1) * TILE, (z1 + 1) * TILE], tiles: list, sky, skyS, places, landmarks: { baiterek: { x: 0, z: 0 }, akorda, khan } };
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
console.log('marks', marks.length, 'marked buildings', nMark);
console.log('tiles', list.length, 'buildings', nb, 'tall', nTall, 'places', places.length, 'size MB', (bytes / 1e6).toFixed(1), 'index KB', (JSON.stringify(index).length / 1e3) | 0, 'bounds', index.bounds);
