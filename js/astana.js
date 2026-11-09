// Карта «Астана: Мёртвый город» — левый берег по данным OpenStreetMap (© участники OpenStreetMap, ODbL)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mulberry32 } from './noise.js';
import { spruceGeometry, branchTexture, grassTexture, windSway, tbox, tcyl } from './world.js';
import { ZONES, WATER_LEVEL } from './config.js';

const ENV = 'assets/env/';
const SKY = 'kloofendal_28d_misty_puresky';
const RES = 2, CELL = 50, RIVERBED = -3.4;
export const colliders = []; // круги: деревья, фонари, машины
let city = null, BX = 2000, BZ = 1150, HW = 0, HH = 0;
let hPhys = null, hRiver = null;
const polys = []; // контуры зданий: {p, h, x0, x1, z0, z1, id}
const grid = new Map();
const T = {}, M = {};
let stamp = 0;

// ================= Рельеф и столкновения =================
function sample(arr, x, z) {
  if (!arr) return 0;
  const fx = (x + BX) / RES, fz = (z + BZ) / RES;
  if (fx < 0 || fz < 0 || fx >= HW - 1 || fz >= HH - 1) return 0;
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * HW + ix;
  const a = arr[i], b = arr[i + 1], c = arr[i + HW], d = arr[i + HW + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
export function getHeight(x, z) { return sample(hPhys, x, z); }

const cellKey = (cx, cz) => cx * 100000 + cz;
function gridAdd(item, x0, x1, z0, z1) {
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = cellKey(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(item);
    }
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
  pos.x = Math.max(-BX + 5, Math.min(BX - 5, pos.x));
  pos.z = Math.max(-BZ + 5, Math.min(BZ - 5, pos.z));
}
export function cameraBlocked(x, y, z) {
  let hit = false;
  forNear(x, z, (it) => {
    if (hit) return;
    if (it.r !== undefined) { if (it.tall && (x - it.x) ** 2 + (z - it.z) ** 2 < (it.r + 0.2) ** 2 && y < it.tall) hit = true; return; }
    if (x < it.x0 || x > it.x1 || z < it.z0 || z > it.z1 || y > it.h + 0.3) return;
    if (pip(it.p, x, z)) hit = true;
  });
  return hit;
}
function addPoly(p, h) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  const it = { p, h, x0, x1, z0, z1 };
  polys.push(it); gridAdd(it, x0, x1, z0, z1);
}
function addCircle(x, z, r, tall = 0) {
  const it = { x, z, r, tall };
  colliders.push(it); gridAdd(it, x - r, x + r, z - r, z + r);
}

// ================= Загрузка =================
const TEX = ['leafy_grass', 'worn_asphalt', 'concrete_pavers', 'granite_tile', 'concrete_floor_worn_001', 'bark_brown_02'];
const MODELS = ['wooden_crate_01', 'stone_fire_pit', 'wine_barrel_01'];
export async function loadWorldAssets(renderer, scene, onProgress) {
  const total = TEX.length * 2 + MODELS.length + 2;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  const tl = new THREE.TextureLoader(), gl = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loadTex = async (url, srgb) => { const t = await tl.loadAsync(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; tick(); return t; };
  await Promise.all([
    fetch('assets/astana/city.json').then((r) => r.json()).then((c) => { city = c; tick(); }),
    ...TEX.map(async (n) => { const [map, normal] = await Promise.all([loadTex(`${ENV}tex/${n}_diff.jpg`, true), loadTex(`${ENV}tex/${n}_nor.jpg`, false)]); T[n] = { map, normal }; }),
    ...MODELS.map(async (n) => { const g = await gl.loadAsync(`${ENV}models/${n}/${n}.gltf`); g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); M[n] = g.scene; tick(); }),
    (async () => { const hdr = await new RGBELoader().loadAsync(`${ENV}sky/${SKY}_2k.hdr`); hdr.mapping = THREE.EquirectangularReflectionMapping; scene.background = hdr; scene.environment = hdr; tick(); })(),
  ]);
  [BX, BZ] = city.bounds;
  HW = (BX * 2) / RES; HH = (BZ * 2) / RES;
  hRiver = rasterHeights(false);
  hPhys = rasterHeights(true);
}

function canvas2(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function worldTransform(g) { g.setTransform(1 / RES, 0, 0, 1 / RES, BX / RES, BZ / RES); }
function pathPoly(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); }
function pathLine(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); }
function rasterHeights(bridges) {
  const [, g] = canvas2(HW, HH);
  g.fillStyle = '#000'; g.fillRect(0, 0, HW, HH);
  worldTransform(g);
  g.filter = 'blur(1.5px)'; g.fillStyle = '#fff';
  for (const w of city.water) { pathPoly(g, w.p); g.fill(); }
  g.filter = 'none';
  if (bridges) { g.strokeStyle = '#000'; g.lineCap = 'round'; for (const r of city.roads) if (r.b) { g.lineWidth = r.w + 3; pathLine(g, r.p); g.stroke(); } }
  const d = g.getImageData(0, 0, HW, HH).data, out = new Float32Array(HW * HH);
  for (let i = 0; i < out.length; i++) out[i] = (RIVERBED * d[i * 4]) / 255;
  return out;
}

// ================= Текстуры фасадов (рисуются кодом) =================
function facadeTexture(style, seed) {
  const r = mulberry32(seed);
  const [c, g] = canvas2(512, 512);
  const walls = { glass: '#3c5560', panel0: '#d8d2c4', panel1: '#c9b9a0', panel2: '#e6e2da', low0: '#b9a184', low1: '#cfc3ad' };
  g.fillStyle = walls[style]; g.fillRect(0, 0, 512, 512);
  // грязь и потёки
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,35,30,${r() * 0.08})`; g.fillRect(r() * 512, r() * 512, 4 + r() * 30, 30 + r() * 120); }
  const floors = 4, bays = 4, fh = 512 / floors, bw = 512 / bays;
  for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
    const x = b * bw, y = f * fh;
    if (style === 'glass') {
      const k = 0.5 + r() * 0.3;
      const grd = g.createLinearGradient(x, y, x + bw, y + fh);
      grd.addColorStop(0, `rgb(${70 * k},${110 * k},${125 * k})`); grd.addColorStop(1, `rgb(${30 * k},${55 * k},${68 * k})`);
      g.fillStyle = grd; g.fillRect(x + 3, y + 3, bw - 6, fh - 6);
      if (r() < 0.12) { g.fillStyle = '#0b0d0e'; g.fillRect(x + 3, y + 3, bw - 6, fh - 6); g.strokeStyle = 'rgba(200,220,230,0.5)'; g.beginPath(); for (let k2 = 0; k2 < 5; k2++) { g.moveTo(x + bw / 2, y + fh / 2); g.lineTo(x + r() * bw, y + r() * fh); } g.stroke(); }
      g.fillStyle = '#1d2326'; g.fillRect(x, y, bw, 4); g.fillRect(x, y, 4, fh);
    } else {
      const wx = x + bw * 0.22, wy = y + fh * 0.25, ww = bw * 0.56, wh = fh * 0.5;
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 10);
      const roll = r();
      if (roll < 0.1) { g.fillStyle = '#080808'; g.fillRect(wx, wy, ww, wh); } // выбитое окно
      else if (roll < 0.16) { g.fillStyle = '#6b4f32'; for (let k2 = 0; k2 < 4; k2++) g.fillRect(wx - 2, wy + k2 * (wh / 4) + 2, ww + 4, wh / 4 - 4); } // заколочено
      else { const grd = g.createLinearGradient(wx, wy, wx, wy + wh); grd.addColorStop(0, '#5f7580'); grd.addColorStop(1, '#2a3338'); g.fillStyle = grd; g.fillRect(wx, wy, ww, wh); g.fillStyle = '#ddd'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y + fh - 6, bw, 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.repeat.set(1 / 12, 1 / 12.8); t.offset.set(0, -1 / 12.8);
  return t;
}
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

// ================= Постройка города =================
export function buildWorld(scene) {
  colliders.length = 0; polys.length = 0; grid.clear();
  const rng = mulberry32(77017);
  const flames = [], smokes = [], lamps = [];
  const windU = { uTime: { value: 0 } };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const mat4 = (x, y, z, ry, sx, sy = sx, sz = sx, rx = 0, rz = 0) => { e.set(rx, ry, rz); q.setFromEuler(e); s.set(sx, sy, sz); p.set(x, y, z); return m4.compose(p, q, s); };
  const L = city.landmarks;
  const nearZone = (x, z, pad) => Object.values(ZONES).some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r + pad);

  // ---------- карта поверхности: асфальт / газон / плитка ----------
  const [cR, gR] = canvas2(HW, HH), [cG, gG] = canvas2(HW, HH), [cB, gB] = canvas2(HW, HH);
  for (const g of [gR, gG, gB]) { g.fillStyle = '#000'; g.fillRect(0, 0, HW, HH); worldTransform(g); g.lineCap = g.lineJoin = 'round'; }
  gG.fillStyle = '#fff';
  for (const gr of city.green) if (gr.k !== 'playground') { pathPoly(gG, gr.p); gG.fill(); }
  gR.strokeStyle = gB.strokeStyle = '#fff';
  const FOOT = new Set(['footway', 'cycleway', 'path', 'steps', 'pedestrian']);
  for (const r of city.roads) {
    if (r.tn) continue;
    const g = FOOT.has(r.t) ? gB : gR;
    g.lineWidth = r.w; pathLine(g, r.p); g.stroke();
  }
  // площадки у достопримечательностей
  gB.fillStyle = '#fff';
  gB.beginPath(); gB.arc(0, 0, 60, 0, Math.PI * 2); gB.fill();
  if (L.akorda) { gB.beginPath(); gB.ellipse(L.akorda.x - 150, L.akorda.z, 150, 70, 0, 0, Math.PI * 2); gB.fill(); }
  const dR = gR.getImageData(0, 0, HW, HH).data, dG = gG.getImageData(0, 0, HW, HH).data, dB = gB.getImageData(0, 0, HW, HH).data;
  const sp = new Uint8Array(HW * HH * 4);
  for (let i = 0; i < HW * HH; i++) {
    const r = dR[i * 4], b = dB[i * 4] * (1 - r / 255), gg = dG[i * 4] * (1 - r / 255) * (1 - b / 255);
    sp[i * 4] = r; sp[i * 4 + 1] = gg; sp[i * 4 + 2] = b; sp[i * 4 + 3] = 255;
  }
  const splat = new THREE.DataTexture(sp, HW, HH, THREE.RGBAFormat);
  splat.magFilter = splat.minFilter = THREE.LinearFilter; splat.needsUpdate = true;
  const isGreen = (x, z) => { const ix = ((x + BX) / RES) | 0, iz = ((z + BZ) / RES) | 0; if (ix < 0 || iz < 0 || ix >= HW || iz >= HH) return false; return sp[(iz * HW + ix) * 4 + 1] > 160; };
  const isOpen = (x, z) => { const ix = ((x + BX) / RES) | 0, iz = ((z + BZ) / RES) | 0; if (ix < 0 || iz < 0 || ix >= HW || iz >= HH) return false; const k = (iz * HW + ix) * 4; return sp[k] < 40 && sp[k + 2] < 40; };

  // ---------- земля ----------
  const GW = BX * 2 + 800, GH = BZ * 2 + 800, step = 8;
  const tg = new THREE.PlaneGeometry(GW, GH, Math.round(GW / step), Math.round(GH / step));
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, sample(hRiver, pos.getX(i), pos.getZ(i)));
  tg.computeVertexNormals();
  const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.25, pos.getZ(i) * 0.25);
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.92, map: T.concrete_pavers.map, normalMap: T.concrete_pavers.normal, normalScale: new THREE.Vector2(0.6, 0.6) });
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tSplat: { value: splat }, tAsph: { value: T.worn_asphalt.map }, tPave: { value: T.concrete_pavers.map }, tGrass: { value: T.leafy_grass.map }, tFoot: { value: T.granite_tile.map }, uB: { value: new THREE.Vector2(BX, BZ) } });
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tSplat, tAsph, tPave, tGrass, tFoot; uniform vec2 uB; varying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 suv = (vWPos.xz + uB) / (2.0 * uB);
      vec4 sp = (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) ? vec4(0.0) : texture2D(tSplat, suv);
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
  const ground = new THREE.Mesh(tg, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), new THREE.MeshStandardMaterial({ color: 0x1b2a30, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_LEVEL;
  scene.add(water);

  // ---------- здания ----------
  const mats = {
    glass: new THREE.MeshStandardMaterial({ map: facadeTexture('glass', 1), roughness: 0.18, metalness: 0.55 }),
    panel0: new THREE.MeshStandardMaterial({ map: facadeTexture('panel0', 2), roughness: 0.88 }),
    panel1: new THREE.MeshStandardMaterial({ map: facadeTexture('panel1', 3), roughness: 0.88 }),
    panel2: new THREE.MeshStandardMaterial({ map: facadeTexture('panel2', 4), roughness: 0.88 }),
    low0: new THREE.MeshStandardMaterial({ map: facadeTexture('low0', 5), roughness: 0.9 }),
    low1: new THREE.MeshStandardMaterial({ map: facadeTexture('low1', 6), roughness: 0.9 }),
  };
  const roofTex = T.concrete_floor_worn_001.map.clone(); roofTex.repeat.set(1 / 6, 1 / 6); roofTex.needsUpdate = true;
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95, color: 0x9a9a98 });
  const buckets = new Map([['roof', []], ...Object.keys(mats).map((k) => [k, []])]);
  const tall = [];
  for (const b of city.buildings) {
    const h = Math.max(3, Math.min(130, b.h));
    const shape = new THREE.Shape();
    shape.moveTo(b.p[0], -b.p[1]);
    for (let i = 2; i < b.p.length; i += 2) shape.lineTo(b.p[i], -b.p[i + 1]);
    let geo;
    try { geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); } catch { continue; }
    geo.rotateX(-Math.PI / 2);
    const [caps, sides] = splitExtrude(geo);
    geo.dispose();
    const hv = ((b.p[0] * 13 + b.p[1] * 7) | 0) & 7;
    const style = h >= 45 || ((b.k === 'office' || b.k === 'hotel' || b.k === 'commercial') && h > 20) ? 'glass' : b.k === 'apartments' || b.k === 'residential' || h > 18 ? 'panel' + (hv % 3) : 'low' + (hv % 2);
    if (sides) buckets.get(style).push(sides);
    if (caps) buckets.get('roof').push(caps);
    addPoly(b.p, h);
    if (h > 30) tall.push({ b, h });
  }
  for (const [k, geos] of buckets) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), k === 'roof' ? roofMat : mats[k]);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // горящие здания: столбы чёрного дыма над крышами
  for (let i = 0; i < 14 && tall.length; i++) {
    const { b, h } = tall[Math.floor(rng() * tall.length)];
    let x = 0, z = 0; const n = b.p.length / 2; for (let k = 0; k < b.p.length; k += 2) { x += b.p[k]; z += b.p[k + 1]; }
    x /= n; z /= n;
    smokes.push({ x, y: h + 1, z, dark: 1, size: 3 });
    flames.push({ meshes: [], light: null, o: rng() * 10, x, y: h + 0.3, z, color: 0xff7a20, size: 1.6 });
  }

  // ---------- мосты ----------
  const concrete = new THREE.MeshStandardMaterial({ map: T.concrete_floor_worn_001.map, roughness: 0.9, color: 0xb8b6b0 });
  const deck = [];
  for (const r of city.roads) {
    if (!r.b) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const ang = Math.atan2(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const d = tbox(r.w, 0.8, len + 0.6, 4); d.rotateY(ang); d.translate(cx, -0.38, cz); deck.push(d.toNonIndexed());
      for (const side of [-1, 1]) {
        const rl = tbox(0.3, 1.0, len + 0.6, 2); rl.translate(side * (r.w / 2 - 0.15), 0.5, 0); rl.rotateY(ang); rl.translate(cx, 0, cz); deck.push(rl.toNonIndexed());
      }
    }
  }
  if (deck.length) { const dm = new THREE.Mesh(mergeGeometries(deck), concrete); dm.castShadow = dm.receiveShadow = true; scene.add(dm); }

  // ---------- деревья в парках и по OSM ----------
  const barkMat = new THREE.MeshStandardMaterial({ map: T.bark_brown_02.map, normalMap: T.bark_brown_02.normal, roughness: 0.95 });
  const variants = [11, 23, 37].map((sd) => {
    const g = spruceGeometry(sd);
    const leafMat = new THREE.MeshStandardMaterial({ map: branchTexture(sd * 7), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
    windSway(leafMat, windU, 0.04);
    const N = 600, tr = new THREE.InstancedMesh(g.trunk, barkMat, N), lf = new THREE.InstancedMesh(g.foliage, leafMat, N);
    tr.castShadow = lf.castShadow = true; tr.receiveShadow = lf.receiveShadow = true;
    scene.add(tr, lf);
    return { tr, lf, n: 0, N };
  });
  const leafCol = new THREE.Color();
  const plantTree = (x, z) => {
    if (nearZone(x, z, 4) || Math.hypot(x, z) < 20) return;
    const v = variants[Math.floor(rng() * 3)];
    if (v.n >= v.N) return;
    const sc = 0.55 + rng() * 0.45, h = getHeight(x, z);
    if (h < -0.5) return;
    mat4(x, h - 0.2, z, rng() * 6.28, sc, sc * (0.9 + rng() * 0.25));
    v.tr.setMatrixAt(v.n, m4); v.lf.setMatrixAt(v.n, m4);
    v.lf.setColorAt(v.n, leafCol.setHSL(0.26 + rng() * 0.06, 0.25 + rng() * 0.2, 0.36 + rng() * 0.16));
    v.n++;
    addCircle(x, z, 0.4 * sc);
  };
  for (let i = 0; i < city.trees.length; i += 2) plantTree(city.trees[i], city.trees[i + 1]);
  for (let tries = 0, k = 0; k < 1500 && tries < 60000; tries++) {
    const x = (rng() - 0.5) * BX * 2, z = (rng() - 0.5) * BZ * 2;
    if (isGreen(x, z) && rng() < 0.6) { plantTree(x, z); k++; }
  }
  for (const v of variants) { v.tr.count = v.lf.count = v.n; v.tr.computeBoundingSphere(); v.lf.computeBoundingSphere(); }

  // трава на газонах
  const cards = [0, 1, 2].map((k) => { const pl = new THREE.PlaneGeometry(1.1, 0.7); pl.translate(0, 0.35, 0); pl.rotateY((k * Math.PI) / 3); return pl.toNonIndexed(); });
  const tuft = mergeGeometries(cards);
  const tn = tuft.attributes.normal; for (let i = 0; i < tn.count; i++) tn.setXYZ(i, 0, 1, 0);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  windSway(grassMat, windU, 0.18);
  const GN = 30000, grass = new THREE.InstancedMesh(tuft, grassMat, GN), gc = new THREE.Color();
  let gn = 0;
  for (let tries = 0; gn < GN && tries < GN * 12; tries++) {
    const x = (rng() - 0.5) * BX * 2, z = (rng() - 0.5) * BZ * 2;
    if (!isGreen(x, z)) continue;
    const sc = 0.6 + rng() * 0.8;
    grass.setMatrixAt(gn, mat4(x, getHeight(x, z) - 0.05, z, rng() * 6.28, sc, sc * (0.7 + rng() * 0.6), sc));
    grass.setColorAt(gn++, gc.setHSL(0.15 + rng() * 0.06, 0.3, 0.7 + rng() * 0.2));
  }
  grass.count = gn; grass.receiveShadow = true; scene.add(grass);

  // ---------- фонари вдоль больших улиц ----------
  const poleGeo = mergeGeometries([tcyl(0.09, 0.14, 8, 6, 2).translate(0, 4, 0).toNonIndexed(), tbox(1.6, 0.1, 0.12, 1).translate(0.75, 7.9, 0).toNonIndexed(), tbox(0.6, 0.15, 0.3, 1).translate(1.45, 7.8, 0).toNonIndexed()]);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3b3e40, metalness: 0.6, roughness: 0.5 });
  const lampPos = [];
  for (const r of city.roads) {
    if (!['primary', 'secondary', 'tertiary'].includes(r.t) || r.b || r.tn) continue;
    let acc = rng() * 40;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let d = acc; d < len; d += 42) {
        const side = lampPos.length % 2 ? 1 : -1, off = r.w / 2 + 1.2;
        const x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
        if (Math.abs(x) < BX && Math.abs(z) < BZ) lampPos.push([x, z, Math.atan2(uz * side, -ux * side) + Math.PI / 2]);
      }
      acc = ((acc - len) % 42 + 42) % 42;
    }
  }
  const lampsIM = new THREE.InstancedMesh(poleGeo, lampMat, lampPos.length);
  lampPos.forEach(([x, z, ry], i) => { lampsIM.setMatrixAt(i, mat4(x, getHeight(x, z), z, ry, 1)); addCircle(x, z, 0.25); });
  lampsIM.castShadow = true; scene.add(lampsIM);

  // ---------- брошенные машины ----------
  const carBodyGeo = mergeGeometries([tbox(1.85, 0.75, 4.4, 2).translate(0, 0.62, 0).toNonIndexed(), tbox(1.65, 0.62, 2.3, 2).translate(0, 1.3, -0.25).toNonIndexed()]);
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12).rotateZ(Math.PI / 2);
  const carDarkGeo = mergeGeometries([
    ...[[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]].map(([x, z]) => wheel.clone().translate(x, 0.34, z).toNonIndexed()),
    tbox(1.68, 0.42, 2.0, 1).translate(0, 1.34, -0.25).toNonIndexed(),
  ]);
  const carMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.4, metalness: 0.3 });
  const NC = 420, carIM = new THREE.InstancedMesh(carBodyGeo, carMat, NC), darkIM = new THREE.InstancedMesh(carDarkGeo, darkMat, NC);
  const carCols = [0x4a4f54, 0x6b6e70, 0x7a3a2c, 0x2c3a4a, 0x8a8478, 0x3a3a36, 0x5a4a3a, 0xa8a8a2].map((h) => new THREE.Color(h));
  let nc = 0;
  const majors = city.roads.filter((r) => ['primary', 'secondary', 'tertiary', 'residential', 'service'].includes(r.t) && !r.tn);
  for (let tries = 0; nc < NC && tries < 6000; tries++) {
    const r = majors[Math.floor(rng() * majors.length)];
    const i = Math.floor(rng() * (r.p.length / 2 - 1)) * 2;
    const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], len = Math.hypot(bx - ax, bz - az);
    if (len < 6) continue;
    const t = rng(), lat = (rng() - 0.5) * Math.max(0, r.w - 2.5);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const x = ax + (bx - ax) * t - uz * lat, z = az + (bz - az) * t + ux * lat;
    if (Math.abs(x) > BX - 10 || Math.abs(z) > BZ - 10 || nearZone(x, z, -8) || Math.hypot(x, z) < 30) continue;
    if (r.b && rng() < 0.6) continue;
    const ry = Math.atan2(ux, uz) + (rng() - 0.5) * 0.9 + (rng() < 0.5 ? Math.PI : 0);
    const y = getHeight(x, z), burnt = rng() < 0.12;
    const flip = rng() < 0.05;
    mat4(x, y + (flip ? 1.75 : 0), z, ry, 1, 1, 1, 0, flip ? Math.PI : 0);
    carIM.setMatrixAt(nc, m4); darkIM.setMatrixAt(nc, m4);
    carIM.setColorAt(nc, burnt ? new THREE.Color(0x1e1a17) : carCols[Math.floor(rng() * carCols.length)]);
    nc++;
    addCircle(x + Math.sin(ry) * 1.2, z + Math.cos(ry) * 1.2, 1.05); addCircle(x - Math.sin(ry) * 1.2, z - Math.cos(ry) * 1.2, 1.05);
    if (burnt) { flames.push({ meshes: [], light: null, o: rng() * 10, x, y: y + 1.2, z, color: 0xff8a30, size: 0.8 }); smokes.push({ x, y: y + 2, z, dark: 1, size: 1.4 }); }
  }
  carIM.count = darkIM.count = nc; carIM.castShadow = darkIM.castShadow = true;
  scene.add(carIM, darkIM);

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
    const main = tbox(46, 24, 116, 8); addB(main, facade, 0, 12, 0);
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
    for (let i = 0; i < 6; i++) { const a = rng() * 6.28, d = 5 + rng() * 5; const br = M.wine_barrel_01.clone(); br.position.set(V.x + Math.sin(a) * d, 0, V.z + Math.cos(a) * d); scene.add(br); }
    lamps.push(new THREE.Vector3(V.x, 2, V.z));
  }

  return {
    flames, smokes, lamps,
    update(t) {
      windU.uTime.value = t;
      for (const f of flames) if (f.light) f.light.intensity = f.base * (0.8 + Math.sin(t * 13 + f.o) * 0.1 + Math.sin(t * 7.3 + f.o) * 0.1);
    },
  };
}
