// Дворы и детали улиц для карты Астаны: площадки, подъезды, мусорки, бордюры, разметка, кусты, мусор
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tbox, tcyl } from './world.js';

const ni = (g) => (g.index ? g.toNonIndexed() : g);
// Собирает геометрию по материалам и добавляет на сцену одним мешем на материал
class Batch {
  constructor() { this.map = new Map(); }
  add(mat, geo) { if (!this.map.has(mat)) this.map.set(mat, []); this.map.get(mat).push(ni(geo)); }
  // положить готовый набор деталей (Map mat→geo) с поворотом и сдвигом
  place(parts, x, y, z, ry, s = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));
    for (const [mat, geo] of parts) this.add(mat, geo.clone().applyMatrix4(m));
  }
  flush(scene, shadow = true) {
    for (const [mat, geos] of this.map) {
      for (let i = 0; i < geos.length; i += 4000) { // крупные пачки, чтобы не упереться в лимиты
        const mesh = new THREE.Mesh(mergeGeometries(geos.slice(i, i + 4000)), mat);
        mesh.castShadow = shadow; mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }
  }
}
const parts = (...list) => { const m = new Map(); for (const [mat, geo] of list) { if (!m.has(mat)) m.set(mat, []); m.get(mat).push(ni(geo)); } for (const [k, v] of m) m.set(k, mergeGeometries(v)); return m; };

export function buildYards(ctx) {
  const { scene, city, rng, getHeight, addCircle, pip, M, T, isRoad, inBuilding, nearZone } = ctx;
  const B = new Batch();
  const C = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
  const mat = {
    red: C(0xb0302a), blue: C(0x2a5aa8), yellow: C(0xe0b030), green: C(0x2f8a4a), steel: C(0x8a9096, { metalness: 0.7, roughness: 0.4 }),
    dark: C(0x26282a, { metalness: 0.5, roughness: 0.5 }), wood: new THREE.MeshStandardMaterial({ map: T.bark_brown_02.map, roughness: 0.9 }),
    sand: C(0xd8c088, { roughness: 1 }), concrete: new THREE.MeshStandardMaterial({ map: T.concrete_floor_worn_001.map, color: 0xb8b6b0, roughness: 0.95 }),
    curb: C(0x9c9a94, { roughness: 0.9 }), paint: C(0xe8e8e2, { roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    rubber: C(0x8a3b2c, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    court: C(0x3f7a52, { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    court2: C(0x3a5f8a, { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    net: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    door: C(0x4a3424, { roughness: 0.6 }), canopy: C(0xb8b4aa, { roughness: 0.85 }),
    binG: C(0x2f5a3a, { metalness: 0.4, roughness: 0.6 }), binB: C(0x2a4a7a, { metalness: 0.4, roughness: 0.6 }),
    bag: C(0x151617, { roughness: 0.35, metalness: 0.1 }), tire: C(0x111111, { roughness: 0.95 }), paper: C(0xdcd8cc, { roughness: 1, side: THREE.DoubleSide }),
  };
  const centroid = (p) => { let x = 0, z = 0; const n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; };
  const longestEdge = (p) => { let best = 0, bi = 0; for (let i = 0; i < p.length; i += 2) { const k = (i + 2) % p.length, l = Math.hypot(p[k] - p[i], p[k + 1] - p[i + 1]); if (l > best) { best = l; bi = i; } } const k = (bi + 2) % p.length; return { ax: p[bi], az: p[bi + 1], bx: p[k], bz: p[k + 1], len: best, ang: Math.atan2(p[k] - p[bi], p[k + 1] - p[bi + 1]) }; };
  const flatPoly = (p, y, m) => {
    const s = new THREE.Shape(); s.moveTo(p[0], -p[1]); for (let i = 2; i < p.length; i += 2) s.lineTo(p[i], -p[i + 1]);
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); B.add(m, g);
  };
  const randIn = (p, tries = 30) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    for (let t = 0; t < tries; t++) { const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0); if (pip(p, x, z)) return [x, z]; }
    return null;
  };

  // ================= детские площадки =================
  const leg = (x, z, h, r = 0.05, m = mat.steel) => [m, tcyl(r, r, h, 6, 1).translate(x, h / 2, z)];
  const SWING = parts(
    ...[-1.6, 1.6].flatMap((x) => [[mat.steel, tcyl(0.05, 0.05, 2.6, 6, 1).rotateX(0.32).translate(x, 1.24, -0.4)], [mat.steel, tcyl(0.05, 0.05, 2.6, 6, 1).rotateX(-0.32).translate(x, 1.24, 0.4)]]),
    [mat.steel, tcyl(0.05, 0.05, 3.3, 6, 1).rotateZ(Math.PI / 2).translate(0, 2.45, 0)],
    ...[-0.7, 0.7].flatMap((x) => [[mat.dark, tcyl(0.01, 0.01, 1.8, 3, 1).translate(x - 0.22, 1.55, 0)], [mat.dark, tcyl(0.01, 0.01, 1.8, 3, 1).translate(x + 0.22, 1.55, 0)], [mat.red, tbox(0.5, 0.05, 0.22, 1).translate(x, 0.62, 0)]]),
  );
  const SLIDE = parts(
    leg(-0.5, -0.5, 1.6), leg(0.5, -0.5, 1.6), leg(-0.5, 0.5, 1.6), leg(0.5, 0.5, 1.6),
    [mat.yellow, tbox(1.1, 0.08, 1.1, 1).translate(0, 1.6, 0)],
    [mat.blue, tbox(0.7, 0.06, 3.0, 1).rotateX(-0.55).translate(0, 0.85, 1.75)],
    [mat.red, tbox(0.06, 0.25, 3.0, 1).rotateX(-0.55).translate(-0.36, 0.95, 1.75)], [mat.red, tbox(0.06, 0.25, 3.0, 1).rotateX(-0.55).translate(0.36, 0.95, 1.75)],
    [mat.steel, tbox(0.6, 1.8, 0.06, 1).rotateX(0.25).translate(0, 0.85, -0.85)],
    [mat.red, new THREE.ConeGeometry(0.85, 0.7, 4).rotateY(Math.PI / 4).translate(0, 2.55, 0)], leg(-0.5, -0.5, 2.3, 0.04), leg(0.5, 0.5, 2.3, 0.04),
  );
  const SANDBOX = parts(
    [mat.wood, tbox(3, 0.3, 0.15, 1).translate(0, 0.15, -1.45)], [mat.wood, tbox(3, 0.3, 0.15, 1).translate(0, 0.15, 1.45)],
    [mat.wood, tbox(0.15, 0.3, 3, 1).translate(-1.45, 0.15, 0)], [mat.wood, tbox(0.15, 0.3, 3, 1).translate(1.45, 0.15, 0)],
    [mat.sand, tbox(2.8, 0.12, 2.8, 1).translate(0, 0.08, 0)],
    [mat.yellow, new THREE.ConeGeometry(1.4, 0.8, 8).translate(0, 2.2, 0)], leg(0, 0, 2.0, 0.07, mat.wood),
  );
  const CAROUSEL = parts(
    [mat.red, tcyl(1.2, 1.2, 0.1, 18, 1).translate(0, 0.35, 0)], [mat.steel, tcyl(0.08, 0.08, 1.1, 8, 1).translate(0, 0.6, 0)],
    ...[0, 1, 2, 3].map((k) => [mat.yellow, tcyl(0.03, 0.03, 2.2, 5, 1).rotateZ(Math.PI / 2).rotateY((k * Math.PI) / 4).translate(0, 1.05, 0)]),
  );
  const GYM = parts(
    ...[-1, 0, 1].flatMap((i) => [leg(i * 0.9, -0.9, 2), leg(i * 0.9, 0.9, 2)]),
    ...[0.6, 1.3, 2].flatMap((y) => [[mat.blue, tcyl(0.035, 0.035, 1.8, 5, 1).rotateZ(Math.PI / 2).translate(0, y, -0.9)], [mat.blue, tcyl(0.035, 0.035, 1.8, 5, 1).rotateZ(Math.PI / 2).translate(0, y, 0.9)]]),
    ...[-0.9, 0, 0.9].map((x) => [mat.yellow, tcyl(0.035, 0.035, 1.8, 5, 1).rotateX(Math.PI / 2).translate(x, 2, 0)]),
  );
  const EQUIP = [SWING, SLIDE, SANDBOX, CAROUSEL, GYM];
  let nPlay = 0;
  for (const g of city.green) {
    if (g.k !== 'playground') continue;
    const [cx, cz] = centroid(g.p);
    if (nearZone(cx, cz, 0)) continue;
    flatPoly(g.p, getHeight(cx, cz) + 0.03, mat.rubber);
    const n = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const pt = randIn(g.p); if (!pt) continue;
      B.place(EQUIP[Math.floor(rng() * EQUIP.length)], pt[0], getHeight(pt[0], pt[1]), pt[1], rng() * 6.28);
      addCircle(pt[0], pt[1], 1.3);
    }
    nPlay++;
  }

  // ================= спортивные коробки =================
  const GOAL = parts(leg(-1.5, 0, 2, 0.05, mat.paint), leg(1.5, 0, 2, 0.05, mat.paint), [mat.paint, tcyl(0.05, 0.05, 3, 6, 1).rotateZ(Math.PI / 2).translate(0, 2, 0)], [mat.net, tbox(3, 2, 0.02, 1).translate(0, 1, -0.6)]);
  const HOOP = parts(leg(0, -0.6, 3.4, 0.07, mat.dark), [mat.paint, tbox(1.4, 0.95, 0.05, 1).translate(0, 3.35, 0)], [mat.red, new THREE.TorusGeometry(0.23, 0.02, 6, 16).rotateX(Math.PI / 2).translate(0, 3.05, 0.3)]);
  let nPitch = 0;
  for (const g of city.green) {
    if (g.k !== 'pitch') continue;
    const [cx, cz] = centroid(g.p);
    if (nearZone(cx, cz, 0)) continue;
    const y = getHeight(cx, cz), e = longestEdge(g.p);
    flatPoly(g.p, y + 0.03, rng() < 0.6 ? mat.court : mat.court2);
    // разметка по контуру
    for (let i = 0; i < g.p.length; i += 2) {
      const k = (i + 2) % g.p.length, ax = g.p[i], az = g.p[i + 1], bx = g.p[k], bz = g.p[k + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.5) continue;
      B.add(mat.paint, tbox(0.1, 0.02, l, 1).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2 - (((ax + bx) / 2 - cx) / (Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz) || 1)) * 0.8, y + 0.05, (az + bz) / 2 - (((az + bz) / 2 - cz) / (Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz) || 1)) * 0.8));
      // сетка-ограждение
      B.add(mat.net, tbox(0.02, 3, l, 1).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, y + 1.5, (az + bz) / 2));
      for (let d = 0; d < l; d += 3) { const px = ax + ((bx - ax) * d) / l, pz = az + ((bz - az) * d) / l; B.add(mat.dark, tcyl(0.04, 0.04, 3, 5, 1).translate(px, y + 1.5, pz)); }
    }
    // ворота или кольца на концах длинной оси
    const ux = Math.sin(e.ang), uz = Math.cos(e.ang), half = Math.min(e.len / 2 - 1.5, 18);
    const item = e.len > 26 ? GOAL : HOOP;
    for (const s of [-1, 1]) B.place(item, cx + ux * half * s, y, cz + uz * half * s, e.ang + (s > 0 ? Math.PI : 0));
    nPitch++;
  }

  // ================= подъезды и мусорные площадки у жилых домов =================
  const DOOR = parts(
    [mat.door, tbox(1.5, 2.2, 0.12, 1).translate(0, 1.1, 0.06)],
    [mat.dark, tbox(1.7, 2.35, 0.08, 1).translate(0, 1.15, 0.03)],
    [mat.canopy, tbox(2.6, 0.14, 1.6, 1).translate(0, 2.75, 0.8)],
    leg(-1.15, 1.45, 2.7, 0.05), leg(1.15, 1.45, 2.7, 0.05),
    [mat.concrete, tbox(2.6, 0.15, 1.8, 1).translate(0, 0.07, 0.9)],
    [mat.paint, tbox(0.3, 0.2, 0.1, 1).translate(0, 2.55, 0.12)],
  );
  const BENCH = parts([mat.wood, tbox(1.8, 0.08, 0.45, 1).translate(0, 0.45, 0)], [mat.wood, tbox(1.8, 0.4, 0.06, 1).translate(0, 0.72, -0.2)], [mat.dark, tbox(0.08, 0.45, 0.4, 1).translate(-0.8, 0.22, 0)], [mat.dark, tbox(0.08, 0.45, 0.4, 1).translate(0.8, 0.22, 0)]);
  const BIN = (m) => parts([m, tbox(1.4, 1.2, 1.0, 1).translate(0, 0.65, 0)], [mat.dark, tbox(1.45, 0.08, 1.05, 1).rotateX(-0.15).translate(0, 1.3, -0.05)], ...[[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]].map(([x, z]) => [mat.tire, tcyl(0.07, 0.07, 0.08, 8, 1).rotateZ(Math.PI / 2).translate(x, 0.07, z)]));
  const BIN_G = BIN(mat.binG), BIN_B = BIN(mat.binB);
  const BAG = parts([mat.bag, new THREE.SphereGeometry(0.35, 8, 6).scale(1, 0.75, 1).translate(0, 0.25, 0)]);
  let nDoors = 0, nBins = 0;
  for (const b of city.buildings) {
    if (!(b.k === 'apartments' || b.k === 'residential' || (b.k === 'yes' && b.h > 14)) || b.mh) continue;
    const [cx, cz] = centroid(b.p);
    if (nearZone(cx, cz, 5)) continue;
    // подъезды — на самой длинной стене, со стороны двора
    const e = longestEdge(b.p);
    let nx = Math.cos(e.ang), nz = -Math.sin(e.ang);
    const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
    if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - nx - cx) ** 2 + (mz - nz - cz) ** 2) { nx = -nx; nz = -nz; }
    const cnt = Math.max(1, Math.min(8, Math.floor(e.len / 16)));
    const face = Math.atan2(nx, nz);
    for (let k = 0; k < cnt; k++) {
      const t = (k + 0.5) / cnt, x = e.ax + (e.bx - e.ax) * t, z = e.az + (e.bz - e.az) * t;
      if (isRoad(x + nx * 2, z + nz * 2)) continue;
      const y = getHeight(x, z);
      B.place(DOOR, x, y, z, face);
      addCircle(x + nx * 1.45 + Math.sin(e.ang) * 1.15, z + nz * 1.45 + Math.cos(e.ang) * 1.15, 0.12);
      addCircle(x + nx * 1.45 - Math.sin(e.ang) * 1.15, z + nz * 1.45 - Math.cos(e.ang) * 1.15, 0.12);
      if (rng() < 0.6) { const bx = x + nx * 2.6 + Math.sin(e.ang) * 2.4, bz = z + nz * 2.6 + Math.cos(e.ang) * 2.4; B.place(BENCH, bx, y, bz, face); }
      nDoors++;
    }
    // мусорная площадка — в 7–9 м от дома
    if (rng() < 0.55) {
      const d = 7 + rng() * 2, t = 0.15 + rng() * 0.7, x = e.ax + (e.bx - e.ax) * t + nx * d, z = e.az + (e.bz - e.az) * t + nz * d;
      if (!isRoad(x, z) && !inBuilding(x, z)) {
        const y = getHeight(x, z);
        B.add(mat.concrete, tbox(5.2, 0.12, 2.4, 2).rotateY(e.ang + Math.PI / 2).translate(x, y + 0.06, z));
        B.add(mat.concrete, tbox(5.4, 1.6, 0.15, 2).rotateY(e.ang + Math.PI / 2).translate(x - nx * 1.2, y + 0.8, z - nz * 1.2));
        for (let k = -1; k <= 1; k++) {
          const px = x + Math.sin(e.ang) * k * 1.6, pz = z + Math.cos(e.ang) * k * 1.6;
          B.place(rng() < 0.5 ? BIN_G : BIN_B, px, y + 0.12, pz, face + (rng() - 0.5) * 0.3);
          addCircle(px, pz, 0.8);
        }
        for (let k = 0; k < 5 + rng() * 6; k++) B.place(BAG, x + (rng() - 0.5) * 6 + nx * (1 + rng() * 2), y, z + (rng() - 0.5) * 6 + nz * (1 + rng() * 2), rng() * 6, 0.7 + rng() * 0.6);
        nBins++;
      }
    }
  }

  // ================= бордюры, разметка, зебры =================
  const CURB = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
  let nCurb = 0;
  for (const r of city.roads) {
    if (!CURB.has(r.t) || r.b || r.tn) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], l = Math.hypot(bx - ax, bz - az);
      if (l < 1 || Math.abs(ax) > 2050 || Math.abs(az) > 1200) continue;
      const ang = Math.atan2(bx - ax, bz - az), ux = (bx - ax) / l, uz = (bz - az) / l, cx = (ax + bx) / 2, cz = (az + bz) / 2, y = getHeight(cx, cz);
      // режем на куски по ~4 м и пропускаем те, что выходят на перекрёсток (снаружи бордюра — снова дорога)
      const pieces = Math.max(1, Math.round(l / 4)), pl = l / pieces;
      for (let k = 0; k < pieces; k++) {
        const t = (k + 0.5) / pieces, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        for (const s of [-1, 1]) {
          const off = r.w / 2 + 0.12, x = px + uz * off * s, z = pz - ux * off * s;
          if (isRoad(px + uz * (r.w / 2 + 1.2) * s, pz - ux * (r.w / 2 + 1.2) * s)) continue;
          B.add(mat.curb, tbox(0.25, 0.16, pl + 0.05, 1).rotateY(ang).translate(x, y + 0.08, z));
        }
      }
      nCurb++;
      // прерывистая осевая на крупных улицах (кроме перекрёстков)
      if (['primary', 'secondary', 'tertiary'].includes(r.t)) for (let d = 1.5; d < l - 1.5; d += 6) {
        const mx = ax + ux * (d + 1.5), mz = az + uz * (d + 1.5), side = r.w / 2 + 1.5;
        if (isRoad(mx + uz * side, mz - ux * side) && isRoad(mx - uz * side, mz + ux * side)) continue;
        B.add(mat.paint, tbox(0.15, 0.02, 3, 1).rotateY(ang).translate(mx, y + 0.03, mz));
      }
    }
  }
  // зебры у светофоров
  const majors = city.roads.filter((r) => CURB.has(r.t) && !r.tn);
  const nearestSeg = (x, z) => {
    let best = 1e9, res = null;
    for (const r of majors) for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
      if (Math.abs(ax - x) > 60 && Math.abs(bx - x) > 60) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (d < best) { best = d; res = { qx, qz, ang: Math.atan2(dx, dz), w: r.w, d }; }
    }
    return res;
  };
  const sig = city.signals || [];
  let nZebra = 0;
  for (let i = 0; i < sig.length; i += 2) {
    const s = nearestSeg(sig[i], sig[i + 1]);
    if (!s || s.d > 25) continue;
    const ux = Math.sin(s.ang), uz = Math.cos(s.ang), y = getHeight(s.qx, s.qz);
    for (let k = -s.w / 2 + 0.4; k < s.w / 2 - 0.2; k += 0.9) {
      const x = s.qx + uz * k + ux * 4, z = s.qz - ux * k + uz * 4;
      B.add(mat.paint, tbox(0.5, 0.02, 3.2, 1).rotateY(s.ang).translate(x, y + 0.035, z));
    }
    nZebra++;
  }

  // ================= мусор апокалипсиса =================
  const TIRE = parts([mat.tire, new THREE.TorusGeometry(0.32, 0.12, 6, 14).rotateX(Math.PI / 2).translate(0, 0.12, 0)]);
  const PAPER = parts([mat.paper, new THREE.PlaneGeometry(0.3, 0.4).rotateX(-Math.PI / 2).translate(0, 0.03, 0)]);
  const BARRIER = parts([mat.concrete, mergeGeometries([ni(tbox(0.6, 0.35, 3, 1).translate(0, 0.17, 0)), ni(tbox(0.25, 0.55, 3, 1).translate(0, 0.62, 0))])]);
  let nJunk = 0;
  for (let k = 0; k < 2600; k++) {
    const x = (rng() - 0.5) * 3900, z = (rng() - 0.5) * 2200;
    if (inBuilding(x, z) || nearZone(x, z, 2) || Math.hypot(x, z) < 30 || getHeight(x, z) < -0.4) continue;
    const roll = rng(), y = getHeight(x, z);
    if (roll < 0.45) B.place(PAPER, x, y, z, rng() * 6.28, 0.8 + rng());
    else if (roll < 0.8) B.place(BAG, x, y, z, rng() * 6.28, 0.6 + rng() * 0.6);
    else if (roll < 0.95) B.place(TIRE, x, y, z, rng() * 6.28, 0.9 + rng() * 0.3);
    else if (isRoad(x, z)) { B.place(BARRIER, x, y, z, rng() * 6.28); addCircle(x, z, 0.9); }
    nJunk++;
  }

  B.flush(scene);

  // ================= кусты вдоль домов и на газонах =================
  let nBush = 0;
  if (M.shrub_03) {
    const src = [];
    M.shrub_03.updateMatrixWorld(true);
    M.shrub_03.traverse((o) => { if (o.isMesh) src.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material }); });
    const N = 1400, ims = src.map(({ geo, mat: m }) => { const im = new THREE.InstancedMesh(geo, m, N); im.castShadow = true; im.receiveShadow = true; scene.add(im); return im; });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    const put = (x, z, s) => { if (nBush >= N) return; e.set(0, rng() * 6.28, 0); q.setFromEuler(e); sv.set(s, s * (0.8 + rng() * 0.3), s); pv.set(x, getHeight(x, z), z); m4.compose(pv, q, sv); for (const im of ims) im.setMatrixAt(nBush, m4); nBush++; };
    for (const b of city.buildings) {
      if (b.mh || b.h < 8 || nBush > N - 20) continue;
      const [cx, cz] = centroid(b.p);
      if (nearZone(cx, cz, 5)) continue;
      for (let i = 0; i < b.p.length; i += 2) {
        const k = (i + 2) % b.p.length, ax = b.p[i], az = b.p[i + 1], bx = b.p[k], bz = b.p[k + 1], l = Math.hypot(bx - ax, bz - az);
        let nx = -(bz - az) / (l || 1), nz = (bx - ax) / (l || 1);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if ((mx + nx - cx) ** 2 + (mz + nz - cz) ** 2 < (mx - nx - cx) ** 2 + (mz - nz - cz) ** 2) { nx = -nx; nz = -nz; }
        for (let d = 3; d < l - 3; d += 4.5) {
          if (rng() < 0.55) continue;
          const x = ax + ((bx - ax) * d) / l + nx * 1.4, z = az + ((bz - az) * d) / l + nz * 1.4;
          if (isRoad(x, z) || inBuilding(x, z)) continue;
          put(x, z, 0.5 + rng() * 0.35);
        }
      }
    }
    for (const im of ims) { im.count = nBush; im.computeBoundingSphere(); }
  }
  return { nPlay, nPitch, nDoors, nBins, nCurb, nZebra, nJunk, nBush };
}
