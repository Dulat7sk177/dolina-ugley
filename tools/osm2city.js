// Конвертер OpenStreetMap → компактная карта города для игры
// node tools/osm2city.js <osm.json> <out.json>
const fs = require('fs');
const [, , inFile, outFile] = process.argv;
const j = JSON.parse(fs.readFileSync(inFile));
const LAT0 = 51.128207, LON0 = 71.430411; // Байтерек — центр карты
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MZ = 110574;
const BX = 2000, BZ = 1150; // границы карты (м)
const P = (g) => [Math.round((g.lon - LON0) * MX * 10) / 10, Math.round(-(g.lat - LAT0) * MZ * 10) / 10];
const inside = (x, z, pad = 0) => Math.abs(x) < BX + pad && Math.abs(z) < BZ + pad;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i += 2) { const k = (i + 2) % pts.length; a += pts[i] * pts[k + 1] - pts[k] * pts[i + 1]; } return a / 2; };
const centroid = (pts) => { let x = 0, z = 0; const n = pts.length / 2; for (let i = 0; i < pts.length; i += 2) { x += pts[i]; z += pts[i + 1]; } return [x / n, z / n]; };
const ring = (geom) => { const out = []; for (const g of geom) { const [x, z] = P(g); out.push(x, z); } if (out.length > 2 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2; return out; };

const W = { motorway: 20, trunk: 18, primary: 16, secondary: 13, tertiary: 10, primary_link: 8, secondary_link: 7, tertiary_link: 7, residential: 7, unclassified: 7, living_street: 6, service: 4.5, pedestrian: 8, busway: 7, footway: 2.5, cycleway: 2, path: 1.6, steps: 2.5 };
const out = { origin: [LAT0, LON0], bounds: [BX, BZ], buildings: [], roads: [], water: [], green: [], trees: [], landmarks: {} };

let akorda = null, khan = null;
for (const e of j.elements) {
  const t = e.tags || {};
  if (t.building && (e.type === 'way' || e.type === 'relation')) {
    let pts;
    if (e.type === 'way') pts = ring(e.geometry);
    else { const outers = (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => ring(m.geometry)); outers.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a))); pts = outers[0]; }
    if (!pts || pts.length < 6) continue;
    const [cx, cz] = centroid(pts);
    if (!inside(cx, cz)) continue;
    if (/Ақорда/.test(t.name || '')) { akorda = { x: cx, z: cz, p: pts }; continue; }
    if (/Хан Шатыр/.test(t.name || '')) { khan = { x: cx, z: cz }; continue; }
    if (Math.hypot(cx, cz) < 30) continue; // место под Байтерек
    let h = parseFloat(t.height);
    const lv = parseFloat(t['building:levels']);
    const kind = t.building;
    if (!h) h = lv ? lv * 3.2 + 1 : ({ apartments: 33, residential: 30, office: 40, commercial: 18, retail: 9, house: 7, garage: 3, garages: 3, kiosk: 3, roof: 5, industrial: 10, school: 13, university: 18, hotel: 35, government: 25, construction: 20, service: 4, shed: 3 }[kind] ?? 14) * (0.75 + hash(e.id) * 0.5);
    if (Math.abs(area(pts)) < 12) continue;
    out.buildings.push({ p: pts, h: Math.round(h * 10) / 10, k: kind, n: t.name || undefined, lv: lv || undefined });
  } else if (t.highway && e.type === 'way' && W[t.highway] && e.geometry) {
    const pts = ring(e.geometry).length ? e.geometry.map(P).flat() : [];
    if (!pts.length) continue;
    let any = false; for (let i = 0; i < pts.length; i += 2) if (inside(pts[i], pts[i + 1], 50)) { any = true; break; }
    if (!any) continue;
    out.roads.push({ w: t.width ? Math.min(30, parseFloat(t.width) || W[t.highway]) : W[t.highway], t: t.highway, p: pts, b: t.bridge && t.bridge !== 'no' ? 1 : undefined, tn: t.tunnel && t.tunnel !== 'no' ? 1 : undefined });
  } else if (t.natural === 'water' && e.type === 'way' && e.geometry) {
    out.water.push({ p: ring(e.geometry), river: t.water === 'river' ? 1 : undefined });
  } else if (t.natural === 'water' && e.type === 'relation') {
    for (const m of e.members || []) if (m.geometry && m.role === 'outer') out.water.push({ p: ring(m.geometry) });
  } else if ((t.leisure || t.landuse) && e.type === 'way' && e.geometry) {
    const k = t.leisure || t.landuse;
    const pts = ring(e.geometry);
    if (pts.length < 6) continue;
    const [cx, cz] = centroid(pts);
    if (!inside(cx, cz, 100)) continue;
    out.green.push({ k, p: pts });
  } else if (t.natural === 'tree' && e.type === 'node') {
    const [x, z] = P(e);
    if (inside(x, z)) out.trees.push(x, z);
  }
}
out.landmarks = { baiterek: { x: 0, z: 0 }, akorda, khan };
fs.writeFileSync(outFile, JSON.stringify(out));
console.log('buildings', out.buildings.length, 'roads', out.roads.length, 'water', out.water.length, 'green', out.green.length, 'trees', out.trees.length / 2, 'akorda', akorda && [akorda.x | 0, akorda.z | 0], 'khan', khan && [khan.x | 0, khan.z | 0]);
