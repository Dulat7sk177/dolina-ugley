// Мини-карта Астаны: дороги, дома, вода и названия улиц из плиток OpenStreetMap.
// Карта повёрнута по взгляду камеры (вперёд — вверх), игрок в центре.
import { mapTiles } from './astana.js';

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link']);
const MID = new Set(['tertiary', 'residential', 'unclassified', 'living_street', 'secondary_link', 'tertiary_link']);
const FOOT = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);
const SHORT = [[/^улица /i, 'ул. '], [/ улица$/i, ' ул.'], [/^проспект /i, 'пр. '], [/ проспект$/i, ' пр.'], [/^переулок /i, 'пер. '], [/^бульвар /i, 'б-р '], [/^шоссе /i, 'ш. '], [/ шоссе$/i, ' ш.'], [/^площадь /i, 'пл. '], [/^набережная /i, 'наб. ']];
const short = (n) => { for (const [re, to] of SHORT) n = n.replace(re, to); return n; };

const line = (path, p) => { path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]); };
const poly = (path, p) => { line(path, p); path.closePath(); };

// один раз на плитку: готовые контуры и точки для подписей улиц
function prepare(d) {
  const m = { major: new Path2D(), mid: new Path2D(), minor: new Path2D(), foot: new Path2D(), bld: new Path2D(), water: new Path2D(), green: new Path2D(), labels: [] };
  for (const w of d.water || []) poly(m.water, w.p);
  for (const g of d.green || []) if (g.p) poly(m.green, g.p);
  for (const b of d.buildings || []) poly(m.bld, b.p);
  for (const r of d.roads || []) {
    if (r.tn) continue;
    const cls = MAJOR.has(r.t) ? 2 : MID.has(r.t) ? 1 : 0;
    line(cls === 2 ? m.major : cls === 1 ? m.mid : FOOT.has(r.t) ? m.foot : m.minor, r.p);
    if (!r.n) continue;
    // подпись — посередине самого длинного отрезка
    let best = 0, bi = -1;
    for (let i = 0; i + 3 < r.p.length; i += 2) { const l = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]); if (l > best) { best = l; bi = i; } }
    if (bi < 0 || best < 25) continue;
    m.labels.push({ n: short(r.n), x: (r.p[bi] + r.p[bi + 2]) / 2, z: (r.p[bi + 1] + r.p[bi + 3]) / 2, dx: (r.p[bi + 2] - r.p[bi]) / best, dz: (r.p[bi + 3] - r.p[bi + 1]) / best, cls, len: best });
  }
  return m;
}

// название ближайшей улицы (в пределах 40 м)
const one = [];
export function streetAt(x, z) {
  let best = 40, name = '';
  for (const t of mapTiles(x, z, 45, one)) for (const r of t.roads || []) {
    if (!r.n) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], vx = p[i + 2] - ax, vz = p[i + 3] - az, l2 = vx * vx + vz * vz || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)), dd = Math.hypot(x - ax - vx * u, z - az - vz * u);
      if (dd < best) { best = dd; name = r.n; }
    }
  }
  return name;
}

const tiles = [];
// s: { x, z, yaw, radius, others: [{x, z}], enemies: [{x, z}], target: {x, z, boss} | null }
export function drawMinimap(cv, s) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  const cx = W / 2, cy = H * 0.58, k = Math.min(W, H) / 2 / s.radius; // пикселей на метр
  const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);
  // мир → экран: вперёд по взгляду — вверх
  const a = -cs * k, b = -sn * k, c = sn * k, d = -cs * k;
  const e = cx - (a * s.x + c * s.z), f = cy - (b * s.x + d * s.z);
  const SX = (x, z) => a * x + c * z + e, SY = (x, z) => b * x + d * z + f;

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1b1f24'; g.fillRect(0, 0, W, H);
  mapTiles(s.x, s.z, s.radius * 1.5, tiles);
  for (const t of tiles) if (!t._mm) t._mm = prepare(t);
  g.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = '#243a2a'; for (const t of tiles) g.fill(t._mm.green);
  g.fillStyle = '#274863'; for (const t of tiles) g.fill(t._mm.water);
  const px = 1 / k; // один пиксель в метрах
  const far = s.radius > 400;
  if (!far) { g.strokeStyle = '#4b5158'; g.lineWidth = 1.2 * px; for (const t of tiles) g.stroke(t._mm.foot); }
  g.strokeStyle = '#6f757d'; g.lineWidth = Math.max(4, 1.6 * px); for (const t of tiles) g.stroke(t._mm.minor);
  g.strokeStyle = '#a3a8ae'; g.lineWidth = Math.max(7, 2.4 * px); for (const t of tiles) g.stroke(t._mm.mid);
  g.strokeStyle = '#d9bd78'; g.lineWidth = Math.max(13, 3.4 * px); for (const t of tiles) g.stroke(t._mm.major);
  g.fillStyle = '#434a55'; for (const t of tiles) g.fill(t._mm.bld);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // названия улиц: по одному на улицу, ближайшее к игроку, без наложений
  const pick = new Map();
  for (const t of tiles) for (const L of t._mm.labels) {
    if (far && L.cls === 0) continue;
    const x = SX(L.x, L.z), y = SY(L.x, L.z);
    if (x < 14 || x > W - 14 || y < 10 || y > H - 10) continue;
    const dd = Math.hypot(x - cx, y - cy) - L.cls * 40 - Math.min(40, L.len * k);
    const o = pick.get(L.n);
    if (!o || dd < o.dd) pick.set(L.n, { L, x, y, dd });
  }
  const list = [...pick.values()].sort((p, q) => q.L.cls - p.L.cls || p.dd - q.dd);
  const boxes = [];
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  for (const { L, x, y } of list) {
    if (boxes.length >= (far ? 9 : 7)) break;
    const size = L.cls === 2 ? 11.5 : 10.5;
    g.font = `${L.cls === 2 ? 700 : 600} ${size}px system-ui, "Segoe UI", sans-serif`;
    const tw = g.measureText(L.n).width, r = tw / 2 + 4;
    if (x - r * 0.6 < 0 || x + r * 0.6 > W) continue;
    if (boxes.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + r) * 0.75)) continue;
    boxes.push({ x, y, r });
    let ang = Math.atan2(b * L.dx + d * L.dz, a * L.dx + c * L.dz);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    g.save(); g.translate(x, y); g.rotate(ang);
    g.strokeStyle = 'rgba(12,14,17,0.9)'; g.lineWidth = 3; g.strokeText(L.n, 0, 0);
    g.fillStyle = L.cls === 2 ? '#ffe9b0' : '#eef1f4'; g.fillText(L.n, 0, 0);
    g.restore();
  }

  const dot = (x, z, col, r) => { const X = SX(x, z), Y = SY(x, z); if (X < -4 || X > W + 4 || Y < -4 || Y > H + 4) return; g.fillStyle = col; g.beginPath(); g.arc(X, Y, r, 0, 6.3); g.fill(); };
  for (const en of s.enemies || []) dot(en.x, en.z, '#e2483b', 2.4);
  for (const o of s.others || []) { dot(o.x, o.z, '#0d1014', 5); dot(o.x, o.z, '#5fd0ff', 3.6); }
  // цель (логово босса): метка на карте или стрелка у края
  if (s.target) {
    let X = SX(s.target.x, s.target.z), Y = SY(s.target.x, s.target.z);
    const m = 12, out = X < m || X > W - m || Y < m || Y > H - m;
    if (out) { const vx = X - cx, vy = Y - cy, tt = Math.min(vx > 0 ? (W - m - cx) / vx : vx < 0 ? (m - cx) / vx : 1e9, vy > 0 ? (H - m - cy) / vy : vy < 0 ? (m - cy) / vy : 1e9); X = cx + vx * tt; Y = cy + vy * tt; }
    g.fillStyle = s.target.boss ? '#ff4d3d' : '#ffb347'; g.strokeStyle = '#14100c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X, Y - 8); g.lineTo(X + 7, Y); g.lineTo(X, Y + 8); g.lineTo(X - 7, Y); g.closePath(); g.stroke(); g.fill();
    g.fillStyle = '#14100c'; g.font = '700 10px system-ui, sans-serif'; g.fillText('!', X, Y + 0.5);
  }
  // игрок
  g.fillStyle = '#ffffff'; g.strokeStyle = '#14100c'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 6, cy + 6); g.lineTo(cx, cy + 3); g.lineTo(cx - 6, cy + 6); g.closePath(); g.stroke(); g.fill();
  // север
  const Nx = c / k, Ny = d / k; // направление «на север» (−z) на экране: (−c, −d)/k
  const R = 13, bx0 = 16, by0 = 16;
  g.fillStyle = 'rgba(12,14,17,0.75)'; g.beginPath(); g.arc(bx0, by0, R, 0, 6.3); g.fill();
  g.save(); g.translate(bx0, by0); g.rotate(Math.atan2(-Ny, -Nx) + Math.PI / 2);
  g.fillStyle = '#ff5a4a'; g.beginPath(); g.moveTo(0, -10); g.lineTo(4, 0); g.lineTo(-4, 0); g.closePath(); g.fill();
  g.fillStyle = '#cfd4da'; g.beginPath(); g.moveTo(0, 10); g.lineTo(4, 0); g.lineTo(-4, 0); g.closePath(); g.fill();
  g.restore();
}
