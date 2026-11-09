// Многоэтажные дома, в которые можно зайти: стены, перекрытия, лестницы + физика для них
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Каждый дом: центр, поворот и список твёрдых коробок в локальных координатах (y — абсолютная высота)
export const buildings = [];
const STEP = 0.42; // на сколько можно «шагнуть» вверх без прыжка

function toLocal(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos];
}
function near(b, x, z, pad) { return (x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + pad) ** 2; }

// Самая высокая поверхность под точкой, на которую можно встать (не выше y + STEP)
export function surfaceAt(x, z, y, radius = 0.25) {
  let best = -Infinity;
  for (const b of buildings) {
    if (!near(b, x, z, 1)) continue;
    const [lx, lz] = toLocal(b, x, z);
    for (const s of b.boxes) {
      if (s.y1 > y + STEP || s.y1 <= best) continue;
      if (lx > s.x0 - radius * 0.5 && lx < s.x1 + radius * 0.5 && lz > s.z0 - radius * 0.5 && lz < s.z1 + radius * 0.5) best = s.y1;
    }
  }
  return best;
}

// Потолок над головой (низ ближайшей коробки выше ног)
export function ceilingAt(x, z, y) {
  let best = Infinity;
  for (const b of buildings) {
    if (!near(b, x, z, 1)) continue;
    const [lx, lz] = toLocal(b, x, z);
    for (const s of b.boxes) if (s.y0 > y + 0.5 && s.y0 < best && lx > s.x0 && lx < s.x1 && lz > s.z0 && lz < s.z1) best = s.y0;
  }
  return best;
}

// Выталкивание круга (персонажа) из стен; footY — уровень ног, height — рост
export function resolveBoxes(pos, radius, footY, height = 1.8) {
  for (const b of buildings) {
    if (!near(b, pos.x, pos.z, radius + 1)) continue;
    for (let iter = 0; iter < 2; iter++) {
      let [lx, lz] = toLocal(b, pos.x, pos.z);
      let mx = 0, mz = 0;
      for (const s of b.boxes) {
        if (s.y1 <= footY + STEP || s.y0 >= footY + height) continue; // ступенька или выше головы
        const cx = Math.max(s.x0, Math.min(lx, s.x1)), cz = Math.max(s.z0, Math.min(lz, s.z1));
        let dx = lx - cx, dz = lz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (radius - d) / d; lx += dx * k; lz += dz * k; mx += dx * k; mz += dz * k; }
        else { // центр внутри коробки — выталкиваем к ближайшей грани
          const opts = [[s.x0 - radius - lx, 0], [s.x1 + radius - lx, 0], [0, s.z0 - radius - lz], [0, s.z1 + radius - lz]];
          opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          lx += opts[0][0]; lz += opts[0][1]; mx += opts[0][0]; mz += opts[0][1];
        }
      }
      if (!mx && !mz) break;
      pos.x += mx * b.cos + mz * b.sin;
      pos.z += -mx * b.sin + mz * b.cos;
    }
  }
}

// Точка внутри твёрдой коробки? (для камеры)
export function pointBlocked(x, y, z, pad = 0.2) {
  for (const b of buildings) {
    if (!near(b, x, z, 1)) continue;
    const [lx, lz] = toLocal(b, x, z);
    for (const s of b.boxes) if (lx > s.x0 - pad && lx < s.x1 + pad && lz > s.z0 - pad && lz < s.z1 + pad && y > s.y0 - pad && y < s.y1 + pad) return true;
  }
  return false;
}
export function insideBuilding(x, z) {
  for (const b of buildings) { const [lx, lz] = toLocal(b, x, z); if (Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2) return b; }
  return null;
}

// Коробка с UV в метрах
function tbox(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile); }
  return g;
}

/**
 * Башня-дом в нордическом стиле.
 * mats: { stone, plank, beam, thatch, bark, floor, glow }
 * extra(group, level, W, D) — расставить мебель (необязательно)
 */
export function buildTower(scene, hx, hy, hz, ry, mats, opt = {}) {
  const W = opt.w ?? 11, D = opt.d ?? 8, FH = 3.2, FLOORS = opt.floors ?? 4, T = 0.3, BASE = 0.6;
  const g = new THREE.Group(); g.position.set(hx, hy, hz); g.rotation.y = ry; scene.add(g);
  const b = { x: hx, z: hz, cos: Math.cos(ry), sin: Math.sin(ry), r: Math.hypot(W, D) / 2 + 0.5, w: W, d: D, boxes: [], lights: [] };
  buildings.push(b);
  const buckets = new Map();
  // x0..x1, y0..y1 (локально от низа дома), z0..z1
  const box = (mat, x0, x1, y0, y1, z0, z1, solid = true, tile = 2) => {
    const geo = tbox(x1 - x0, y1 - y0, z1 - z0, tile);
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo.toNonIndexed());
    if (solid) b.boxes.push({ x0, x1, y0: y0 + hy, y1: y1 + hy, z0, z1 });
  };
  const L = (k) => BASE + k * FH; // уровень пола k-го этажа

  // фундамент = пол первого этажа
  box(mats.stone, -W / 2 - 0.3, W / 2 + 0.3, -1.2, BASE, -D / 2 - 0.3, D / 2 + 0.3);
  box(mats.stone, -1.2, 1.2, -1.2, BASE - 0.3, D / 2 + 0.3, D / 2 + 1.1); // ступень у двери

  // стена с проёмами: side — 'front'|'back'|'left'|'right'; openings: [{u, w, y0, h}]
  const wall = (side, k, openings) => {
    const y0 = L(k), y1 = L(k) + FH, mat = k === 0 ? mats.stone : mats.plank;
    const along = side === 'front' || side === 'back';
    const len = along ? W : D - 2 * T;
    const fixed = side === 'front' ? D / 2 - T / 2 : side === 'back' ? -D / 2 + T / 2 : side === 'right' ? W / 2 - T / 2 : -W / 2 + T / 2;
    const put = (u0, u1, a, c) => {
      if (u1 - u0 < 0.01 || c - a < 0.01) return;
      if (along) box(mat, u0, u1, a, c, fixed - T / 2, fixed + T / 2);
      else box(mat, fixed - T / 2, fixed + T / 2, a, c, u0, u1);
    };
    let u = -len / 2;
    for (const o of [...openings].sort((p, q) => p.u - q.u)) {
      const o0 = o.u - o.w / 2, o1 = o.u + o.w / 2;
      put(u, o0, y0, y1);
      put(o0, o1, y0, y0 + o.y0);
      put(o0, o1, y0 + o.y0 + o.h, y1);
      // рама и ставни окна
      if (o.y0 > 0) {
        const fr = (a0, a1, b0, b1) => along ? box(mats.beam, a0, a1, b0, b1, fixed - T / 2 - 0.06, fixed + T / 2 + 0.06, false, 1) : box(mats.beam, fixed - T / 2 - 0.06, fixed + T / 2 + 0.06, b0, b1, a0, a1, false, 1);
        fr(o0 - 0.1, o1 + 0.1, y0 + o.y0 - 0.12, y0 + o.y0);
        fr(o0 - 0.1, o1 + 0.1, y0 + o.y0 + o.h, y0 + o.y0 + o.h + 0.12);
      }
      u = o1;
    }
    put(u, len / 2, y0, y1);
  };
  // большие окна: подоконник по колено (запрыгнуть), проём выше роста — можно выпрыгнуть
  const win = (u) => ({ u, w: 1.6, y0: 0.6, h: 2.3 });
  for (let k = 0; k < FLOORS; k++) {
    wall('front', k, k === 0 ? [{ u: 0, w: 1.8, y0: 0, h: 2.6 }, win(-3.5), win(3.5)] : [win(-3.5), win(0), win(3.5)]);
    wall('back', k, [win(3.6)]);
    wall('left', k, [win(0.6)]);
    wall('right', k, [win(0.6)]);
    // пояс из бруса между этажами (декор снаружи)
    if (k > 0) {
      box(mats.beam, -W / 2 - 0.08, W / 2 + 0.08, L(k) - 0.15, L(k) + 0.1, D / 2 - 0.02, D / 2 + 0.08, false, 1);
      box(mats.beam, -W / 2 - 0.08, W / 2 + 0.08, L(k) - 0.15, L(k) + 0.1, -D / 2 - 0.08, -D / 2 + 0.02, false, 1);
      box(mats.beam, W / 2 - 0.02, W / 2 + 0.08, L(k) - 0.15, L(k) + 0.1, -D / 2, D / 2, false, 1);
      box(mats.beam, -W / 2 - 0.08, -W / 2 + 0.02, L(k) - 0.15, L(k) + 0.1, -D / 2, D / 2, false, 1);
    }
  }
  // угловые брёвна
  const topY = L(FLOORS);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(mats.bark, sx * W / 2 - 0.22, sx * W / 2 + 0.22, BASE, topY + 0.3, sz * D / 2 - 0.22, sz * D / 2 + 0.22, true, 1.5);
  // дверной косяк
  box(mats.beam, -1.05, -0.9, BASE, BASE + 2.75, D / 2 - 0.05, D / 2 + 0.1, false, 1);
  box(mats.beam, 0.9, 1.05, BASE, BASE + 2.75, D / 2 - 0.05, D / 2 + 0.1, false, 1);
  box(mats.beam, -1.05, 1.05, BASE + 2.6, BASE + 2.8, D / 2 - 0.05, D / 2 + 0.1, false, 1);

  // лестницы: зигзагом в двух полосах у задней стены
  const N = 13, RUN = 0.3, XS = -2.6, XE = XS + N * RUN;
  const laneA = [-D / 2 + T, -D / 2 + T + 1.25], laneB = [-D / 2 + T + 1.25, -D / 2 + T + 2.5];
  for (let k = 0; k < FLOORS - 1; k++) {
    const lane = k % 2 ? laneB : laneA, rise = FH / N;
    for (let i = 0; i < N; i++) {
      const x0 = k % 2 ? XE - (i + 1) * RUN : XS + i * RUN;
      box(mats.floor, x0, x0 + RUN, L(k), L(k) + (i + 1) * rise, lane[0], lane[1], true, 1.2);
    }
  }
  // перекрытия с проёмом над лестницей
  const inner = [-W / 2 + T, W / 2 - T, -D / 2 + T, D / 2 - T];
  for (let k = 1; k <= FLOORS; k++) {
    const y0 = L(k) - 0.25, y1 = L(k);
    if (k === FLOORS) { box(mats.floor, inner[0], inner[1], y0, y1, inner[2], inner[3], true, 2); continue; }
    const lane = (k - 1) % 2 ? laneB : laneA, hx0 = XS - 0.2, hx1 = XE + 0.2;
    box(mats.floor, inner[0], hx0, y0, y1, inner[2], inner[3], true, 2);
    box(mats.floor, hx1, inner[1], y0, y1, inner[2], inner[3], true, 2);
    if (lane[0] > inner[2]) box(mats.floor, hx0, hx1, y0, y1, inner[2], lane[0], true, 2);
    box(mats.floor, hx0, hx1, y0, y1, lane[1], inner[3], true, 2);
    // перила у проёма
    box(mats.beam, hx0, hx1, y1, y1 + 1.0, lane[1] - 0.04, lane[1] + 0.04, true, 1);
  }

  // крутая соломенная крыша
  const rh = 4.5, ov = 0.9, half = D / 2 + ov, slope = Math.hypot(half, rh), ang = Math.atan2(rh, half);
  const roofG = new THREE.Group(); roofG.position.y = topY; g.add(roofG);
  for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(tbox(W + 2 * ov, 0.4, slope, 2.5), mats.thatch);
    r.position.set(0, rh / 2, (sz * half) / 2); r.rotation.x = sz * ang; r.castShadow = r.receiveShadow = true; roofG.add(r);
  }
  const gable = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, rh)]);
  const gGeo = new THREE.ExtrudeGeometry(gable, { depth: W - 0.04, bevelEnabled: false });
  const guv = gGeo.attributes.uv; for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) / 2.2, guv.getY(i) / 2.2);
  gGeo.translate(0, 0, -(W - 0.04) / 2); gGeo.rotateY(Math.PI / 2);
  const gm = new THREE.Mesh(gGeo, mats.plank); gm.castShadow = gm.receiveShadow = true; roofG.add(gm);
  for (const sx of [-1, 1]) for (const k of [-1, 1]) { // перекрещенные «рога» на коньке
    const bm = new THREE.Mesh(tbox(0.18, 2.6, 0.18, 1), mats.beam); bm.position.set(sx * (W / 2 + ov), rh + 0.4, k * 0.45); bm.rotation.x = k * 0.55; bm.castShadow = true; roofG.add(bm);
  }
  // труба
  box(mats.stone, W / 4 - 0.45, W / 4 + 0.45, topY, topY + rh + 1.2, -D / 4 - 0.45, -D / 4 + 0.45, false, 1.5);

  // склеиваем по материалам — мало вызовов отрисовки
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  // по одному тёплому огоньку на этаж (без теней), остальное даёт свечение
  const smoke = new THREE.Vector3(W / 4, topY + rh + 1.3, -D / 4).applyEuler(new THREE.Euler(0, ry, 0)).add(g.position);
  opt.furnish?.(g, L, W, D, FLOORS);
  return { group: g, levels: Array.from({ length: FLOORS }, (_, k) => L(k) + hy), smoke, W, D, topY: topY + hy };
}
