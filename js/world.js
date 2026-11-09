// Реалистичный мир «суровый север»: рельеф с фототекстурами, ели, нордическая деревня, руины, арена
// Текстуры, модели и небо: Poly Haven (CC0)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { fbm, mulberry32 } from './noise.js';
import { buildings, buildTower } from './buildings.js';
import { ZONES, WORLD_SIZE, WATER_LEVEL } from './config.js';

export const SKY = 'kloofendal_48d_partly_cloudy_puresky'; // или 'kloofendal_28d_misty_puresky' — туманнее
const ENV = 'assets/env/';
export const colliders = [];
const zoneList = Object.values(ZONES);
const paths = zoneList.filter((z) => z !== ZONES.village).map((z) => [ZONES.village.x, ZONES.village.z, z.x, z.z]);

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function pathDist(x, z) {
  let m = Infinity;
  for (const p of paths) m = Math.min(m, segDist(x, z, p[0], p[1], p[2], p[3]));
  return m;
}
const sstep = (t) => t * t * (3 - 2 * t);
const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

export function getHeight(x, z) {
  let h = (fbm(x * 0.016 + 3.1, z * 0.016 - 7.7, 4) - 0.5) * 26 + (fbm(x * 0.07, z * 0.07, 2) - 0.5) * 2.5;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 84) { const e = edge - 84; h += e * 1.5 + e * fbm(x * 0.05 + 40, z * 0.05, 3) * 1.6; } // заснеженные горы по краям
  const pd = pathDist(x, z);
  if (pd < 6) { const s = sstep(pd / 6); h = h * s + Math.max(h * 0.35, WATER_LEVEL + 1.2) * (1 - s); }
  for (const zn of zoneList) {
    const d = Math.hypot(x - zn.x, z - zn.z), band = 10;
    if (d < zn.r + band) { const s = sstep(d <= zn.r ? 0 : (d - zn.r) / band); h = 0.4 * (1 - s) + h * s; }
  }
  return h;
}

export function resolveCollision(pos, radius) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = pos.x - c.x, dz = pos.z - c.z, rr = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), k = (rr - d) / d; pos.x += dx * k; pos.z += dz * k; }
  }
  const B = 112;
  pos.x = Math.max(-B, Math.min(B, pos.x));
  pos.z = Math.max(-B, Math.min(B, pos.z));
}

// ================= Загрузка ресурсов =================
const TEX_NAMES = ['leafy_grass', 'forrest_ground_01', 'rocky_trail', 'rocky_terrain_02', 'snow_02', 'bark_brown_02', 'rustic_stone_wall_02', 'weathered_planks', 'thatch_roof_angled', 'dark_wooden_planks', 'mossy_stone_wall', 'castle_wall_slates'];
const MODEL_NAMES = ['fern_02', 'shrub_03', 'rock_07', 'rock_09', 'rock_moss_set_01', 'tree_stump_01', 'dead_tree_trunk', 'stone_fire_pit', 'wine_barrel_01', 'wooden_crate_01', 'wooden_bucket_01', 'wooden_lantern_01', 'nettle_plant', 'kite_shield'];
const T = {}; // name -> {map, normal}
const M = {}; // name -> gltf scene

export async function loadWorldAssets(renderer, scene, onProgress) {
  const total = TEX_NAMES.length * 2 + MODEL_NAMES.length + 1;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  const tl = new THREE.TextureLoader(), gl = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loadTex = async (url, srgb) => {
    const t = await tl.loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    tick();
    return t;
  };
  await Promise.all([
    ...TEX_NAMES.map(async (n) => {
      const [map, normal] = await Promise.all([loadTex(`${ENV}tex/${n}_diff.jpg`, true), loadTex(`${ENV}tex/${n}_nor.jpg`, false)]);
      T[n] = { map, normal };
    }),
    ...MODEL_NAMES.map(async (n) => {
      const g = await gl.loadAsync(`${ENV}models/${n}/${n}.gltf`);
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = aniso; } });
      M[n] = g.scene;
      tick();
    }),
    (async () => {
      const hdr = await new RGBELoader().loadAsync(`${ENV}sky/${SKY}_2k.hdr`);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = hdr;
      scene.environment = hdr;
      tick();
    })(),
  ]);
}

// Материал с фототекстурой; tile — сколько метров занимает одна текстура
function pbr(name, extra = {}) {
  return new THREE.MeshStandardMaterial({ map: T[name].map, normalMap: T[name].normal, roughness: 0.92, metalness: 0, ...extra });
}
// Коробка с UV в метрах, чтобы текстура не растягивалась
function tbox(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile); }
  return g;
}
function tcyl(rt, rb, h, seg, tile = 2) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  const uv = g.attributes.uv, circ = Math.PI * 2 * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
  return g;
}

// Геометрия из glTF-модели одним куском на материал (для инстансинга)
function modelParts(name) {
  const parts = new Map();
  M[name].traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) return;
    const arr = parts.get(o.material) || [];
    arr.push(g); parts.set(o.material, arr);
  });
  return [...parts].map(([mat, geos]) => {
    if (geos.length === 1) return { mat, geo: geos[0] };
    const allIndexed = geos.every((g) => g.index);
    return { mat, geo: mergeGeometries(allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g))) };
  });
}
function instanced(scene, name, count, opts = {}) {
  const meshes = modelParts(name).map(({ mat, geo }) => {
    const m = new THREE.InstancedMesh(geo, opts.mat ? opts.mat(mat) : mat, count);
    m.castShadow = opts.shadow !== false; m.receiveShadow = true;
    scene.add(m);
    return m;
  });
  let n = 0;
  return {
    add(matrix) { if (n >= count) return; for (const m of meshes) m.setMatrixAt(n, matrix); n++; },
    finish() { for (const m of meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } },
  };
}
function placeModel(scene, name, x, y, z, ry = 0, s = 1) {
  const o = M[name].clone();
  o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
  scene.add(o);
  return o;
}

// ================= Текстуры веток и травы, нарисованные кодом =================
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function branchTexture(seed) {
  const r = mulberry32(seed);
  return canvasTex(256, 512, (g, w, h) => {
    const twig = (x0, y0, ang, len, depth) => {
      const x1 = x0 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len;
      g.strokeStyle = '#3b2a1c'; g.lineWidth = depth === 0 ? 4 : 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      // хвоя
      const n = Math.floor(len / 2.2);
      for (let i = 0; i < n; i++) {
        const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) {
          const na = ang + side * (0.9 + r() * 0.4) + (r() - 0.5) * 0.2, nl = (14 + r() * 10) * (1 - t * 0.5) * (depth ? 0.75 : 1);
          const l = 22 + r() * 22;
          g.strokeStyle = `hsl(${105 + r() * 25}, ${30 + r() * 20}%, ${l * (0.6 + t * 0.5)}%)`;
          g.lineWidth = 1.6 + r();
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(na) * nl, py - Math.cos(na) * nl); g.stroke();
        }
      }
      if (depth < 1) for (let i = 1; i < 7; i++) {
        const t = 0.12 + i * 0.12, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        const side = i % 2 ? 1 : -1;
        twig(px, py, ang + side * (0.7 + r() * 0.3), len * (0.42 - t * 0.25), depth + 1);
      }
    };
    twig(w / 2, h - 4, 0, h - 30, 0);
  });
}
function grassTexture() {
  const r = mulberry32(77);
  return canvasTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 70; i++) {
      const x = 10 + r() * (w - 20), bh = h * (0.45 + r() * 0.5), lean = (r() - 0.5) * 50, bw = 3 + r() * 4;
      const grd = g.createLinearGradient(0, h, 0, h - bh);
      const hue = 70 + r() * 30, sat = 25 + r() * 25;
      grd.addColorStop(0, `hsl(${hue}, ${sat}%, 24%)`); grd.addColorStop(0.5, `hsl(${hue}, ${sat + 5}%, 40%)`); grd.addColorStop(1, `hsl(${hue - 15 + r() * 10}, ${sat}%, ${55 + r() * 15}%)`);
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(x - bw, h); g.quadraticCurveTo(x + lean * 0.3, h - bh * 0.6, x + lean, h - bh); g.quadraticCurveTo(x + lean * 0.3 + 1, h - bh * 0.6, x + bw, h); g.fill();
    }
  });
}

// Ель: ствол с корой + ярусы веток-карточек
function spruceGeometry(seed) {
  const r = mulberry32(seed);
  const H = 9 + r() * 3, R = 2.6 + r() * 0.6, levels = 14;
  const trunk = tcyl(0.07, 0.32, H, 7, 1.5); trunk.translate(0, H / 2, 0);
  const cards = [];
  for (let L = 0; L < levels; L++) {
    const t = L / levels, y = 1.4 + t * (H - 1.8), rad = R * Math.pow(1 - t, 0.85) + 0.35, n = Math.max(4, Math.round(8 - t * 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + L * 0.9 + r() * 0.4;
      const len = rad * (0.85 + r() * 0.3), wid = len * 0.55 + 0.3;
      const p = new THREE.PlaneGeometry(wid, len);
      p.translate(0, len / 2, 0);                 // основание у ствола
      p.rotateY((r() - 0.5) * 0.8);               // поворот вокруг оси ветки — объём
      p.rotateX(Math.PI / 2 - 0.15 - t * 0.25 - r() * 0.25); // наклон вниз
      p.rotateY(a);
      p.translate(0, y, 0);
      cards.push(p);
    }
  }
  const top = new THREE.PlaneGeometry(0.9, 1.6); top.translate(0, H - 0.6, 0);
  cards.push(top, top.clone().rotateY(Math.PI / 2).translate(0, 0, 0));
  const foliage = mergeGeometries(cards.map((g) => g.toNonIndexed()));
  // нормали «от центра кроны» — мягкое освещение как у настоящей хвои
  const pos = foliage.attributes.position, nor = foliage.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i), (pos.getY(i) - H * 0.4) * 0.5, pos.getZ(i)).normalize(); v.y = Math.max(v.y, 0) + 0.35; v.normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
  return { trunk, foliage, H };
}

// ================= Постройка мира =================
export function buildWorld(scene) {
  colliders.length = 0;
  const rng = mulberry32(20261109);
  const flames = [], smokes = [], lamps = [];
  const windU = { uTime: { value: 0 } };
  const gh = getHeight;
  const add = (geo, mat, x, y, z, ry = 0, collide = 0, parent = scene) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    if (collide) colliders.push({ x, z, r: collide });
    return m;
  };
  const inZone = (x, z, pad = 0) => zoneList.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r + pad);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const mat4 = (x, y, z, ry, sx, sy = sx, sz = sx, rx = 0, rz = 0) => { e.set(rx, ry, rz); q.setFromEuler(e); s.set(sx, sy, sz); p.set(x, y, z); return m4.compose(p, q, s); };

  // ================= Рельеф со смешиванием текстур =================
  const seg = 200;
  const tg = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = gh(x, z);
    pos.setY(i, h);
    let grass = 1, forest = 0, dirt = 0, rock = 0;
    const fd = Math.hypot(x - ZONES.forest.x, z - ZONES.forest.z);
    forest = Math.min(1, Math.max(0, (fbm(x * 0.03 + 5, z * 0.03, 3) - 0.48) * 4) + Math.max(0, 1 - fd / 40));
    const pd = pathDist(x, z);
    if (pd < 2.8) dirt = Math.max(dirt, 1 - pd / 2.8);
    for (const zn of zoneList) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d < zn.r + 2) {
        const k = Math.min(1, 1.2 * (1 - d / (zn.r + 2)));
        if (zn === ZONES.ruins || zn === ZONES.arena) rock = Math.max(rock, k * 0.75);
        else if (zn !== ZONES.forest) dirt = Math.max(dirt, k * 0.7);
      }
    }
    if (h < WATER_LEVEL + 0.6) dirt = Math.max(dirt, 0.8);
    grass *= 1 - forest * 0.85;
    splat.set([grass, forest, dirt, rock], i * 4);
  }
  tg.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  tg.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, map: T.leafy_grass.map, normalMap: T.leafy_grass.normal });
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGrass: { value: T.leafy_grass.map }, tForest: { value: T.forrest_ground_01.map }, tDirt: { value: T.rocky_trail.map },
      tRock: { value: T.rocky_terrain_02.map }, tSnow: { value: T.snow_02.map }, nRock: { value: T.rocky_terrain_02.normal },
    });
    sh.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vSplat = splat; vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = 'uniform sampler2D tGrass, tForest, tDirt, tRock, tSnow, nRock;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nfloat gRock; float gSnow;\n' +
      sh.fragmentShader
        .replace('#include <map_fragment>', `
          vec2 uvA = vWPos.xz * 0.28, uvB = vWPos.xz * 0.037;
          float macro = texture2D(tForest, uvB).g * 1.4 + 0.3;
          vec3 cg = texture2D(tGrass, uvA).rgb * mix(0.75, 1.15, macro) * mix(vec3(1.0), texture2D(tGrass, uvA * 0.13).rgb * 1.8, 0.35);
          vec3 cf = texture2D(tForest, uvA * 0.8).rgb * vec3(0.62, 0.66, 0.52);
          vec3 cd = texture2D(tDirt, uvA * 0.7).rgb * vec3(0.85, 0.82, 0.78);
          vec3 an = abs(vWNorm); an /= (an.x + an.y + an.z);
          vec3 cr = texture2D(tRock, vWPos.zy * 0.12).rgb * an.x + texture2D(tRock, vWPos.xz * 0.12).rgb * an.y + texture2D(tRock, vWPos.xy * 0.12).rgb * an.z;
          vec3 cs = texture2D(tSnow, uvA * 0.5).rgb;
          float wsum = max(vSplat.x + vSplat.y + vSplat.z, 0.0001);
          vec3 col = (cg * vSplat.x + cf * vSplat.y + cd * vSplat.z) / wsum;
          float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
          float n1 = texture2D(tRock, vWPos.xz * 0.02).r;
          gRock = clamp(max((slope - 0.32 + n1 * 0.15) * 6.0, vSplat.w * 1.3), 0.0, 1.0);
          gRock = max(gRock, clamp((vWPos.y - 11.0) / 4.0, 0.0, 1.0) * 0.8);
          col = mix(col, cr, gRock);
          gSnow = clamp((vWPos.y - 15.0 + n1 * 5.0) / 3.0, 0.0, 1.0) * clamp(1.4 - slope * 1.6, 0.0, 1.0);
          col = mix(col, cs * 1.1, gSnow);
          diffuseColor.rgb *= col;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec3 rn = texture2D(nRock, vWPos.xz * 0.12).xyz * 2.0 - 1.0; normal = normalize(mix(normal, normalize(normal + vec3(rn.x, 0.0, rn.y) * 0.6), gRock)); }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.75, gSnow);`);
  };
  // нормаль-карту применяем с UV в метрах
  const uv = tg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.28, pos.getZ(i) * 0.28);
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // вода
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3), new THREE.MeshStandardMaterial({ color: 0x1d3442, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.88, normalMap: T.snow_02.normal, normalScale: new THREE.Vector2(0.15, 0.15) }));
  water.material.normalMap = T.snow_02.normal.clone(); water.material.normalMap.repeat.set(60, 60); water.material.normalMap.wrapS = water.material.normalMap.wrapT = THREE.RepeatWrapping;
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_LEVEL;
  scene.add(water);

  // ================= Ели =================
  const barkMat = pbr('bark_brown_02');
  const variants = [11, 23, 37].map((sd) => {
    const g = spruceGeometry(sd);
    const leafMat = new THREE.MeshStandardMaterial({ map: branchTexture(sd * 7), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
    windSway(leafMat, windU, 0.04);
    const N = 170;
    const tr = new THREE.InstancedMesh(g.trunk, barkMat, N), lf = new THREE.InstancedMesh(g.foliage, leafMat, N);
    tr.castShadow = lf.castShadow = true; tr.receiveShadow = lf.receiveShadow = true;
    scene.add(tr, lf);
    return { tr, lf, n: 0, N };
  });
  const leafCol = new THREE.Color();
  for (let tries = 0, placed = 0; placed < 480 && tries < 12000; tries++) {
    const x = (rng() - 0.5) * 220, z = (rng() - 0.5) * 220, h = gh(x, z);
    if (h < WATER_LEVEL + 0.8 || h > 16 || inZone(x, z, 3) || pathDist(x, z) < 4) continue;
    const fd = Math.hypot(x - ZONES.forest.x, z - ZONES.forest.z), dens = fbm(x * 0.03 + 5, z * 0.03, 3);
    if (fd > 40 && rng() > (dens - 0.35) * 2.2) continue;
    const v = variants[Math.floor(rng() * 3)];
    if (v.n >= v.N) continue;
    const sc = 0.7 + rng() * 0.6, ry = rng() * 6.28;
    mat4(x, h - 0.2, z, ry, sc, sc * (0.9 + rng() * 0.25));
    v.tr.setMatrixAt(v.n, m4); v.lf.setMatrixAt(v.n, m4);
    v.lf.setColorAt(v.n, leafCol.setHSL(0.27 + rng() * 0.05, 0.25 + rng() * 0.2, 0.42 + rng() * 0.18));
    v.n++; placed++;
    colliders.push({ x, z, r: 0.4 * sc });
  }
  for (const v of variants) { v.tr.count = v.lf.count = v.n; v.tr.computeBoundingSphere(); v.lf.computeBoundingSphere(); }

  // ================= Трава-карточки с ветром =================
  const gtex = grassTexture();
  const cards = [0, 1, 2].map((k) => { const pl = new THREE.PlaneGeometry(1.1, 0.75); pl.translate(0, 0.37, 0); pl.rotateY((k * Math.PI) / 3); return pl.toNonIndexed(); });
  const tuft = mergeGeometries(cards);
  const tn = tuft.attributes.normal; for (let i = 0; i < tn.count; i++) tn.setXYZ(i, 0, 1, 0);
  const grassMat = new THREE.MeshStandardMaterial({ map: gtex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  windSway(grassMat, windU, 0.18);
  const GN = 26000;
  const grass = new THREE.InstancedMesh(tuft, grassMat, GN);
  const gc = new THREE.Color();
  let gn = 0;
  for (let tries = 0; gn < GN && tries < GN * 4; tries++) {
    const x = (rng() - 0.5) * 200, z = (rng() - 0.5) * 200, h = gh(x, z);
    if (h < WATER_LEVEL + 0.8 || h > 10.5 || pathDist(x, z) < 2.2) continue;
    if (zoneList.some((zz) => zz !== ZONES.forest && Math.hypot(x - zz.x, z - zz.z) < zz.r * 0.8) && rng() < 0.92) continue;
    const dens = fbm(x * 0.05 + 11, z * 0.05 - 4, 2);
    if (rng() > dens * 1.7) continue;
    const sc = 0.6 + rng() * 0.7;
    grass.setMatrixAt(gn, mat4(x, h - 0.05, z, rng() * 6.28, sc, sc * (0.6 + dens * 0.7), sc));
    grass.setColorAt(gn++, gc.setHSL(0.17 + rng() * 0.06, 0.3, 0.78 + rng() * 0.18));
  }
  grass.count = gn; grass.receiveShadow = true;
  scene.add(grass);

  // ================= Папоротники, кусты, крапива, камни, пни =================
  const scatter = (name, count, test, scale, opts) => {
    const inst = instanced(scene, name, count, opts);
    for (let tries = 0, k = 0; k < count && tries < count * 40; tries++) {
      const x = (rng() - 0.5) * 210, z = (rng() - 0.5) * 210, h = gh(x, z);
      if (!test(x, z, h)) continue;
      const sc = scale[0] + rng() * (scale[1] - scale[0]);
      inst.add(mat4(x, h - 0.05, z, rng() * 6.28, sc));
      k++;
      opts?.collide && colliders.push({ x, z, r: opts.collide * sc });
    }
    inst.finish();
  };
  const okGround = (x, z, h) => h > WATER_LEVEL + 0.8 && h < 12 && !inZone(x, z, 1) && pathDist(x, z) > 2.5;
  const foresty = (x, z) => fbm(x * 0.03 + 5, z * 0.03, 3) > 0.47 || Math.hypot(x - ZONES.forest.x, z - ZONES.forest.z) < 40;
  const foliageMat = (m) => { const c = m.clone(); windSway(c, windU, 0.05); return c; };
  scatter('fern_02', 420, (x, z, h) => okGround(x, z, h) && foresty(x, z), [0.8, 1.4], { mat: foliageMat, shadow: false });
  scatter('shrub_03', 140, okGround, [0.7, 1.2], { mat: foliageMat });
  scatter('nettle_plant', 90, (x, z, h) => okGround(x, z, h) && !foresty(x, z), [0.8, 1.2], { mat: foliageMat, shadow: false });
  scatter('rock_07', 45, (x, z, h) => !inZone(x, z, 1) && pathDist(x, z) > 3, [0.6, 2.2], { collide: 0.9 });
  scatter('rock_09', 45, (x, z, h) => !inZone(x, z, 1) && pathDist(x, z) > 3, [0.6, 2.0], { collide: 0.8 });
  scatter('rock_moss_set_01', 30, (x, z, h) => okGround(x, z, h) && foresty(x, z), [0.8, 1.5]);
  scatter('tree_stump_01', 30, (x, z, h) => okGround(x, z, h) && foresty(x, z), [0.8, 1.2], { collide: 0.4 });

  // ================= Огонь =================
  function fire(x, y, z, size, color = 0xff8a30, lightPower = 40) {
    let light = null;
    if (lightPower) { light = new THREE.PointLight(color, lightPower, 24, 1.5); light.position.set(x, y + 1.0, z); light.castShadow = false; scene.add(light); }
    flames.push({ meshes: [], light, base: lightPower, o: rng() * 10, x, y, z, color, size });
  }
  function torch(x, z, color = 0xff8a30) {
    const y = gh(x, z);
    add(tcyl(0.05, 0.07, 1.9, 6, 1), barkMat, x, y + 0.95, z);
    add(new THREE.CylinderGeometry(0.13, 0.08, 0.22, 7), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.5 }), x, y + 1.95, z);
    fire(x, y + 2.08, z, 0.35, color, 0);
  }

  // ================= Деревня в нордическом стиле =================
  const V = ZONES.village;
  const stoneMat = pbr('rustic_stone_wall_02'), plankMat = pbr('weathered_planks'), thatchMat = pbr('thatch_roof_angled', { roughness: 1 }), beamMat = pbr('dark_wooden_planks');
  placeModel(scene, 'stone_fire_pit', V.x, gh(V.x, V.z), V.z, 0, 1.6);
  colliders.push({ x: V.x, z: V.z, r: 1.0 });
  fire(V.x, gh(V.x, V.z) + 0.25, V.z, 1.1, 0xff8a30, 55);
  for (let i = 0; i < 3; i++) { // брёвна-скамейки
    const a = i * 2.1 + 0.4, x = V.x + Math.sin(a) * 2.8, z = V.z + Math.cos(a) * 2.8;
    const m = add(tcyl(0.25, 0.27, 1.9, 9, 1.2), barkMat, x, gh(x, z) + 0.25, z, a + Math.PI / 2); m.rotation.z = Math.PI / 2;
  }
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffc87a, emissive: 0xff9a40, emissiveIntensity: 1.4, roughness: 0.4 });
  // ===== Четырёхэтажные дома, в которые можно зайти =====
  buildings.length = 0;
  const towerMats = { stone: stoneMat, plank: plankMat, beam: beamMat, thatch: thatchMat, bark: barkMat, floor: beamMat };
  const furnish = (g, L, W, D, floors) => {
    for (let k = 0; k < floors; k++) {
      const y = L(k);
      // стол с лавками
      const tx = 2.6, tz = 1.2;
      add(tbox(2.0, 0.08, 0.9, 1), beamMat, tx, y + 0.78, tz, 0, 0, g);
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.35, 0.35]) add(tbox(0.08, 0.76, 0.08, 1), beamMat, tx + sx, y + 0.38, tz + sz, 0, 0, g);
      for (const sz of [-0.8, 0.8]) add(tbox(1.8, 0.45, 0.3, 1), plankMat, tx, y + 0.22, tz + sz, 0, 0, g);
      const lan = M.wooden_lantern_01.clone(); lan.position.set(tx, y + 0.82, tz); g.add(lan);
      lan.traverse((o) => { if (o.isMesh && o.material.name.includes('glass')) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffa040); o.material.emissiveIntensity = 3; } });
      // бочки и ящики у стены
      const br = M.wine_barrel_01.clone(); br.position.set(-W / 2 + 0.8, y, D / 2 - 0.9); g.add(br);
      const cr = M.wooden_crate_01.clone(); cr.position.set(-W / 2 + 0.8, y, D / 2 - 1.9); cr.rotation.y = 0.4; g.add(cr);
      // кровать на верхних этажах, очаг на первом
      if (k > 0) {
        add(tbox(1.0, 0.35, 2.0, 1), beamMat, -W / 2 + 1.0, y + 0.18, -2.3, 0, 0, g);
        add(tbox(0.95, 0.12, 1.9, 1), new THREE.MeshStandardMaterial({ color: k % 2 ? 0x7a3a2a : 0x3a4a6a, roughness: 1 }), -W / 2 + 1.0, y + 0.42, -2.3, 0, 0, g);
      } else {
        const fp = M.stone_fire_pit.clone(); fp.position.set(-2.8, y, 1.6); fp.scale.setScalar(1.1); g.add(fp);
        const wp = new THREE.Vector3(-2.8, y + 0.2, 1.6).applyEuler(new THREE.Euler(0, g.rotation.y, 0)).add(g.position);
        fire(wp.x, wp.y, wp.z, 0.6, 0xff8a30, 0);
      }
      const sh = M.kite_shield.clone(); sh.position.set(W / 2 - 0.2, y + 1.7, -2.6); sh.rotation.y = -Math.PI / 2; g.add(sh);
    }
    // один тёплый свет на дом
    const light = new THREE.PointLight(0xffb070, 35, 16, 1.4); light.position.set(0, L(1) + 0.5, 1); g.add(light);
  };
  [0.35, 1.95, -1.3, -2.75].forEach((a) => {
    const hx = V.x + Math.sin(a) * 16, hz = V.z + Math.cos(a) * 16;
    const t = buildTower(scene, hx, gh(hx, hz), hz, a + Math.PI, towerMats, { furnish });
    smokes.push(t.smoke);
  });

  // колодец
  {
    const a = -1.25, x = V.x + Math.sin(a) * 6.5, z = V.z + Math.cos(a) * 6.5, y = gh(x, z);
    add(tcyl(0.95, 1.0, 0.9, 14, 1.5), stoneMat, x, y + 0.45, z, 0, 1.1);
    add(new THREE.CylinderGeometry(0.78, 0.78, 0.92, 14), new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.1 }), x, y + 0.47, z);
    for (const sx of [-1, 1]) add(tbox(0.16, 2.1, 0.16, 1), beamMat, x + sx * 0.85, y + 1.25, z);
    for (const sz of [-1, 1]) { const r = add(tbox(2.2, 0.12, 1.1, 2), thatchMat, x, y + 2.55, z + sz * 0.4); r.rotation.x = sz * 0.75; }
    const crank = add(tcyl(0.06, 0.06, 1.8, 6, 1), barkMat, x, y + 1.85, z); crank.rotation.z = Math.PI / 2;
    placeModel(scene, 'wooden_bucket_01', x + 1.1, y, z + 0.3, 0.5, 1);
  }
  // забор из жердей с воротами
  {
    const gates = paths.map((pp) => Math.atan2(pp[2] - V.x, pp[3] - V.z));
    const R = V.r + 4, n = 90;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (gates.some((gt) => angDiff(a, gt) < 0.19)) { prev = null; continue; }
      const x = V.x + Math.sin(a) * R, z = V.z + Math.cos(a) * R, y = gh(x, z);
      add(tcyl(0.08, 0.1, 1.4, 6, 1), barkMat, x, y + 0.6, z);
      colliders.push({ x, z, r: 0.6 });
      if (prev) {
        const mx = (x + prev.x) / 2, mz = (z + prev.z) / 2, len = Math.hypot(x - prev.x, z - prev.z), ry = Math.atan2(x - prev.x, z - prev.z);
        for (const hh of [0.5, 0.95]) { const rl = add(tcyl(0.05, 0.05, len + 0.2, 5, 1), barkMat, mx, (y + prev.y) / 2 + hh, mz, ry); rl.rotation.x = Math.PI / 2; }
      }
      prev = { x, z, y };
    }
  }
  // фонари на столбах вдоль дорог
  for (const pp of paths) {
    const dx = pp[2] - pp[0], dz = pp[3] - pp[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    for (const d of [30, 42]) {
      if (d > L - 18) continue;
      const x = pp[0] + ux * d + uz * 2.6, z = pp[1] + uz * d - ux * 2.6, y = gh(x, z);
      add(tcyl(0.08, 0.11, 3.0, 7, 1.2), barkMat, x, y + 1.5, z, 0, 0.25);
      add(tbox(0.8, 0.1, 0.1, 1), beamMat, x - uz * 0.35, y + 2.9, z + ux * 0.35, Math.atan2(-uz, ux));
      const lx = x - uz * 0.65, lz = z + ux * 0.65;
      const ln = placeModel(scene, 'wooden_lantern_01', lx, y + 2.25, lz, 0, 1.3);
      ln.traverse((o) => { if (o.isMesh && o.material.name.includes('glass')) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffa040); o.material.emissiveIntensity = 2.5; } });
      lamps.push(new THREE.Vector3(lx, y + 2.5, lz));
    }
  }
  // бочки, ящики, вёдра
  for (let i = 0; i < 14; i++) {
    const a = rng() * 6.28, d = 5 + rng() * 5, x = V.x + Math.sin(a) * d, z = V.z + Math.cos(a) * d;
    if (pathDist(x, z) < 2.4 || Math.hypot(x - 4.5, z - 2.5) < 1.6) continue;
    const y = gh(x, z), k = i % 3;
    if (k === 0) { placeModel(scene, 'wine_barrel_01', x, y, z, rng() * 6, 1); colliders.push({ x, z, r: 0.45 }); }
    else if (k === 1) { placeModel(scene, 'wooden_crate_01', x, y, z, rng() * 6, 1); colliders.push({ x, z, r: 0.5 }); }
    else placeModel(scene, 'wooden_bucket_01', x, y, z, rng() * 6, 1);
  }

  // ================= Лагерь нежити =================
  const GC = ZONES.goblins;
  fire(GC.x, gh(GC.x, GC.z) + 0.2, GC.z, 1.0, 0x55ff99, 40);
  placeModel(scene, 'stone_fire_pit', GC.x, gh(GC.x, GC.z), GC.z, 1, 1.5);
  colliders.push({ x: GC.x, z: GC.z, r: 1.0 });
  const darkCloth = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 1, side: THREE.DoubleSide });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.8 });
  const toVillage = Math.atan2(V.x - GC.x, V.z - GC.z);
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2;
    if (angDiff(a, toVillage) < 0.3) continue;
    const x = GC.x + Math.sin(a) * 13.5, z = GC.z + Math.cos(a) * 13.5, y = gh(x, z), hh = 2.4 + rng() * 0.9;
    const sp = add(tcyl(0.2, 0.24, hh, 7, 1.3), barkMat, x, y + hh / 2, z, 0, 0.35); sp.rotation.z = (rng() - 0.5) * 0.12;
    add(new THREE.ConeGeometry(0.22, 0.6, 7), barkMat, x, y + hh + 0.3, z);
    if (i % 6 === 0) add(new THREE.SphereGeometry(0.17, 10, 8), boneMat, x, y + hh + 0.12, z);
  }
  for (const [dx, dz] of [[6, 4], [-5, 6], [4, -7], [-7, -3]]) { // шатры из шкур на жердях
    const x = GC.x + dx, z = GC.z + dz, y = gh(x, z);
    const tent = add(new THREE.ConeGeometry(2.0, 3.0, 9, 1, true), darkCloth, x, y + 1.5, z, rng() * 6, 1.8);
    tent.material = darkCloth;
    for (let k = 0; k < 5; k++) { const a = k * 1.25; const pole = add(tcyl(0.04, 0.05, 3.8, 5, 1), barkMat, x + Math.sin(a) * 0.9, y + 1.7, z + Math.cos(a) * 0.9); pole.rotation.set(Math.cos(a) * -0.5, 0, Math.sin(a) * 0.5); }
  }
  for (let i = 0; i < 4; i++) { const a = rng() * 6.28, d = 6 + rng() * 5; placeModel(scene, 'dead_tree_trunk', GC.x + Math.sin(a) * d, gh(GC.x + Math.sin(a) * d, GC.z + Math.cos(a) * d) - 0.1, GC.z + Math.cos(a) * d, rng() * 6, 0.8 + rng() * 0.4); }
  for (let i = 0; i < 16; i++) {
    const a = rng() * 6.28, d = 3 + rng() * 9, x = GC.x + Math.sin(a) * d, z = GC.z + Math.cos(a) * d;
    const b = add(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6), boneMat, x, gh(x, z) + 0.04, z, rng() * 3); b.rotation.z = Math.PI / 2;
    if (i % 3 === 0) add(new THREE.SphereGeometry(0.12, 10, 8), boneMat, x + 0.2, gh(x, z) + 0.1, z);
  }
  for (const [dx, dz] of [[-3, -8], [9, 6], [-10, -6], [2, 10]]) torch(GC.x + dx, GC.z + dz, 0x66ffaa);

  // ================= Древние руины и кладбище =================
  const R = ZONES.ruins;
  const ruinMat = pbr('mossy_stone_wall'), slateMat = pbr('castle_wall_slates');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, x = R.x + Math.sin(a) * 12, z = R.z + Math.cos(a) * 12, y = gh(x, z);
    if (i % 4 === 3) { const m = add(tcyl(0.55, 0.6, 4, 12, 2), ruinMat, x, y + 0.5, z, a); m.rotation.z = Math.PI / 2; colliders.push({ x, z, r: 0.9 }); continue; }
    const hh = i % 3 === 0 ? 2 + rng() * 1.5 : 5.5;
    add(tbox(1.7, 0.6, 1.7, 1.5), ruinMat, x, y + 0.3, z);
    add(tcyl(0.6, 0.7, hh, 12, 2), ruinMat, x, y + 0.6 + hh / 2, z, 0, 0.85);
    if (hh > 5) add(tbox(1.7, 0.45, 1.7, 1.5), ruinMat, x, y + 0.6 + hh + 0.2, z);
  }
  {
    const a = Math.atan2(V.x - R.x, V.z - R.z), x = R.x + Math.sin(a) * 15, z = R.z + Math.cos(a) * 15, y = gh(x, z);
    const px = Math.cos(a) * 2.3, pz = -Math.sin(a) * 2.3;
    for (const sx of [-1, 1]) add(tbox(1.1, 4.4, 1.1, 2), ruinMat, x + px * sx, y + 2.2, z + pz * sx, a, 0.8);
    add(tbox(5.8, 0.9, 1.2, 2), ruinMat, x, y + 4.8, z, a + Math.PI / 2);
  }
  for (const [dx, dz, w, ry] of [[-6, 3, 5, 0.3], [5, -5, 4, 1.4], [3, 7, 3.5, 2.2]]) {
    const x = R.x + dx, z = R.z + dz, hh = 1.8 + rng();
    add(tbox(w, hh, 0.8, 2), ruinMat, x, gh(x, z) + hh / 2, z, ry);
    const ux = Math.sin(ry + Math.PI / 2), uz = Math.cos(ry + Math.PI / 2);
    for (let k = -1; k <= 1; k++) colliders.push({ x: x + ux * k * (w / 3), z: z + uz * k * (w / 3), r: 0.8 });
  }
  {
    const y = gh(R.x, R.z);
    add(tbox(5.2, 0.35, 4.2, 2), slateMat, R.x, y + 0.17, R.z, 0.5);
    add(tbox(4.2, 0.35, 3.2, 2), slateMat, R.x, y + 0.5, R.z, 0.5);
    add(tbox(2.4, 1, 1.4, 1.5), ruinMat, R.x, y + 1.15, R.z, 0.5, 1.3);
    for (const k of [-0.8, 0.8]) fire(R.x + k, y + 1.75, R.z + k * 0.5, 0.15, 0xffc060, 0);
  }
  for (let i = 0; i < 18; i++) { // надгробия
    const a = rng() * 6.28, d = 4 + rng() * 9, x = R.x + Math.sin(a) * d, z = R.z + Math.cos(a) * d, y = gh(x, z);
    if (Math.hypot(x - R.x, z - R.z) < 3.5) continue;
    const gg = new THREE.Group(); gg.position.set(x, y, z); gg.rotation.set((rng() - 0.5) * 0.3, a + rng() * 0.6 - 0.3, (rng() - 0.5) * 0.15); scene.add(gg);
    add(tbox(0.65, 0.9, 0.2, 1), slateMat, 0, 0.42, 0, 0, 0, gg);
    const topc = add(new THREE.CylinderGeometry(0.325, 0.325, 0.2, 14, 1, false, 0, Math.PI), slateMat, 0, 0.87, 0, 0, 0, gg); topc.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    colliders.push({ x, z, r: 0.35 });
  }
  for (let i = 0; i < 30; i++) {
    const a = rng() * 6.28, d = 2 + rng() * 14, x = R.x + Math.sin(a) * d, z = R.z + Math.cos(a) * d, sc = 0.15 + rng() * 0.35;
    const rb = add(tbox(sc * 2, sc, sc * 1.4, 1), ruinMat, x, gh(x, z) + sc / 2 - 0.05, z, rng() * 3); rb.rotation.z = (rng() - 0.5) * 0.4;
  }

  // ================= Арена =================
  const A = ZONES.arena;
  const redCloth = new THREE.MeshStandardMaterial({ color: 0x6a1414, roughness: 0.9, side: THREE.DoubleSide });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.45 });
  const toVillageA = Math.atan2(V.x - A.x, V.z - A.z);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (angDiff(a, toVillageA) < 0.3) continue;
    const x = A.x + Math.sin(a) * 15, z = A.z + Math.cos(a) * 15, y = gh(x, z), hh = 3.8 + rng() * 1.6;
    const st = add(tbox(1.4, hh, 1.0, 2), slateMat, x, y + hh / 2 - 0.2, z, a, 0.8); st.rotation.z = (rng() - 0.5) * 0.08;
    if (i % 3 === 0) add(new THREE.PlaneGeometry(0.9, 2.3), redCloth, x - Math.sin(a) * 0.52, y + hh - 1.5, z - Math.cos(a) * 0.52, a).castShadow = false;
  }
  {
    const back = toVillageA + Math.PI, x = A.x + Math.sin(back) * 10, z = A.z + Math.cos(back) * 10, y = gh(x, z);
    add(tbox(3.2, 1, 2.6, 2), slateMat, x, y + 0.5, z, back, 1.6);
    add(tbox(3.2, 4.2, 0.7, 2), slateMat, x + Math.sin(back) * 1.1, y + 2.1, z + Math.cos(back) * 1.1, back);
    for (const side of [-1, 1]) {
      const bx = x + Math.cos(back) * 3.6 * side, bz = z - Math.sin(back) * 3.6 * side, by = gh(bx, bz);
      add(tcyl(0.3, 0.45, 1.6, 10, 1.5), slateMat, bx, by + 0.8, bz, 0, 0.5);
      add(new THREE.CylinderGeometry(0.6, 0.32, 0.45, 12), ironMat, bx, by + 1.82, bz);
      fire(bx, by + 2.0, bz, 0.7, 0xff7a30, 30);
    }
  }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; torch(A.x + Math.sin(a) * 12.5, A.z + Math.cos(a) * 12.5); }

  // ================= Волчий лес: брёвна, грибы =================
  const F = ZONES.forest;
  for (let i = 0; i < 4; i++) {
    const a = rng() * 6.28, x = F.x + Math.sin(a) * 7, z = F.z + Math.cos(a) * 7;
    const m = add(tcyl(0.4, 0.45, 4.5, 10, 1.5), barkMat, x, gh(x, z) + 0.35, z, a); m.rotation.z = Math.PI / 2;
    colliders.push({ x, z, r: 0.7 });
  }
  placeModel(scene, 'dead_tree_trunk', F.x + 3, gh(F.x + 3, F.z - 4) - 0.1, F.z - 4, 1.2, 1.1);

  return {
    flames, smokes, lamps,
    update(t) {
      windU.uTime.value = t;
      for (const f of flames) if (f.light) f.light.intensity = f.base * (0.8 + Math.sin(t * 13 + f.o) * 0.1 + Math.sin(t * 7.3 + f.o) * 0.1);
      water.material.normalMap.offset.set(t * 0.004, t * 0.003);
    },
  };
}

// Покачивание на ветру для листвы и травы (amp — сила)
function windSway(mat, windU, amp) {
  mat.customProgramCacheKey = () => 'wind' + amp;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windU.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float w = sin(uTime * 1.6 + ip.x * 0.31 + ip.y * 0.23) + 0.45 * sin(uTime * 3.1 + ip.x * 0.9 - ip.y * 0.6);
      float hgt = max(position.y, 0.0);
      transformed.x += w * ${amp.toFixed(3)} * hgt; transformed.z += w * ${(amp * 0.5).toFixed(3)} * hgt;`);
  };
}
