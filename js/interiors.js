// Интерьеры зданий Астаны: подъезд-пятиэтажка с квартирами и магазин.
// Помещения стоят высоко над краем карты (их не видно с улицы); игрок попадает туда через двери по E.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildings } from './buildings.js';
import { mulberry32 } from './noise.js';

export const ORIGIN = { stair: { x: 1850, y: 600, z: -1060 }, shop: { x: 1850, y: 600, z: -1010 } };
const S = { W: 20, D: 10, FH: 3.0, FLOORS: 5, T: 0.25 };
const P = { W: 16, D: 12, H: 4.2, T: 0.25 };
const N = 12, RUN = 0.32, XS = -2.0, XE = XS + N * RUN;
const laneA = [-S.D / 2 + S.T, -S.D / 2 + S.T + 1.2], laneB = [-S.D / 2 + S.T + 1.2, -S.D / 2 + S.T + 2.4];

const so = ORIGIN.stair, po = ORIGIN.shop;
// куда попадает игрок и где выходы
export const SPAWN = {
  stair: { x: so.x, y: so.y, z: so.z + 3.4, ry: Math.PI },
  shop: { x: po.x, y: po.y, z: po.z + 4.4, ry: Math.PI },
};
export const EXITS = [
  { kind: 'out', label: 'выйти на улицу', x: so.x, y: so.y, z: so.z + 4.3 },
  { kind: 'roof', label: 'выйти на крышу', x: so.x + 3.2, y: so.y + 4 * S.FH, z: so.z + 0.6 },
  { kind: 'out', label: 'выйти на улицу', x: po.x, y: po.y, z: po.z + 5.3 },
];
// аптечки внутри (хост возрождает их через пару минут после подбора)
export const LOOT = [
  { x: so.x - 2.5, y: so.y, z: so.z + 3.5 },
  ...[1, 2, 3, 4].map((k) => ({ x: so.x + (k % 2 ? 7.5 : -7.5), y: so.y + k * S.FH, z: so.z - 3 })),
  { x: po.x + 5.6, y: po.y + 1.1, z: po.z + 2.2 },
  { x: po.x - 6.5, y: po.y, z: po.z - 4.5 },
];
export const insideInterior = (x, y, z) => y > 500;

function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }

// UV стен в метрах: по вертикали — от пола этажа, чтобы двухцветная покраска совпадала на всех кусках
function worldUV(geo, base, fh, tile) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getY(i)) < 0.5) uv.setXY(i, (Math.abs(n.getX(i)) > Math.abs(n.getZ(i)) ? p.getZ(i) : p.getX(i)) / fh, (p.getY(i) - base) / fh);
    else uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  }
  return geo;
}

export function buildInteriors(scene, T) {
  const r = mulberry32(4242);
  // ---------- материалы ----------
  const stairWall = canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#e4e0d4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3d6b5a'; g.fillRect(0, h * 0.5, w, h * 0.5); // нижняя половина — масляная краска
    g.fillStyle = '#2a4a3e'; g.fillRect(0, h * 0.5 - 6, w, 6);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(40,30,20,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 2 + r() * 20, 10 + r() * 80); }
    for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(30,30,30,0.35)'; g.lineWidth = 1; g.beginPath(); let x = r() * w, y = r() * h * 0.5; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += r() * 25; g.lineTo(x, y); } g.stroke(); } // трещины
    g.font = 'bold 34px Arial'; g.fillStyle = 'rgba(160,30,30,0.7)'; g.fillText(['ВЫХОДА НЕТ', 'ҚАШ!', 'Ерлан был тут', '☣ 5 эт.'][Math.floor(r() * 4)], 30 + r() * 200, h * 0.72);
  });
  const paper = canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#c9b48a'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,80,40,0.35)'; for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < w; x += 32) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(60,40,20,${r() * 0.15})`; g.fillRect(r() * w, r() * h, 10 + r() * 40, 30 + r() * 90); }
  });
  const shopWall = canvas(256, 256, (g, w, h) => { g.fillStyle = '#e8e8e4'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); } });
  const M = {
    stair: new THREE.MeshStandardMaterial({ map: stairWall, roughness: 0.85 }),
    paper: new THREE.MeshStandardMaterial({ map: paper, roughness: 0.95 }),
    shop: new THREE.MeshStandardMaterial({ map: shopWall, roughness: 0.6 }),
    floor: new THREE.MeshStandardMaterial({ map: T.granite_tile.map, roughness: 0.7 }),
    concrete: new THREE.MeshStandardMaterial({ map: T.concrete_floor_worn_001.map, color: 0xb0aea8, roughness: 0.95 }),
    parquet: new THREE.MeshStandardMaterial({ map: T.bark_brown_02.map, color: 0x9a7a55, roughness: 0.8 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.5 }),
    door: new THREE.MeshStandardMaterial({ color: 0x5a2e1e, roughness: 0.55 }),
    frost: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, emissive: 0xcfdbe2, emissiveIntensity: 0.9, roughness: 0.2 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x6a3a3a, roughness: 1 }),
    cloth2: new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa8acb0, metalness: 0.7, roughness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3 }),
    fridge: new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x7ac8ff, emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.85 }),
  };
  const goods = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x16a085].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));

  // ---------- конструктор помещения ----------
  function room(origin, w, d) {
    const rec = { x: origin.x, z: origin.z, cos: 1, sin: 0, r: Math.hypot(w, d) / 2 + 1, w, d, boxes: [] };
    buildings.push(rec);
    const buckets = new Map();
    const add = (mat, geo) => { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geo.index ? geo.toNonIndexed() : geo); };
    // коробка в локальных координатах (y — от пола помещения); base/fh — для двухцветных стен
    const box = (mat, x0, x1, y0, y1, z0, z1, solid = true, base = 0, fh = 3) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      worldUV(g, base, fh, 2);
      add(mat, g);
      if (solid) rec.boxes.push({ x0, x1, y0: y0 + origin.y, y1: y1 + origin.y, z0, z1 });
    };
    const finish = () => {
      const grp = new THREE.Group(); grp.position.set(origin.x, origin.y, origin.z); scene.add(grp);
      for (const [mat, geos] of buckets) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = m.receiveShadow = true; grp.add(m); }
      return grp;
    };
    return { box, add, finish };
  }
  // стена вдоль X или Z с проёмами {u, w, y0, h, fill}
  function wall(R, mat, axis, fixed, a0, a1, y0, h, holes = [], fh = 3) {
    const put = (u0, u1, b0, b1, m = mat, solid = true) => {
      if (u1 - u0 < 0.01 || b1 - b0 < 0.01) return;
      if (axis === 'x') R.box(m, u0, u1, b0, b1, fixed - S.T / 2, fixed + S.T / 2, solid, y0, fh);
      else R.box(m, fixed - S.T / 2, fixed + S.T / 2, b0, b1, u0, u1, solid, y0, fh);
    };
    let u = a0;
    for (const o of [...holes].sort((p, q) => p.u - q.u)) {
      const o0 = o.u - o.w / 2, o1 = o.u + o.w / 2;
      put(u, o0, y0, y0 + h); put(o0, o1, y0, y0 + o.y0); put(o0, o1, y0 + o.y0 + o.h, y0 + h);
      if (o.fill) put(o0, o1, y0 + o.y0, y0 + o.y0 + o.h, o.fill, true); // закрытое окно/дверь
      u = o1;
    }
    put(u, a1, y0, y0 + h);
  }

  // ================= ПОДЪЕЗД =================
  {
    const R = room(so, S.W, S.D), { W, D, FH, FLOORS, T: TT } = S;
    R.box(M.floor, -W / 2, W / 2, -0.4, 0, -D / 2, D / 2);
    const L = (k) => k * FH;
    for (let k = 0; k < FLOORS; k++) {
      const y = L(k);
      // наружные стены с матовыми окнами (выйти нельзя — 600 м до земли)
      const win = (u) => ({ u, w: 1.4, y0: 0.9, h: 1.4, fill: M.frost });
      wall(R, M.paper, 'x', D / 2 - TT / 2, -W / 2, W / 2, y, FH, [win(-7), win(7), k === 0 ? { u: 0, w: 1.4, y0: 0, h: 2.2, fill: M.door } : win(0)]);
      wall(R, M.paper, 'x', -D / 2 + TT / 2, -W / 2, W / 2, y, FH, [win(-7), win(7)]);
      wall(R, M.paper, 'z', -W / 2 + TT / 2, -D / 2, D / 2, y, FH, [win(0)]);
      wall(R, M.paper, 'z', W / 2 - TT / 2, -D / 2, D / 2, y, FH, [win(0)]);
      // перегородки лестничной клетки: с одной стороны открытая квартира, с другой — запертая дверь
      const open = k % 2 ? 1 : -1;
      for (const side of [-1, 1]) {
        const door = { u: 1.6, w: 1.1, y0: 0, h: 2.1 };
        if (side !== open) door.fill = M.door;
        wall(R, M.stair, 'z', side * 4, -D / 2 + TT, D / 2 - TT, y, FH, [door]);
        if (side === open) R.box(M.door, side * 4 + side * 0.15, side * 4 + side * 0.95, y, y + 2.1, 1.05, 1.1, false); // распахнутая дверь
        R.box(M.metal, side * 3.85 - 0.05, side * 3.85 + 0.05, y + 1.3, y + 1.4, 2.4, 2.55, false); // номер квартиры
      }
      // батареи и пол квартир (паркет)
      for (const side of [-1, 1]) {
        R.box(M.parquet, side > 0 ? 4.15 : -W / 2 + TT, side > 0 ? W / 2 - TT : -4.15, y, y + 0.02, -D / 2 + TT, D / 2 - TT, false);
        R.box(M.metal, side * 9.6 - 0.06, side * 9.6 + 0.06, y + 0.25, y + 0.85, -0.8, 0.8, false);
      }
      // мебель в открытой квартире
      const ox = open * 7;
      R.box(M.cloth, ox - 1.2, ox + 1.2, y, y + 0.45, -4.4, -3.5); R.box(M.cloth, ox - 1.2, ox + 1.2, y + 0.45, y + 0.95, -4.65, -4.35); // диван
      R.box(M.wood, ox - 0.6, ox + 0.6, y, y + 0.45, -2.6, -1.9, false); // журнальный столик
      R.box(M.wood, open > 0 ? 9.3 : -9.75, open > 0 ? 9.75 : -9.3, y, y + 2.1, 2.2, 4.4); // шкаф
      R.box(M.cloth2, ox - 1, ox + 1, y, y + 0.5, 2.6, 4.6); // кровать
      R.box(M.wood, ox + open * -1.9, ox + open * -1.4, y, y + 0.75, -0.6, 0.6, false); // тумба
      R.box(M.black, ox + open * -1.75, ox + open * -1.55, y + 0.75, y + 1.35, -0.5, 0.5, false); // телевизор
      R.box(M.cloth, ox - 1.6, ox + 1.6, y + 0.02, y + 0.03, -2.9, -1.5, false); // ковёр
      if (r() < 0.6) R.box(M.wood, ox + 0.8, ox + 1.3, y, y + 0.9, 0.2, 0.7, false); // опрокинутый стул
      // перекрытие над этажом (с проёмом над лестницей)
      const top = L(k + 1), lane = k % 2 ? laneB : laneA, hx0 = XS - 0.2, hx1 = XE + 0.2;
      if (k === FLOORS - 1) { R.box(M.concrete, -W / 2, W / 2, top - 0.2, top, -D / 2, D / 2); }
      else {
        R.box(M.concrete, -W / 2, hx0, top - 0.2, top, -D / 2, D / 2);
        R.box(M.concrete, hx1, W / 2, top - 0.2, top, -D / 2, D / 2);
        if (lane[0] > -D / 2) R.box(M.concrete, hx0, hx1, top - 0.2, top, -D / 2, lane[0]);
        R.box(M.concrete, hx0, hx1, top - 0.2, top, lane[1], D / 2);
        R.box(M.rail, hx0, hx1, top, top + 1.0, lane[1] - 0.03, lane[1] + 0.03);
        // лестничный пролёт
        const rise = FH / N;
        for (let i = 0; i < N; i++) {
          const x0 = k % 2 ? XE - (i + 1) * RUN : XS + i * RUN;
          R.box(M.concrete, x0, x0 + RUN, y, y + (i + 1) * rise, lane[0], lane[1]);
        }
      }
    }
    // почтовые ящики у входа
    R.box(M.metal, -3.9, -3.75, 1.0, 2.0, 2.0, 4.2, false);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) R.box(M.black, -3.76, -3.72, 1.1 + j * 0.3, 1.3 + j * 0.3, 2.1 + i * 0.52, 2.5 + i * 0.52, false);
    // лестница-стремянка к люку на крышу (5 этаж)
    const ly = L(FLOORS - 1);
    for (const dz of [0.2, 1.0]) R.box(M.rail, 3.15, 3.25, ly, ly + FH, dz, dz + 0.06, false);
    for (let k = 0; k < 9; k++) R.box(M.rail, 3.15, 3.25, ly + 0.3 + k * 0.32, ly + 0.34 + k * 0.32, 0.2, 1.06, false);
    R.box(M.metal, 2.7, 3.7, ly + FH - 0.22, ly + FH - 0.18, 0.1, 1.2, false); // люк
    R.finish();
    for (const k of [0, 2, 4]) { const l = new THREE.PointLight(0xffe6c0, 12, 14, 1.5); l.position.set(so.x, so.y + L(k) + 2.6, so.z + 2); scene.add(l); }
  }

  // ================= МАГАЗИН =================
  {
    const R = room(po, P.W, P.D), { W, D, H, T: TT } = P;
    R.box(M.floor, -W / 2, W / 2, -0.4, 0, -D / 2, D / 2);
    R.box(M.concrete, -W / 2, W / 2, H, H + 0.3, -D / 2, D / 2);
    wall(R, M.shop, 'x', D / 2 - TT / 2, -W / 2, W / 2, 0, H, [{ u: -4.5, w: 5, y0: 0.6, h: 2.6, fill: M.frost }, { u: 4.5, w: 5, y0: 0.6, h: 2.6, fill: M.frost }, { u: 0, w: 1.6, y0: 0, h: 2.4, fill: M.frost }], H);
    wall(R, M.shop, 'x', -D / 2 + TT / 2, -W / 2, W / 2, 0, H, [], H);
    wall(R, M.shop, 'z', -W / 2 + TT / 2, -D / 2, D / 2, 0, H, [], H);
    wall(R, M.shop, 'z', W / 2 - TT / 2, -D / 2, D / 2, 0, H, [], H);
    // стеллажи с товарами
    const shelf = (x, z, tilt) => {
      if (tilt) { R.box(M.metal, x - 3, x + 3, 0, 0.6, z - 0.9, z + 0.9); for (let i = 0; i < 25; i++) { const gx = x - 3 + r() * 6, gz = z - 2 + r() * 4; R.box(goods[i % goods.length], gx, gx + 0.25, 0, 0.3, gz, gz + 0.2, false); } return; }
      R.box(M.metal, x - 3, x + 3, 0, 1.9, z - 0.3, z + 0.3);
      for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 18; i++) {
        if (r() < 0.35) continue; // половину разграбили
        const gx = x - 2.9 + i * 0.32;
        for (const s2 of [-1, 1]) R.box(goods[Math.floor(r() * goods.length)], gx, gx + 0.26, 0.35 + lv * 0.45, 0.35 + lv * 0.45 + 0.2 + r() * 0.15, z + s2 * 0.31, z + s2 * 0.31 + s2 * 0.18, false);
      }
    };
    shelf(-2, -2.5); shelf(-2, 0.5); shelf(-4, 3.2, true);
    // касса
    R.box(M.wood, 5, 6.2, 0, 1.0, 0.8, 3.6); R.box(M.black, 5.3, 5.9, 1.0, 1.35, 1.4, 2.0, false);
    // холодильники у задней стены
    for (let i = 0; i < 4; i++) { R.box(M.metal, -7 + i * 2.1, -5.1 + i * 2.1, 0, 2.2, -D / 2 + TT, -D / 2 + TT + 0.8); R.box(M.fridge, -6.9 + i * 2.1, -5.2 + i * 2.1, 0.1, 2.1, -D / 2 + TT + 0.8, -D / 2 + TT + 0.82, false); }
    for (let i = 0; i < 40; i++) { const gx = -7 + r() * 14, gz = -5 + r() * 9; R.box(goods[i % goods.length], gx, gx + 0.25, 0, 0.2, gz, gz + 0.18, false); } // товары на полу
    R.finish();
    const l = new THREE.PointLight(0xe8f2ff, 16, 16, 1.4); l.position.set(po.x, po.y + 3.6, po.z); scene.add(l);
  }
}
