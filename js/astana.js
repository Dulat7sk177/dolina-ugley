// Карта «Астана: Мёртвый город» — весь город по данным OpenStreetMap (© участники OpenStreetMap, ODbL).
// Город разрезан на плитки 500×500 м: рядом с игроком они строятся подробно, вдали видны только высотки.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mulberry32 } from './noise.js';
import { spruceGeometry, branchTexture, grassTexture, windSway, tbox, tcyl } from './world.js';
import { ZONES, WATER_LEVEL } from './config.js';
import { makeFacadeMaterials, SHOP_H, CarFleet, carSpec, PHOTO_FACADES, WALL_PHOTOS, REAL_FACADES } from './cityprops.js';
import { buildYards } from './yards.js';
import { buildInteriors } from './interiors.js';
import { pointBlocked } from './buildings.js';

const ENV = 'assets/env/', DATA = 'assets/astana/';
const SKY = 'kloofendal_28d_misty_puresky';
const TILE = 500, RES = 2, N = TILE / RES, HW = N + 1, HPAD = 8, CELL = 50, RIVERBED = -3.4;
export const colliders = []; // круги: деревья, фонари, машины (только в построенных плитках)
export const doors = []; // входы в здания: {x, z, kind, roof}
// настройки качества: радиус подробного города, дальность видимости, густота травы, время на стройку за кадр
export const QUALITY = { meshR: 450, view: 1800, grass: 1, budget: 6 };
export function setQuality(q) { Object.assign(QUALITY, q); }

let index = null, tileSet = new Set(), BND = [-2000, -1150, 2000, 1150];
const chunks = new Map(); // ключ → плитка
const tileData = new Map(); // ключ → данные или Promise
const grid = new Map();
const globals = { circles: [], flames: [], smokes: [], lamps: [] };
const T = {}, M = {}, PHOTO = {};
let stamp = 0, S = null; // S — общие для всех плиток материалы и геометрии

const ckey = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);
const chunkAt = (x, z) => chunks.get(ckey(Math.floor(x / TILE), Math.floor(z / TILE)));

// ================= Рельеф и столкновения =================
function sampleH(c, arr, x, z) {
  const fx = Math.max(0, Math.min(N - 0.001, (x - c.x0) / RES)), fz = Math.max(0, Math.min(N - 0.001, (z - c.z0) / RES));
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * HW + ix;
  const a = arr[i], b = arr[i + 1], cc = arr[i + HW], d = arr[i + HW + 1];
  return a + (b - a) * tx + (cc - a) * tz + (a - b - cc + d) * tx * tz;
}
export function getHeight(x, z) { const c = chunkAt(x, z); return c && c.hPhys ? sampleH(c, c.hPhys, x, z) : 0; }

const cellKey = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
function gridAdd(item, x0, x1, z0, z1) {
  item.cells = [];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = cellKey(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(item); item.cells.push(k);
    }
}
function gridRemove(item) {
  for (const k of item.cells || []) { const l = grid.get(k); if (!l) continue; const i = l.indexOf(item); if (i >= 0) l.splice(i, 1); if (!l.length) grid.delete(k); }
}
function pip(p, x, z) {
  let ins = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const zi = p[i + 1], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((p[j] - p[i]) * (z - zi)) / (zj - zi) + p[i]) ins = !ins;
  }
  return ins;
}
function nearestEdge(p, x, z) {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < p.length; i += 2) {
    const k = (i + 2) % p.length, ax = p[i], az = p[i + 1], dx = p[k] - ax, dz = p[k + 1] - az;
    const l = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l));
    const qx = ax + dx * t, qz = az + dz * t, d = (x - qx) ** 2 + (z - qz) ** 2;
    if (d < best) { best = d; bx = qx; bz = qz; }
  }
  return [bx, bz, Math.sqrt(best)];
}
function forNear(x, z, fn) {
  stamp++;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const list = grid.get(cellKey(cx + i, cz + j));
    if (!list) continue;
    for (const it of list) { if (it.stamp === stamp) continue; it.stamp = stamp; fn(it); }
  }
}
export function resolveCollision(pos, radius) {
  forNear(pos.x, pos.z, (it) => {
    if (it.r !== undefined) { // круг
      const dx = pos.x - it.x, dz = pos.z - it.z, rr = it.r + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), k = (rr - d) / d; pos.x += dx * k; pos.z += dz * k; }
      return;
    }
    if (pos.x < it.x0 - radius || pos.x > it.x1 + radius || pos.z < it.z0 - radius || pos.z > it.z1 + radius) return;
    if (pos.y !== undefined && pos.y > it.h - 0.2) return; // на крыше / над зданием
    const ins = pip(it.p, pos.x, pos.z);
    const [qx, qz, d] = nearestEdge(it.p, pos.x, pos.z);
    if (ins) {
      const dx = qx - pos.x, dz = qz - pos.z, l = Math.hypot(dx, dz) || 1;
      pos.x = qx + (dx / l) * radius; pos.z = qz + (dz / l) * radius;
    } else if (d < radius && d > 1e-6) {
      pos.x = qx + ((pos.x - qx) / d) * radius; pos.z = qz + ((pos.z - qz) / d) * radius;
    }
  });
  pos.x = Math.max(BND[0] + 5, Math.min(BND[2] - 5, pos.x));
  pos.z = Math.max(BND[1] + 5, Math.min(BND[3] - 5, pos.z));
}
// Крыша здания под точкой (чтобы стоять на крышах после выхода через люк)
export function roofAt(x, z, y) {
  let best = -Infinity;
  forNear(x, z, (it) => {
    if (it.r !== undefined || it.h > y + 0.5 || it.h <= best || it.h < 3) return;
    if (x < it.x0 || x > it.x1 || z < it.z0 || z > it.z1) return;
    if (pip(it.p, x, z)) best = it.h;
  });
  return best;
}
export function cameraBlocked(x, y, z) {
  if (pointBlocked(x, y, z, 0.25)) return true;
  let hit = false;
  forNear(x, z, (it) => {
    if (hit) return;
    if (it.r !== undefined) { if (it.tall && (x - it.x) ** 2 + (z - it.z) ** 2 < (it.r + 0.2) ** 2 && y < it.tall) hit = true; return; }
    if (x < it.x0 || x > it.x1 || z < it.z0 || z > it.z1 || y > it.h + 0.3) return;
    if (pip(it.p, x, z)) hit = true;
  });
  return hit;
}
function inBuilding(x, z) { let hit = false; forNear(x, z, (it) => { if (!hit && it.r === undefined && x > it.x0 && x < it.x1 && z > it.z0 && z < it.z1 && pip(it.p, x, z)) hit = true; }); return hit; }
// Свободное место для появления врагов: плитка загружена, не в здании, не в воде, не в лагере
export function isFree(x, z) {
  const c = chunkAt(x, z);
  if (!c || !c.hPhys) return false;
  if (x < BND[0] + 10 || x > BND[2] - 10 || z < BND[1] + 10 || z > BND[3] - 10) return false;
  return getHeight(x, z) > -0.4 && !inBuilding(x, z);
}
export const places = () => (index ? index.places : []);
// данные плиток вокруг точки — для мини-карты (недостающие плитки дозагружаются)
export function mapTiles(x, z, r, out = []) {
  out.length = 0;
  if (!index) return out;
  tilesNear(x, z, r, (ix, iz) => { const d = tileData.get(ckey(ix, iz)); if (!d) fetchTile(ix, iz); else if (!d.then) out.push(d); });
  return out;
}
function addPoly(p, h, c) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  const it = { p, h, x0, x1, z0, z1 };
  gridAdd(it, x0, x1, z0, z1);
  if (c) c.polys.push(it);
}
function addCircle(x, z, r, tall = 0, c = null) {
  const it = { x, z, r, tall };
  (c ? c.circles : globals.circles).push(it); gridAdd(it, x - r, x + r, z - r, z + r);
}

// ================= Загрузка =================
const TEX = ['leafy_grass', 'worn_asphalt', 'concrete_pavers', 'granite_tile', 'concrete_floor_worn_001', 'bark_brown_02'];
const MODELS = ['wooden_crate_01', 'stone_fire_pit', 'wine_barrel_01', 'shrub_03'];
function fetchTile(ix, iz) {
  const k = ckey(ix, iz);
  if (!tileData.has(k)) {
    const p = tileSet.has(ix + ',' + iz) ? fetch(`${DATA}t/${ix}_${iz}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : Promise.resolve({});
    tileData.set(k, p.then((d) => { tileData.set(k, d); return d; }));
  }
  return tileData.get(k);
}
const rectDist = (ix, iz, x, z) => Math.hypot(Math.max(ix * TILE - x, 0, x - (ix + 1) * TILE), Math.max(iz * TILE - z, 0, z - (iz + 1) * TILE));
function tilesNear(x, z, r, fn) {
  for (let ix = Math.floor((x - r) / TILE); ix <= Math.floor((x + r) / TILE); ix++) for (let iz = Math.floor((z - r) / TILE); iz <= Math.floor((z + r) / TILE); iz++) {
    if (ix * TILE < BND[0] || (ix + 1) * TILE > BND[2] || iz * TILE < BND[1] || (iz + 1) * TILE > BND[3]) continue;
    const d = rectDist(ix, iz, x, z);
    if (d <= r) fn(ix, iz, d);
  }
}
export async function loadWorldAssets(renderer, scene, onProgress) {
  const photoSets = [...Object.keys(PHOTO_FACADES).map((n) => [n, true]), ...WALL_PHOTOS.map((n) => [n, false])];
  const total = TEX.length * 2 + MODELS.length + 3 + photoSets.reduce((a, [, f]) => a + (f ? 4 : 2), 0) + Object.keys(REAL_FACADES).length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  const tl = new THREE.TextureLoader(), gl = new GLTFLoader();
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const loadTex = async (url, srgb) => { const t = await tl.loadAsync(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; tick(); return t; };
  await Promise.all([
    fetch(`${DATA}index.json`).then((r) => r.json()).then(async (c) => {
      index = c; tileSet = new Set(c.tiles); BND = c.bounds; tick();
      // плитки вокруг лагеря нужны сразу
      const first = []; tilesNear(ZONES.village.x, ZONES.village.z, QUALITY.meshR, (ix, iz) => first.push(fetchTile(ix, iz)));
      await Promise.all(first); tick();
    }),
    ...Object.keys(REAL_FACADES).map(async (n) => { PHOTO[n] = { map: await loadTex(`${ENV}facades/real/${n}.jpg`, true) }; }),
    ...photoSets.map(async ([n, full]) => {
      const u = (k) => `${ENV}facades/${n}_${k}.jpg`;
      const [map, normal, rough, metal] = await Promise.all([loadTex(u('Color'), true), loadTex(u('NormalGL'), false), full ? loadTex(u('Roughness'), false) : null, full ? loadTex(u('Metalness'), false) : null]);
      PHOTO[n] = { map, normal, rough, metal };
    }),
    ...TEX.map(async (n) => { const [map, normal] = await Promise.all([loadTex(`${ENV}tex/${n}_diff.jpg`, true), loadTex(`${ENV}tex/${n}_nor.jpg`, false)]); T[n] = { map, normal }; }),
    ...MODELS.map(async (n) => { const g = await gl.loadAsync(`${ENV}models/${n}/${n}.gltf`); g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); M[n] = g.scene; tick(); }),
    (async () => { const hdr = await new RGBELoader().loadAsync(`${ENV}sky/${SKY}_2k.hdr`); hdr.mapping = THREE.EquirectangularReflectionMapping; scene.background = hdr; scene.environment = hdr; tick(); })(),
  ]);
}

function canvas2(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function pathPoly(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); }
function pathLine(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); }

// Развёртка стен: координата u идёт вдоль каждой стены в одну сторону — надписи не зеркалятся
const V2 = (x, y) => new THREE.Vector2(x, y);
const WALL_UV = {
  generateTopUV(g, v, a, b, c) { return [V2(v[a * 3], v[a * 3 + 1]), V2(v[b * 3], v[b * 3 + 1]), V2(v[c * 3], v[c * 3 + 1])]; },
  generateSideWallUV(g, v, a, b, c, d) {
    const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2], bx = v[b * 3], by = v[b * 3 + 1], bz = v[b * 3 + 2];
    let dx = bx - ax, dy = by - ay; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const ua = ax * dx + ay * dy, ub = bx * dx + by * dy;
    return [V2(ua, 1 - az), V2(ub, 1 - bz), V2(ub, 1 - v[c * 3 + 2]), V2(ua, 1 - v[d * 3 + 2])];
  },
};
function splitExtrude(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const make = (start, count) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.array.slice(start * 3, (start + count) * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.array.slice(start * 3, (start + count) * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.array.slice(start * 2, (start + count) * 2), 2));
    return g;
  };
  const caps = geo.groups.find((gr) => gr.materialIndex === 0), sides = geo.groups.find((gr) => gr.materialIndex === 1);
  return [caps ? make(caps.start, caps.count) : null, sides ? make(sides.start, sides.count) : null];
}
function extrude(shape, y0, y1) {
  let g2;
  try { g2 = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, UVGenerator: WALL_UV }); } catch { return [null, null]; }
  g2.rotateX(-Math.PI / 2);
  if (y0) g2.translate(0, y0, 0);
  const res = splitExtrude(g2); g2.dispose(); return res;
}
// оттенок стен — у каждого дома свой, чтобы кварталы не выглядели одинаковыми
const TINTS = [[1, 1, 1], [1, 0.95, 0.86], [0.9, 0.95, 1], [1, 0.9, 0.82], [0.9, 1, 0.93], [1, 0.97, 0.78], [0.86, 0.86, 0.9], [1, 0.86, 0.86], [0.95, 0.9, 1]];
// какой фасад получит дом: по высоте, типу и «номеру» дома (hv). Большая часть — с реальных фото Астаны
const ST_TOWER = ['rp_astana_talan', 'rp_astana_brick', 'rp_astana_w1', 'rp_astana_modern', 'rp_astana_academy', 'ph_Facade001', 'rp_astana_w1', 'rp_astana_modern', 'ph_Facade005', 'rp_astana_brick'];
const ST_GLASS = ['rp_astana_academy', 'ph_Facade006', 'rp_astana_w1', 'ph_Facade019A', 'rp_astana_academy', 'ph_Facade001', 'glassBronze', 'ph_Facade005'];
const ST_LOW = ['rp_astana_ornate', 'brickYellow', 'rp_astana_panel', 'brickRed', 'rp_astana_ornate', 'panelBeige', 'panelWhite'];
const ST_MID = ['rp_astana_panel', 'rp_astana_bay', 'panelWhite', 'rp_astana_brick', 'panelBeige', 'rp_astana_modern', 'ph_Facade018A', 'rp_astana_panel', 'panelGrey', 'rp_astana_bay', 'ph_Facade020A'];
function styleFor(h, kind, hv) {
  const pick = (a) => a[hv % a.length];
  if (h >= 45) return pick(ST_TOWER);
  if ((kind === 'office' || kind === 'hotel' || kind === 'commercial' || kind === 'retail') && h > 16) return pick(ST_GLASS);
  if (h <= 16 && kind !== 'apartments') return pick(ST_LOW);
  return pick(ST_MID);
}
const plainTint = (style) => style.startsWith('rp_') || style.startsWith('ph_') || style.startsWith('glass'); // фото не перекрашиваем
function tint(geo, hv, glassy) {
  const t = glassy ? [1, 1, 1] : TINTS[hv % TINTS.length], k = glassy ? 0.9 + ((hv * 7) % 16) / 100 : 0.8 + ((hv * 7) % 23) / 100;
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = t[0] * k; a[i * 3 + 1] = t[1] * k; a[i * 3 + 2] = t[2] * k; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const shared = (g) => { g.userData.shared = true; return g; };

// ================= Общие материалы и геометрии =================
function makeShared() {
  const windU = { uTime: { value: 0 } };
  const mats = makeFacadeMaterials(PHOTO);
  for (const [k, m] of Object.entries(mats)) if (k !== 'shop') m.vertexColors = true;
  const roofTex = T.concrete_floor_worn_001.map.clone(); roofTex.repeat.set(1 / 6, 1 / 6); roofTex.needsUpdate = true;
  const barkMat = new THREE.MeshStandardMaterial({ map: T.bark_brown_02.map, normalMap: T.bark_brown_02.normal, roughness: 0.95 });
  const trees = [11, 23, 37].map((sd) => {
    const g = spruceGeometry(sd);
    const leafMat = new THREE.MeshStandardMaterial({ map: branchTexture(sd * 7), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
    windSway(leafMat, windU, 0.04);
    return { trunk: shared(g.trunk), foliage: shared(g.foliage), leafMat };
  });
  const cards = [0, 1, 2].map((k) => { const pl = new THREE.PlaneGeometry(1.1, 0.7); pl.translate(0, 0.35, 0); pl.rotateY((k * Math.PI) / 3); return pl.toNonIndexed(); });
  const tuft = shared(mergeGeometries(cards));
  const tn = tuft.attributes.normal; for (let i = 0; i < tn.count; i++) tn.setXYZ(i, 0, 1, 0);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  windSway(grassMat, windU, 0.18);
  const farTex = T.concrete_pavers.map.clone(); farTex.repeat.set(60, 60); farTex.needsUpdate = true;
  return {
    windU, mats, trees, tuft, grassMat, barkMat,
    roofMat: new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95, color: 0x9a9a98 }),
    concrete: new THREE.MeshStandardMaterial({ map: T.concrete_floor_worn_001.map, roughness: 0.9, color: 0xb8b6b0 }),
    lampMat: new THREE.MeshStandardMaterial({ color: 0x3b3e40, metalness: 0.6, roughness: 0.5 }),
    poleGeo: shared(mergeGeometries([tcyl(0.09, 0.14, 8, 6, 2).translate(0, 4, 0).toNonIndexed(), tbox(1.6, 0.1, 0.12, 1).translate(0.75, 7.9, 0).toNonIndexed(), tbox(0.6, 0.15, 0.3, 1).translate(1.45, 7.8, 0).toNonIndexed()])),
    metal: new THREE.MeshStandardMaterial({ color: 0x4a4e52, metalness: 0.6, roughness: 0.45 }),
    glassM: new THREE.MeshStandardMaterial({ color: 0x9fb4bf, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.45 }),
    stopGeo: shared(mergeGeometries([
      tbox(4.2, 0.12, 1.8, 2).translate(0, 2.6, 0).toNonIndexed(),
      ...[[-2, -0.8], [2, -0.8], [-2, 0.8], [2, 0.8]].map(([x, z]) => tcyl(0.05, 0.05, 2.6, 6, 1).translate(x, 1.3, z).toNonIndexed()),
      tbox(3.6, 0.1, 0.45, 1).translate(0, 0.5, -0.5).toNonIndexed(),
    ])),
    stopGlass: shared(tbox(4.0, 1.9, 0.04, 2).translate(0, 1.45, -0.85)),
    sigGeo: shared(mergeGeometries([tcyl(0.08, 0.1, 4.2, 6, 1).translate(0, 2.1, 0).toNonIndexed(), tbox(0.4, 1.1, 0.35, 1).translate(0, 4.4, 0.15).toNonIndexed()])),
    sigMat: new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.5, metalness: 0.4 }),
    benchGeo: shared(mergeGeometries([tbox(1.8, 0.08, 0.45, 1).translate(0, 0.45, 0).toNonIndexed(), tbox(1.8, 0.4, 0.06, 1).translate(0, 0.72, -0.2).toNonIndexed(), tbox(0.08, 0.45, 0.4, 1).translate(-0.8, 0.22, 0).toNonIndexed(), tbox(0.08, 0.45, 0.4, 1).translate(0.8, 0.22, 0).toNonIndexed()])),
    benchMat: new THREE.MeshStandardMaterial({ map: T.bark_brown_02.map, roughness: 0.9 }),
    fenceMat: new THREE.MeshStandardMaterial({ color: 0x2c2f31, metalness: 0.6, roughness: 0.5 }),
    farGeo: shared(new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2)),
    farMat: new THREE.MeshStandardMaterial({ map: farTex, roughness: 0.95, color: 0x8f8d86 }),
  };
}

// ================= Плитка: данные (рельеф и стены) =================
function newChunk(ix, iz) {
  const c = { ix, iz, key: ckey(ix, iz), x0: ix * TILE, z0: iz * TILE, d: null, hPhys: null, hRiver: null, polys: [], circles: [], doors: [], flames: [], smokes: [], lamps: [], group: null, building: false };
  chunks.set(c.key, c);
  const d = fetchTile(ix, iz);
  if (d.then) d.then((dd) => { if (chunks.get(c.key) === c) makeData(c, dd); }); else makeData(c, d);
  return c;
}
function localTransform(g, c, pad) { g.setTransform(1 / RES, 0, 0, 1 / RES, -c.x0 / RES + pad, -c.z0 / RES + pad); }
function rasterHeights(c, bridges) {
  const SZ = HW + HPAD * 2;
  const [, g] = canvas2(SZ, SZ);
  g.fillStyle = '#000'; g.fillRect(0, 0, SZ, SZ);
  localTransform(g, c, HPAD);
  g.filter = 'blur(1.5px)'; g.fillStyle = '#fff';
  for (const w of c.d.water || []) { pathPoly(g, w.p); g.fill(); }
  g.filter = 'none';
  if (bridges) { g.strokeStyle = '#000'; g.lineCap = 'round'; for (const r of c.d.roads || []) if (r.b) { g.lineWidth = r.w + 3; pathLine(g, r.p); g.stroke(); } }
  const d = g.getImageData(HPAD, HPAD, HW, HW).data, out = new Float32Array(HW * HW);
  for (let i = 0; i < out.length; i++) out[i] = (RIVERBED * d[i * 4]) / 255;
  return out;
}
const FLAT = new Float32Array(HW * HW);
function makeData(c, d) {
  c.d = d;
  if (d.water && d.water.length) { c.hRiver = rasterHeights(c, false); c.hPhys = d.roads && d.roads.some((r) => r.b) ? rasterHeights(c, true) : c.hRiver; }
  else c.hRiver = c.hPhys = FLAT;
  for (const b of d.buildings || []) { const h = Math.max(3, Math.min(400, b.h)), mh = Math.min(b.mh || 0, h - 1); if (mh < 2.5) addPoly(b.p, h, c); }
}
function dropMesh(c) {
  if (!c.group) return;
  c.group.parent?.remove(c.group);
  c.group.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
  for (const m of c.ownMats || []) { m.dispose(); }
  for (const t of c.ownTex || []) t.dispose();
  for (const it of c.circles) gridRemove(it);
  c.circles = []; c.doors = []; c.flames = []; c.smokes = []; c.lamps = []; c.group = null; c.sp = null;
}
function dropChunk(c) {
  dropMesh(c);
  for (const it of c.polys) gridRemove(it);
  chunks.delete(c.key);
}

// ================= Плитка: подробная постройка (по шагам, чтобы игра не замирала) =================
function* buildMesh(c, W) {
  const d = c.d, grp = new THREE.Group();
  const rng = mulberry32(((c.ix * 73856093) ^ (c.iz * 19349663)) >>> 0);
  const { x0, z0 } = c, x1 = x0 + TILE, z1 = z0 + TILE;
  const inT = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
  const circle = (x, z, r, tall = 0) => addCircle(x, z, r, tall, c);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const mat4 = (x, y, z, ry, sx, sy = sx, sz = sx, rx = 0, rz = 0) => { e.set(rx, ry, rz); q.setFromEuler(e); s.set(sx, sy, sz); p.set(x, y, z); return m4.compose(p, q, s); };
  const nearZone = (x, z, pad) => Math.hypot(x - ZONES.village.x, z - ZONES.village.z) < ZONES.village.r + pad;
  const roads = d.roads || [], blds = d.buildings || [];
  c.ownMats = []; c.ownTex = [];

  // ---------- карта поверхности: асфальт / газон / плитка ----------
  const [, gR] = canvas2(N, N), [, gG] = canvas2(N, N), [, gB] = canvas2(N, N);
  for (const g of [gR, gG, gB]) { g.fillStyle = '#000'; g.fillRect(0, 0, N, N); localTransform(g, c, 0); g.lineCap = g.lineJoin = 'round'; }
  gG.fillStyle = '#fff';
  for (const gr of d.green || []) { pathPoly(gG, gr.p); gG.fill(); }
  gR.fillStyle = '#fff';
  for (const pk of d.parking || []) { pathPoly(gR, pk.p); gR.fill(); }
  gR.strokeStyle = gB.strokeStyle = '#fff';
  const FOOT = new Set(['footway', 'cycleway', 'path', 'steps', 'pedestrian']);
  for (const r of roads) { if (r.tn) continue; const g = FOOT.has(r.t) ? gB : gR; g.lineWidth = r.w; pathLine(g, r.p); g.stroke(); }
  gB.fillStyle = '#fff';
  gB.beginPath(); gB.arc(0, 0, 60, 0, Math.PI * 2); gB.fill(); // площадь у Байтерека
  const L = index.landmarks;
  if (L.akorda) { gB.beginPath(); gB.ellipse(L.akorda.x - 150, L.akorda.z, 150, 70, 0, 0, Math.PI * 2); gB.fill(); }
  const dR = gR.getImageData(0, 0, N, N).data, dG = gG.getImageData(0, 0, N, N).data, dB = gB.getImageData(0, 0, N, N).data;
  const sp = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const r = dR[i * 4], b = dB[i * 4] * (1 - r / 255), gg = dG[i * 4] * (1 - r / 255) * (1 - b / 255);
    sp[i * 4] = r; sp[i * 4 + 1] = gg; sp[i * 4 + 2] = b; sp[i * 4 + 3] = 255;
  }
  const splat = new THREE.DataTexture(sp, N, N, THREE.RGBAFormat);
  splat.magFilter = splat.minFilter = THREE.LinearFilter; splat.needsUpdate = true;
  c.ownTex.push(splat);
  const spi = (x, z) => (Math.max(0, Math.min(N - 1, ((z - z0) / RES) | 0)) * N + Math.max(0, Math.min(N - 1, ((x - x0) / RES) | 0))) * 4;
  const isGreen = (x, z) => sp[spi(x, z) + 1] > 160;
  const isRoad = (x, z) => sp[spi(x, z)] > 60;

  // ---------- земля ----------
  const seg = 50, tg = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
  tg.rotateX(-Math.PI / 2); tg.translate(x0 + TILE / 2, 0, z0 + TILE / 2);
  const pos = tg.attributes.position;
  if (c.hRiver !== FLAT) { for (let i = 0; i < pos.count; i++) pos.setY(i, sampleH(c, c.hRiver, pos.getX(i), pos.getZ(i))); tg.computeVertexNormals(); }
  const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.25, pos.getZ(i) * 0.25);
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.92, map: T.concrete_pavers.map, normalMap: T.concrete_pavers.normal, normalScale: new THREE.Vector2(0.6, 0.6) });
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tSplat: { value: splat }, tAsph: { value: T.worn_asphalt.map }, tPave: { value: T.concrete_pavers.map }, tGrass: { value: T.leafy_grass.map }, tFoot: { value: T.granite_tile.map }, uO: { value: new THREE.Vector2(x0, z0) } });
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tSplat, tAsph, tPave, tGrass, tFoot; uniform vec2 uO; varying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 suv = clamp((vWPos.xz - uO) / ${TILE}.0, 0.002, 0.998);
      vec4 sp = texture2D(tSplat, suv);
      vec2 w = vWPos.xz;
      vec3 cP = texture2D(tPave, w * 0.22).rgb * 0.9;
      vec3 cA = texture2D(tAsph, w * 0.12).rgb * 0.8;
      vec3 cG = texture2D(tGrass, w * 0.3).rgb * vec3(0.78, 0.82, 0.62);
      vec3 cF = texture2D(tFoot, w * 0.35).rgb;
      float n = texture2D(tAsph, w * 0.011).r;
      vec3 col = mix(cP, cG, sp.g);
      col = mix(col, cF, sp.b);
      col = mix(col, cA, sp.r);
      col *= mix(0.82, 1.08, n);
      float wet = clamp(-vWPos.y / 1.8, 0.0, 1.0);
      col = mix(col, vec3(0.13, 0.12, 0.10), wet);
      diffuseColor.rgb *= col;`);
  };
  groundMat.customProgramCacheKey = () => 'astGround';
  c.ownMats.push(groundMat);
  const ground = new THREE.Mesh(tg, groundMat); ground.receiveShadow = true; grp.add(ground);
  yield;

  // ---------- здания ----------
  const buckets = new Map([['roof', []], ...Object.keys(S.mats).map((k) => [k, []])]);
  const tall = [];
  let cnt = 0;
  for (const b of blds) {
    const h = Math.max(3, Math.min(400, b.h)), mh = Math.min(b.mh || 0, h - 1);
    // контур чуть сжат к центру (на 3–15 см), чтобы стены пересекающихся зданий из OSM не мерцали
    let ccx = 0, ccz = 0; const nn = b.p.length / 2; for (let k = 0; k < b.p.length; k += 2) { ccx += b.p[k]; ccz += b.p[k + 1]; } ccx /= nn; ccz /= nn;
    const shrink = (k) => { const dx = b.p[k] - ccx, dz = b.p[k + 1] - ccz, dd = Math.hypot(dx, dz) || 1, inset = Math.min(0.15, 0.03 + (k % 5) * 0.03); return [b.p[k] - (dx / dd) * inset, b.p[k + 1] - (dz / dd) * inset]; };
    const shape = new THREE.Shape();
    const p0 = shrink(0); shape.moveTo(p0[0], -p0[1]);
    for (let i = 2; i < b.p.length; i += 2) { const qq = shrink(i); shape.lineTo(qq[0], -qq[1]); }
    const hv = (((b.p[0] * 13 + b.p[1] * 7) | 0) >>> 0) % 997;
    const small = h < 8.5 && !['apartments', 'retail', 'commercial', 'office'].includes(b.k);
    const style = buckets.has(styleFor(h, b.k, hv)) ? styleFor(h, b.k, hv) : 'panelWhite';
    const glassy = plainTint(style);
    const put = (sides) => buckets.get(style).push(tint(sides, hv, glassy));
    // первый этаж с витринами у городских домов (не у гаражей, частных домов и «висящих» частей)
    const shopBand = !mh && h > 9 && !['garage', 'garages', 'shed', 'industrial', 'kiosk'].includes(b.k) && (hv % 5) !== 0;
    if (shopBand) {
      let best = 0, bi = 0; for (let k = 0; k < b.p.length; k += 2) { const k2 = (k + 2) % b.p.length, l = Math.hypot(b.p[k2] - b.p[k], b.p[k2 + 1] - b.p[k + 1]); if (l > best) { best = l; bi = k; } }
      const k2 = (bi + 2) % b.p.length, mx = (b.p[bi] + b.p[k2]) / 2, mz = (b.p[bi + 1] + b.p[k2 + 1]) / 2;
      let nx = -(b.p[k2 + 1] - b.p[bi + 1]) / (best || 1), nz = (b.p[k2] - b.p[bi]) / (best || 1);
      if ((mx + nx - ccx) ** 2 + (mz + nz - ccz) ** 2 < (mx - nx - ccx) ** 2 + (mz - nz - ccz) ** 2) { nx = -nx; nz = -nz; }
      if (best > 6) c.doors.push({ x: mx + nx * 1.3, z: mz + nz * 1.3, kind: 'shop', face: Math.atan2(nx, nz) });
      const [, shopSides] = extrude(shape, 0, SHOP_H);
      const [caps, sides] = extrude(shape, SHOP_H, h);
      if (shopSides) buckets.get('shop').push(shopSides);
      if (sides) put(sides);
      if (caps) buckets.get('roof').push(caps);
    } else {
      const [caps, sides] = extrude(shape, mh, h);
      if (!caps && !sides) continue;
      if (sides) put(sides);
      if (caps) buckets.get('roof').push(caps);
      // двускатная крыша у частных домов: конёк вдоль длинной стороны
      if (small && b.p.length === 8 && !mh) {
        const P = b.p, l1 = Math.hypot(P[2] - P[0], P[3] - P[1]), l2 = Math.hypot(P[4] - P[2], P[5] - P[3]);
        const o = l1 >= l2 ? 0 : 2, A = [P[o], P[o + 1]], Bq = [P[(o + 2) % 8], P[(o + 3) % 8]], C = [P[(o + 4) % 8], P[(o + 5) % 8]], D = [P[(o + 6) % 8], P[(o + 7) % 8]];
        const rh = Math.min(l1, l2) * 0.32, r1 = [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2], r2 = [(Bq[0] + C[0]) / 2, (Bq[1] + C[1]) / 2];
        const v = (pt, y) => [pt[0], y, pt[1]];
        const tris = [v(A, h), v(Bq, h), v(r2, h + rh), v(A, h), v(r2, h + rh), v(r1, h + rh), v(C, h), v(D, h), v(r1, h + rh), v(C, h), v(r1, h + rh), v(r2, h + rh), v(D, h), v(A, h), v(r1, h + rh), v(Bq, h), v(C, h), v(r2, h + rh)];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tris.flatMap((t) => [t[0], t[2]])), 2));
        g.computeVertexNormals();
        // нормали наружу (вверх), каким бы ни был обход контура
        const nr = g.attributes.normal, ps = g.attributes.position;
        for (let i = 0; i < nr.count; i += 3) if (nr.getY(i) < 0) { for (let k = 0; k < 3; k++) nr.setXYZ(i + k, -nr.getX(i + k), -nr.getY(i + k), -nr.getZ(i + k)); const ax = ps.getX(i + 1), ay = ps.getY(i + 1), az = ps.getZ(i + 1); ps.setXYZ(i + 1, ps.getX(i + 2), ps.getY(i + 2), ps.getZ(i + 2)); ps.setXYZ(i + 2, ax, ay, az); }
        (buckets.get('gable') || buckets.set('gable', []).get('gable')).push(g);
      }
    }
    if (h > 30) tall.push({ x: ccx, z: ccz, h });
    // техника на крыше: вентиляция, лифтовые будки, антенны
    if (h > 12) {
      const cn = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < cn; k++) {
        const x = ccx + (rng() - 0.5) * 8, z = ccz + (rng() - 0.5) * 8;
        if (!pip(b.p, x, z)) continue;
        const w = 1.5 + rng() * 3, hh = 1 + rng() * 2.2, dd = 1.5 + rng() * 3;
        buckets.get('roof').push(tbox(w, hh, dd, 2).translate(x, h + hh / 2, z).toNonIndexed());
        if (rng() < 0.25) buckets.get('roof').push(tcyl(0.06, 0.08, 4 + rng() * 6, 4, 2).translate(x + w / 2, h + 3, z).toNonIndexed());
      }
    }
    if (++cnt % 25 === 0) yield;
  }
  for (const [k, geos] of buckets) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), k === 'roof' ? S.roofMat : k === 'gable' ? S.gableMat : S.mats[k]);
    for (const g of geos) g.dispose();
    mesh.castShadow = mesh.receiveShadow = true;
    grp.add(mesh);
  }
  // горящие здания: столбы чёрного дыма над крышами
  if (tall.length && rng() < 0.4) {
    const b = tall[Math.floor(rng() * tall.length)];
    c.smokes.push({ x: b.x, y: b.h + 1, z: b.z, dark: 1, size: 3 });
    c.flames.push({ meshes: [], light: null, o: rng() * 10, x: b.x, y: b.h + 0.3, z: b.z, color: 0xff7a20, size: 1.6 });
  }
  yield;

  // ---------- мосты ----------
  const deck = [];
  for (const r of roads) {
    if (!r.b) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      if (len < 0.5 || !inT(cx, cz)) continue;
      const ang = Math.atan2(bx - ax, bz - az);
      const dk = tbox(r.w, 0.8, len + 0.6, 4); dk.rotateY(ang); dk.translate(cx, -0.38, cz); deck.push(dk.toNonIndexed());
      for (const side of [-1, 1]) { const rl = tbox(0.3, 1.0, len + 0.6, 2); rl.translate(side * (r.w / 2 - 0.15), 0.5, 0); rl.rotateY(ang); rl.translate(cx, 0, cz); deck.push(rl.toNonIndexed()); }
    }
  }
  if (deck.length) { const dm = new THREE.Mesh(mergeGeometries(deck), S.concrete); dm.castShadow = dm.receiveShadow = true; grp.add(dm); }

  // ---------- деревья ----------
  const treeList = [[], [], []];
  const plantTree = (x, z) => {
    if (!inT(x, z) || nearZone(x, z, 4) || Math.hypot(x, z) < 20) return;
    const h = getHeight(x, z);
    if (h < -0.5) return;
    const sc = 0.55 + rng() * 0.45;
    treeList[Math.floor(rng() * 3)].push([x, h - 0.2, z, rng() * 6.28, sc, sc * (0.9 + rng() * 0.25), rng(), rng(), rng()]);
    circle(x, z, 0.4 * sc);
  };
  const tr = d.trees || [];
  for (let i = 0; i < tr.length; i += 2) plantTree(tr[i], tr[i + 1]);
  for (let tries = 0, k = 0; k < 40 && tries < 500; tries++) {
    const x = x0 + rng() * TILE, z = z0 + rng() * TILE;
    if (isGreen(x, z) && !inBuilding(x, z) && rng() < 0.6) { plantTree(x, z); k++; }
  }
  // аллеи вдоль улиц
  for (const r of roads) {
    if (!['primary', 'secondary', 'tertiary', 'residential'].includes(r.t) || r.b || r.tn) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let dd = 6; dd < len; dd += 13) for (const side of [-1, 1]) {
        const off = r.w / 2 + 3.5, x = ax + ux * dd - uz * off * side, z = az + uz * dd + ux * off * side;
        if (!inT(x, z) || isRoad(x, z) || inBuilding(x, z) || rng() < 0.3) continue;
        plantTree(x, z);
      }
    }
  }
  const leafCol = new THREE.Color();
  treeList.forEach((list, vi) => {
    if (!list.length) return;
    const v = S.trees[vi], trunk = new THREE.InstancedMesh(v.trunk, S.barkMat, list.length), lf = new THREE.InstancedMesh(v.foliage, v.leafMat, list.length);
    list.forEach(([x, y, z, ry, sx, sy, a, b2, c2], i) => { mat4(x, y, z, ry, sx, sy, sx); trunk.setMatrixAt(i, m4); lf.setMatrixAt(i, m4); lf.setColorAt(i, leafCol.setHSL(0.26 + a * 0.06, 0.25 + b2 * 0.2, 0.36 + c2 * 0.16)); });
    trunk.castShadow = lf.castShadow = true; trunk.receiveShadow = lf.receiveShadow = true;
    trunk.computeBoundingSphere(); lf.computeBoundingSphere();
    grp.add(trunk, lf);
  });
  // трава на газонах
  const GN = Math.round(700 * QUALITY.grass);
  if (GN > 0) {
    const grass = new THREE.InstancedMesh(S.tuft, S.grassMat, GN), gc = new THREE.Color();
    let gn = 0;
    for (let tries = 0; gn < GN && tries < GN * 6; tries++) {
      const x = x0 + rng() * TILE, z = z0 + rng() * TILE;
      if (!isGreen(x, z)) continue;
      const sc = 0.6 + rng() * 0.8;
      grass.setMatrixAt(gn, mat4(x, getHeight(x, z) - 0.05, z, rng() * 6.28, sc, sc * (0.7 + rng() * 0.6), sc));
      grass.setColorAt(gn++, gc.setHSL(0.15 + rng() * 0.06, 0.3, 0.7 + rng() * 0.2));
    }
    grass.count = gn; grass.receiveShadow = true;
    if (gn) { grass.computeBoundingSphere(); grp.add(grass); }
  }
  yield;

  // ---------- фонари вдоль больших улиц ----------
  const lampPos = [];
  for (const r of roads) {
    if (!['primary', 'secondary', 'tertiary'].includes(r.t) || r.b || r.tn) continue;
    let acc = rng() * 40;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let dd = acc; dd < len; dd += 42) {
        const side = lampPos.length % 2 ? 1 : -1, off = r.w / 2 + 1.2;
        const x = ax + ux * dd - uz * off * side, z = az + uz * dd + ux * off * side;
        if (inT(x, z)) lampPos.push([x, z, Math.atan2(uz * side, -ux * side) + Math.PI / 2]);
      }
      acc = ((acc - len) % 42 + 42) % 42;
    }
  }
  if (lampPos.length) {
    const lampsIM = new THREE.InstancedMesh(S.poleGeo, S.lampMat, lampPos.length);
    lampPos.forEach(([x, z, ry], i) => { lampsIM.setMatrixAt(i, mat4(x, getHeight(x, z), z, ry, 1)); circle(x, z, 0.25); });
    lampsIM.castShadow = true; lampsIM.computeBoundingSphere(); grp.add(lampsIM);
  }

  // ---------- брошенные машины ----------
  const fleet = new CarFleet(grp, 70, rng);
  let nc = 0;
  const carCollide = (kind, x, z, ry) => {
    const sp2 = carSpec(kind), n = Math.max(2, Math.round(sp2.L / 2.2)), r = sp2.W / 2 + 0.1;
    for (let k = 0; k < n; k++) { const dd = (k / (n - 1) - 0.5) * (sp2.L - sp2.W); circle(x + Math.sin(ry) * dd, z + Math.cos(ry) * dd, r); }
  };
  const majors = roads.filter((r) => ['primary', 'secondary', 'tertiary', 'residential', 'service'].includes(r.t) && !r.tn);
  for (let tries = 0; majors.length && nc < 14 && tries < 220; tries++) {
    const r = majors[Math.floor(rng() * majors.length)];
    const i = Math.floor(rng() * (r.p.length / 2 - 1)) * 2;
    const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
    if (len < 6) continue;
    const t = rng(), lat = (rng() - 0.5) * Math.max(0, r.w - 2.5);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const x = ax + (bx - ax) * t - uz * lat, z = az + (bz - az) * t + ux * lat;
    if (!inT(x, z) || nearZone(x, z, 8) || Math.hypot(x, z) < 30) continue;
    if (r.b && rng() < 0.6) continue;
    const ry = Math.atan2(ux, uz) + (rng() - 0.5) * 0.9 + (rng() < 0.5 ? Math.PI : 0);
    const y = getHeight(x, z), burnt = rng() < 0.12;
    let kind = fleet.pick();
    if (kind === 'bus' && !['primary', 'secondary'].includes(r.t)) kind = 'sedan';
    const flip = kind !== 'bus' && rng() < 0.05, top = carSpec(kind).body.reduce((m, pt) => Math.max(m, pt[1]), 0);
    mat4(x, y + (flip ? top + 0.05 : 0), z, ry, 1, 1, 1, 0, flip ? Math.PI : 0);
    if (!fleet.add(kind, m4, burnt)) continue;
    nc++;
    carCollide(kind, x, z, ry);
    if (burnt) { c.flames.push({ meshes: [], light: null, o: rng() * 10, x, y: y + 1.2, z, color: 0xff8a30, size: 0.8 }); c.smokes.push({ x, y: y + 2, z, dark: 1, size: 1.4 }); }
  }
  for (const pk of d.parking || []) {
    let px0 = Infinity, px1 = -Infinity, pz0 = Infinity, pz1 = -Infinity;
    for (let i = 0; i < pk.p.length; i += 2) { px0 = Math.min(px0, pk.p[i]); px1 = Math.max(px1, pk.p[i]); pz0 = Math.min(pz0, pk.p[i + 1]); pz1 = Math.max(pz1, pk.p[i + 1]); }
    const alongX = px1 - px0 > pz1 - pz0;
    for (let a = (alongX ? px0 : pz0) + 1.5; a < (alongX ? px1 : pz1) - 1.5 && nc < 66; a += 2.8) {
      for (let b = (alongX ? pz0 : px0) + 3; b < (alongX ? pz1 : px1) - 3 && nc < 66; b += 6.5) {
        const x = alongX ? a : b, z = alongX ? b : a;
        if (rng() > 0.5 || !pip(pk.p, x, z) || nearZone(x, z, 0) || inBuilding(x, z)) continue;
        const ry = (alongX ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0) + (rng() - 0.5) * 0.15, y = getHeight(x, z);
        mat4(x, y, z, ry, 1);
        let kind = fleet.pick(); if (kind === 'bus' || kind === 'van') kind = 'sedan';
        if (!fleet.add(kind, m4, rng() < 0.04)) continue;
        nc++;
        carCollide(kind, x, z, ry);
      }
    }
  }
  fleet.finish();
  for (const t of Object.values(fleet.types)) if (!t.n) for (const im of Object.values(t.ims)) { grp.remove(im); im.dispose(); }
  yield;

  // ---------- остановки, светофоры, скамейки, заборы ----------
  const majorRoads = roads.filter((r) => !FOOT.has(r.t));
  const roadAngle = (x, z) => {
    let best = 1e9, ang = 0;
    for (const r of majorRoads) for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
      if (Math.abs(ax - x) > 80 && Math.abs(bx - x) > 80) continue;
      const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l));
      const dd = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (dd < best) { best = dd; ang = Math.atan2(dx, dz); }
    }
    return ang;
  };
  const st = d.stops || [], nS = st.length / 2;
  if (nS) {
    const stopIM = new THREE.InstancedMesh(S.stopGeo, S.metal, nS), sgIM = new THREE.InstancedMesh(S.stopGlass, S.glassM, nS);
    for (let i = 0; i < nS; i++) { const x = st[i * 2], z = st[i * 2 + 1], ry = roadAngle(x, z) + Math.PI / 2; mat4(x, getHeight(x, z), z, ry, 1); stopIM.setMatrixAt(i, m4); sgIM.setMatrixAt(i, m4); circle(x, z, 1.4); }
    stopIM.castShadow = true; stopIM.computeBoundingSphere(); sgIM.computeBoundingSphere(); grp.add(stopIM, sgIM);
  }
  const sig = d.signals || [], nT = sig.length / 2;
  if (nT) {
    const sigIM = new THREE.InstancedMesh(S.sigGeo, S.sigMat, nT);
    for (let i = 0; i < nT; i++) { const x = sig[i * 2], z = sig[i * 2 + 1]; sigIM.setMatrixAt(i, mat4(x, getHeight(x, z), z, roadAngle(x, z), 1)); circle(x, z, 0.2); }
    sigIM.castShadow = true; sigIM.computeBoundingSphere(); grp.add(sigIM);
  }
  const be = d.benches || [], nB = be.length / 2;
  if (nB) {
    const benchIM = new THREE.InstancedMesh(S.benchGeo, S.benchMat, nB);
    for (let i = 0; i < nB; i++) { const x = be[i * 2], z = be[i * 2 + 1]; benchIM.setMatrixAt(i, mat4(x, getHeight(x, z), z, rng() * 6.28, 1)); }
    benchIM.computeBoundingSphere(); grp.add(benchIM);
  }
  const fenceGeo = [];
  let fc = 0;
  for (const fz of d.fences || []) {
    for (let i = 0; i + 3 < fz.p.length && fc < 500; i += 2) {
      const ax = fz.p[i], az = fz.p[i + 1], bx = fz.p[i + 2], bz = fz.p[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3 || len > 400) continue;
      const ang = Math.atan2(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, y = getHeight(cx, cz), hh = fz.t ? 2.2 : 1.6;
      for (const yy of [0.15, hh - 0.1]) { const rl = tbox(0.06, 0.06, len, 1); rl.rotateY(ang); rl.translate(cx, y + yy, cz); fenceGeo.push(rl.toNonIndexed()); }
      let n2 = 0;
      for (let dd = 0; dd < len; dd += 1.2) {
        const px = ax + (bx - ax) * (dd / len), pz = az + (bz - az) * (dd / len);
        fenceGeo.push(tbox(0.05, hh, 0.05, 1).translate(px, y + hh / 2, pz).toNonIndexed());
        if (n2++ % 2 === 0) circle(px, pz, 0.45);
        fc++;
      }
    }
  }
  if (fenceGeo.length) { const fm = new THREE.Mesh(mergeGeometries(fenceGeo), S.fenceMat); fm.castShadow = true; grp.add(fm); }
  yield;

  // ---------- дворы и детали улиц ----------
  buildYards({ scene: grp, city: { green: d.areas || [], buildings: blds, roads, signals: sig }, rng, getHeight, addCircle: circle, pip, M, T, isRoad, inBuilding, nearZone, doors: c.doors, rect: [x0, z0, TILE], inTile: inT, bushN: Math.round(14 * Math.sqrt(QUALITY.grass)) });
  yield;

  // плитка неподвижна — матрицы считаем один раз
  grp.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  grp.updateMatrixWorld(true);
  grp.traverse((o) => { o.matrixWorldAutoUpdate = false; });
  c.sp = sp;
  c.group = grp;
  W.scene.add(grp);
  W.refresh();
}

// ================= Мир =================
export function buildWorld(scene) {
  for (const c of [...chunks.values()]) dropChunk(c);
  colliders.length = 0; grid.clear(); doors.length = 0;
  globals.circles = []; globals.flames = []; globals.smokes = []; globals.lamps = [];
  S = makeShared();
  S.gableMat = new THREE.MeshStandardMaterial({ color: 0x6a4a3c, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  const rng = mulberry32(77017);
  const L = index.landmarks;
  const world = {
    scene, flames: [], smokes: [], lamps: [], places: index.places, bounds: BND,
    // собрать общие списки огней, дверей и препятствий из построенных плиток
    refresh() {
      world.flames.length = 0; world.smokes.length = 0; world.lamps.length = 0; doors.length = 0; colliders.length = 0;
      world.flames.push(...globals.flames); world.smokes.push(...globals.smokes); world.lamps.push(...globals.lamps); colliders.push(...globals.circles);
      for (const c of chunks.values()) { if (!c.group) continue; world.flames.push(...c.flames); world.smokes.push(...c.smokes); world.lamps.push(...c.lamps); doors.push(...c.doors); colliders.push(...c.circles); }
    },
  };

  const water = new THREE.Mesh(new THREE.PlaneGeometry(BND[2] - BND[0] + 6000, BND[3] - BND[1] + 6000), new THREE.MeshStandardMaterial({ color: 0x1b2a30, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2; water.position.set((BND[0] + BND[2]) / 2, WATER_LEVEL, (BND[1] + BND[3]) / 2);
  scene.add(water);
  // земля за краем города
  {
    const R0 = 8000, sh = new THREE.Shape([[BND[0] - R0, -BND[1] + R0], [BND[2] + R0, -BND[1] + R0], [BND[2] + R0, -BND[3] - R0], [BND[0] - R0, -BND[3] - R0]].map(([x, y]) => new THREE.Vector2(x, y)));
    sh.holes.push(new THREE.Path([[BND[0], -BND[1]], [BND[0], -BND[3]], [BND[2], -BND[3]], [BND[2], -BND[1]]].map(([x, y]) => new THREE.Vector2(x, y))));
    const rim = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5c4e, roughness: 1 }));
    rim.position.y = -0.05; scene.add(rim);
  }

  buildInteriors(scene, T);
  buildLandmarks(scene, L, rng);

  // ---------- дальний план: земля и высотки по всему городу ----------
  const far = new Map();
  const makeFar = (ix, iz) => {
    const g = new THREE.Group();
    const list = index.sky[ix + ',' + iz];
    if (list) {
      const sides = new Map(), caps = [];
      for (const b of list) {
        const shape = new THREE.Shape(); shape.moveTo(b[1], -b[2]);
        for (let i = 3; i < b.length; i += 2) shape.lineTo(b[i], -b[i + 1]);
        const hv = (((b[1] * 13 + b[2] * 7) | 0) >>> 0) % 997;
        const [cp, sd] = extrude(shape, 0, b[0]);
        const st = S.mats[styleFor(b[0], '', hv)] ? styleFor(b[0], '', hv) : 'panelWhite';
        if (sd) (sides.get(st) || sides.set(st, []).get(st)).push(tint(sd, hv, plainTint(st))); if (cp) caps.push(cp);
      }
      for (const [st, list2] of sides) g.add(new THREE.Mesh(mergeGeometries(list2), S.mats[st]));
      if (caps.length) g.add(new THREE.Mesh(mergeGeometries(caps), S.roofMat));
      for (const x of [...[...sides.values()].flat(), ...caps]) x.dispose();
    }
    g.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    scene.add(g);
    return g;
  };
  const FARN = 1400, farQuads = new THREE.InstancedMesh(S.farGeo, S.farMat, FARN), fm = new THREE.Matrix4();
  farQuads.frustumCulled = false; farQuads.receiveShadow = true; farQuads.count = 0; scene.add(farQuads);
  const dropFar = (g) => { scene.remove(g); g.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); };

  // ---------- подгрузка плиток вокруг игроков ----------
  let job = null, scanT = 0, focus = { x: ZONES.village.x, z: ZONES.village.z, others: [] };
  const scan = (sync) => {
    const { x, z } = focus;
    const want = new Set(), wantMesh = [];
    tilesNear(x, z, QUALITY.meshR, (ix, iz, dd) => { const k = ckey(ix, iz); want.add(k); wantMesh.push([dd, ix, iz]); });
    for (const o of focus.others || []) tilesNear(o.x, o.z, 130, (ix, iz) => { const k = ckey(ix, iz); if (!want.has(k)) { want.add(k); if (!chunks.has(k)) newChunk(ix, iz); } });
    wantMesh.sort((a, b) => a[0] - b[0]);
    for (const [, ix, iz] of wantMesh) if (!chunks.has(ckey(ix, iz))) newChunk(ix, iz);
    let changed = false;
    for (const c of [...chunks.values()]) {
      if (c === job?.c) continue;
      const dd = rectDist(c.ix, c.iz, x, z);
      const nearOther = (focus.others || []).some((o) => rectDist(c.ix, c.iz, o.x, o.z) < 300);
      if (c.group && dd > QUALITY.meshR + 260) { dropMesh(c); changed = true; }
      if (!c.group && dd > QUALITY.meshR + 260 && !nearOther) dropChunk(c);
    }
    if (changed) world.refresh();
    // дальний план
    let made = 0;
    tilesNear(x, z, QUALITY.view, (ix, iz) => { const k = ckey(ix, iz); if (!far.has(k) && (sync || !index.sky[ix + ',' + iz] || made < 3)) { if (index.sky[ix + ',' + iz]) made++; far.set(k, { g: makeFar(ix, iz), ix, iz }); } });
    let fq = 0;
    for (const [k, f] of far) {
      if (rectDist(f.ix, f.iz, x, z) > QUALITY.view + 700) { dropFar(f.g); far.delete(k); continue; }
      f.g.visible = !chunks.get(k)?.group;
      if (f.g.visible && fq < FARN) farQuads.setMatrixAt(fq++, fm.makeTranslation((f.ix + 0.5) * TILE, -0.05, (f.iz + 0.5) * TILE));
    }
    farQuads.count = fq; farQuads.instanceMatrix.needsUpdate = true;
    world.queue = wantMesh.filter(([, ix, iz]) => { const c = chunks.get(ckey(ix, iz)); return c && !c.group; }).map(([, ix, iz]) => ckey(ix, iz));
  };
  const step = (ms) => {
    const t0 = performance.now();
    for (;;) {
      if (!job) {
        const k = (world.queue || []).find((kk) => { const c = chunks.get(kk); return c && c.d && !c.group; });
        if (k === undefined) return;
        const c = chunks.get(k);
        job = { c, gen: buildMesh(c, world) };
      }
      const r = job.gen.next();
      if (r.done) { const k = job.c.key; job = null; world.queue = world.queue.filter((kk) => kk !== k); scanT = -1; }
      if (performance.now() - t0 >= ms) return;
    }
  };
  // стартовые плитки строим сразу
  scan(true);
  step(1e9);
  world.loading = () => (world.queue || []).length;
  world.update = (t, f) => {
    S.windU.uTime.value = t;
    for (const fl of world.flames) if (fl.light) fl.light.intensity = fl.base * (0.8 + Math.sin(t * 13 + fl.o) * 0.1 + Math.sin(t * 7.3 + fl.o) * 0.1);
    if (f) focus = f;
    if (t - scanT > 0.3 || t < scanT) { scanT = t; scan(false); }
    step(QUALITY.budget);
  };
  world.refresh();
  return world;
}

// ================= Достопримечательности и лагерь (видны всегда) =================
function buildLandmarks(scene, L, rng) {
  const flames = globals.flames, lamps = globals.lamps;
  // ---------- Байтерек ----------
  {
    const white = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.35, metalness: 0.1 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffbb3a, metalness: 0.95, roughness: 0.15, emissive: 0x3a2200, emissiveIntensity: 0.6 });
    const gran = new THREE.MeshStandardMaterial({ map: T.granite_tile.map, roughness: 0.6 });
    const g = new THREE.Group(); scene.add(g);
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(14, 15.5, 1.6, 48), gran); pl.position.y = 0.8; pl.receiveShadow = pl.castShadow = true; g.add(pl);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.6, 76, 24), white); shaft.position.y = 39; shaft.castShadow = true; g.add(shaft);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, tw = 0.35;
      const pts = [[7.5, 1.6], [5.8, 18], [3.8, 42], [4.6, 60], [9.0, 73], [10.8, 79], [9.5, 84]].map(([r, y], k) => new THREE.Vector3(Math.cos(a + k * tw * 0.12) * r, y, Math.sin(a + k * tw * 0.12) * r));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.42, 6), white);
      tube.castShadow = true; g.add(tube);
    }
    const sph = new THREE.Mesh(new THREE.SphereGeometry(11, 48, 32), gold); sph.position.y = 86.5; sph.castShadow = true; g.add(sph);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10.9, 0.25, 6, 64), white); ring.rotation.x = Math.PI / 2; ring.position.y = 86.5; g.add(ring);
    const light = new THREE.PointLight(0xffc060, 40, 60, 1.5); light.position.y = 70; g.add(light);
    addCircle(0, 0, 15.5, 100);
  }
  // ---------- Хан Шатыр ----------
  if (L.khan) {
    const [c, g] = canvas2(512, 512);
    g.fillStyle = '#efe6cc'; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(90,80,60,0.7)'; g.lineWidth = 3;
    for (let i = -512; i < 1024; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 512, 512); g.stroke(); g.beginPath(); g.moveTo(i, 512); g.lineTo(i + 512, 0); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(24, 10);
    const H = 118, R = 95, prof = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; prof.push(new THREE.Vector2(Math.max(0.6, R * Math.pow(1 - t, 1.35)), t * H)); }
    const tent = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.15, transparent: true, opacity: 0.93, side: THREE.DoubleSide }));
    tent.scale.set(1, 1, 0.75); tent.position.set(L.khan.x, 0, L.khan.z); tent.castShadow = true; scene.add(tent);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 40, 10), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.7, roughness: 0.3 }));
    mast.position.set(L.khan.x + 3, H + 15, L.khan.z); mast.rotation.z = -0.18; scene.add(mast);
    const ring = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; ring.push(L.khan.x + Math.cos(a) * (R - 3), L.khan.z + Math.sin(a) * (R - 3) * 0.75); }
    addPoly(ring, 40);
  }
  // ---------- Ак Орда ----------
  if (L.akorda) {
    const { x: ax, z: az } = L.akorda;
    const whiteA = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5 });
    const [c, g] = canvas2(256, 256);
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) { g.fillStyle = '#d9d6cc'; g.fillRect(i * 32 + 10, 0, 12, 256); g.fillStyle = '#4a5560'; g.fillRect(i * 32 + 2, 60, 6, 120); }
    const colTex = new THREE.CanvasTexture(c); colTex.colorSpace = THREE.SRGBColorSpace; colTex.wrapS = colTex.wrapT = THREE.RepeatWrapping;
    const facade = new THREE.MeshStandardMaterial({ map: colTex, roughness: 0.5 });
    const grpA = new THREE.Group(); grpA.position.set(ax, 0, az); scene.add(grpA);
    const addB = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; grpA.add(m); return m; };
    addB(tbox(46, 24, 116, 8), facade, 0, 12, 0);
    addB(tbox(50, 1.2, 120, 4), whiteA, 0, 24.6, 0);
    addB(tbox(30, 10, 40, 6), facade, 0, 30, 0);
    addB(new THREE.CylinderGeometry(13, 13, 9, 40), facade, 0, 39.5, 0);
    addB(new THREE.SphereGeometry(14.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f7fd0, metalness: 0.65, roughness: 0.28 }), 0, 44, 0);
    addB(new THREE.CylinderGeometry(2.2, 2.4, 6, 16), whiteA, 0, 61, 0);
    const goldA = new THREE.MeshStandardMaterial({ color: 0xffbb3a, metalness: 0.95, roughness: 0.15, emissive: 0x3a2200, emissiveIntensity: 0.5 });
    addB(new THREE.ConeGeometry(1.4, 18, 16), goldA, 0, 73, 0);
    addB(new THREE.SphereGeometry(1.2, 16, 12), goldA, 0, 82.5, 0);
    for (let i = 0; i < 10; i++) addB(new THREE.CylinderGeometry(0.9, 0.9, 20, 12), whiteA, -24, 10, -40 + i * 8.9); // колоннада фасада
    addPoly([ax - 25, az - 58, ax + 23, az - 58, ax + 23, az + 58, ax - 25, az + 58], 80);
  }
  // ---------- лагерь выживших у Байтерека ----------
  {
    const V = ZONES.village;
    const block = new THREE.MeshStandardMaterial({ map: T.concrete_floor_worn_001.map, roughness: 0.95, color: 0xc8c6c0 });
    const tarp = [0x4a5a3a, 0x3a4a5a, 0x6a5a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide }));
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      if (Math.abs(Math.sin(a * 2)) < 0.12) continue; // проходы на 4 стороны
      const x = V.x + Math.sin(a) * (V.r + 2), z = V.z + Math.cos(a) * (V.r + 2);
      const m = new THREE.Mesh(tbox(3, 1.1, 0.9, 1.5), block); m.position.set(x, 0.55, z); m.rotation.y = a + Math.PI / 2; m.castShadow = m.receiveShadow = true; scene.add(m);
      addCircle(x, z, 1.1);
      if (i % 5 === 0) { const cr = M.wooden_crate_01.clone(); cr.position.set(x, 1.1, z); cr.rotation.y = a; scene.add(cr); }
    }
    for (const [dx, dz, k] of [[-12, -8, 0], [11, -9, 1], [-13, 9, 2], [12, 10, 0]]) {
      const x = V.x + dx, z = V.z + dz;
      const t = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.6, 4, 1, true), tarp[k]); t.position.set(x, 1.3, z); t.rotation.y = Math.PI / 4 + dx; t.castShadow = true; scene.add(t);
      addCircle(x, z, 2.2);
    }
    const fp = M.stone_fire_pit.clone(); fp.position.set(V.x, 0, V.z); fp.scale.setScalar(1.5); scene.add(fp);
    addCircle(V.x, V.z, 1.0);
    const light = new THREE.PointLight(0xff8a30, 55, 24, 1.5); light.position.set(V.x, 1.5, V.z); scene.add(light);
    flames.push({ meshes: [], light, base: 55, o: 1, x: V.x, y: 0.3, z: V.z, color: 0xff8a30, size: 1.1 });
    for (let i = 0; i < 6; i++) { const a = rng() * 6.28, dd = 5 + rng() * 5; const br = M.wine_barrel_01.clone(); br.position.set(V.x + Math.sin(a) * dd, 0, V.z + Math.cos(a) * dd); scene.add(br); }
    lamps.push(new THREE.Vector3(V.x, 2, V.z));
  }
}
