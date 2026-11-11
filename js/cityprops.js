// Городские ресурсы, нарисованные кодом: фасады зданий и машины
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb, rep, off) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.repeat.set(rep[0], rep[1]); t.offset.set(off[0], off[1]);
  return t;
}

// ================= ФАСАДЫ =================
// Текстура = 8 этажей × 8 пролётов. Три слоя: цвет, «шероховатость/металл» (G/B), свечение (пожары в окнах).
const FLOORS = 8, BAYS = 8, PX = 1024, CELL = PX / BAYS;
const STYLES = {
  glassBlue: { kind: 'glass', tint: [70, 110, 135], frame: '#1c2226', fh: 3.8, bw: 1.6 },
  glassBronze: { kind: 'glass', tint: [120, 95, 70], frame: '#2a2420', fh: 3.8, bw: 1.6 },
  glassGreen: { kind: 'glass', tint: [70, 115, 105], frame: '#1d2523', fh: 3.8, bw: 1.6 },
  panelWhite: { kind: 'panel', wall: [222, 218, 208], fh: 3.0, bw: 3.2, photo: 'PaintedPlaster015', tile: 3 },
  panelBeige: { kind: 'panel', wall: [205, 186, 155], fh: 3.0, bw: 3.2, photo: 'PaintedPlaster018', tile: 3 },
  panelGrey: { kind: 'panel', wall: [170, 172, 170], fh: 3.0, bw: 3.2, photo: 'PaintedPlaster012', tile: 3 },
  brickYellow: { kind: 'brick', wall: [196, 160, 98], fh: 3.1, bw: 3.0, photo: 'Bricks105', tile: 1.6 },
  brickRed: { kind: 'brick', wall: [140, 72, 56], fh: 3.1, bw: 3.0, photo: 'Bricks085', tile: 1.6 },
};
// Фасады целиком с фотографий (ambientCG, CC0): tile — размер одного повтора в метрах
export const PHOTO_FACADES = {
  Facade001: { tile: 36, metal: true }, // синее стекло
  Facade005: { tile: 30, metal: true }, // зелёное стекло
  Facade006: { tile: 28.8, metal: true }, // офис с ленточными окнами
  Facade019A: { tile: 21, metal: true }, // бетонный офис
  Facade018A: { tile: 19.2, metal: true }, // кирпичный жилой дом
  Facade020A: { tile: 19.2, metal: true }, // кирпичный дом с пилонами
};
// Фасады, вырезанные и выпрямленные из настоящих фотографий домов Астаны (Wikimedia Commons, свободные лицензии — авторы в README).
// w, h — сколько метров стены занимает один повтор фото
export const REAL_FACADES = {
  astana_ornate: { w: 24.8, h: 12 }, // кирпичный дом с орнаментом, старый центр
  astana_panel: { w: 23, h: 14 }, // жёлтая панельная девятиэтажка, ул. Ташенова
  astana_brick: { w: 14, h: 23 }, // кирпичная высотка с красным верхом
  astana_bay: { w: 35, h: 25 }, // девятиэтажка с остеклёнными балконами
  astana_modern: { w: 18, h: 24 }, // новый жилой комплекс
  astana_academy: { w: 21, h: 49, glass: 0.5 }, // Академия госуправления
  astana_talan: { w: 28, h: 90, glass: 1 }, // Talan Towers
  astana_w1: { w: 28, h: 68, glass: 1 }, // башня W1
};
export const WALL_PHOTOS = [...new Set(Object.values(STYLES).map((st) => st.photo).filter(Boolean))];
export const FACADE_STYLES = Object.keys(STYLES);

function drawFacade(st, seed) {
  const r = mulberry32(seed);
  const [cc, g] = canvas(PX, PX), [co, o] = canvas(PX, PX), [ce, e] = canvas(PX, PX);
  const rgb = (a, k = 1) => `rgb(${(a[0] * k) | 0},${(a[1] * k) | 0},${(a[2] * k) | 0})`;
  e.fillStyle = '#000'; e.fillRect(0, 0, PX, PX);
  // слой материала: G — шероховатость, B — металличность
  const orm = (x, y, w, h, rough, metal) => { o.fillStyle = `rgb(0,${rough},${metal})`; o.fillRect(x, y, w, h); };
  if (st.kind === 'glass') {
    o.fillStyle = 'rgb(0,30,200)'; o.fillRect(0, 0, PX, PX);
    for (let f = 0; f < FLOORS; f++) for (let b = 0; b < BAYS; b++) {
      const x = b * CELL, y = f * CELL, k = 0.55 + r() * 0.35;
      const grd = g.createLinearGradient(x, y, x + CELL * 0.6, y + CELL);
      grd.addColorStop(0, rgb(st.tint, k * 1.25)); grd.addColorStop(1, rgb(st.tint, k * 0.55));
      g.fillStyle = grd; g.fillRect(x, y, CELL, CELL);
      const roll = r();
      if (roll < 0.06) { // выбитое стекло — тёмный провал
        g.fillStyle = '#07090a'; g.fillRect(x + 6, y + 6, CELL - 12, CELL - 12); orm(x + 6, y + 6, CELL - 12, CELL - 12, 240, 0);
        g.strokeStyle = 'rgba(190,210,220,0.6)'; g.lineWidth = 2; g.beginPath();
        for (let k2 = 0; k2 < 6; k2++) { g.moveTo(x + 6, y + 6 + r() * (CELL - 12)); g.lineTo(x + CELL / 2 + (r() - 0.5) * 30, y + CELL / 2 + (r() - 0.5) * 30); }
        g.stroke();
      } else if (roll < 0.075) { // пожар внутри
        e.fillStyle = `rgb(255,${120 + r() * 60 | 0},40)`; e.fillRect(x + 8, y + 30, CELL - 16, CELL - 38);
        g.fillStyle = '#3a1d0e'; g.fillRect(x + 8, y + 30, CELL - 16, CELL - 38);
      }
    }
    // межэтажные пояса (непрозрачные панели) и вертикальные импосты
    for (let f = 0; f < FLOORS; f++) { g.fillStyle = st.frame; g.fillRect(0, f * CELL, PX, 18); orm(0, f * CELL, PX, 18, 90, 255); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, f * CELL + 18, PX, 3); }
    for (let b = 0; b <= BAYS; b++) { g.fillStyle = st.frame; g.fillRect(b * CELL - 4, 0, 8, PX); orm(b * CELL - 4, 0, 8, PX, 90, 255); }
  } else {
    // стена: без фото — заливка цветом, с фото — прозрачный фон (фото подставит шейдер)
    if (!st.photo) { g.fillStyle = rgb(st.wall); g.fillRect(0, 0, PX, PX); }
    o.fillStyle = 'rgb(0,235,0)'; o.fillRect(0, 0, PX, PX);
    if (st.kind === 'brick' && !st.photo) {
      g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1.5;
      for (let y = 0; y < PX; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(PX, y); g.stroke(); for (let x = (y / 8) % 2 ? 0 : 10; x < PX; x += 20) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 8); g.stroke(); } }
    } else {
      // швы панелей
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 3;
      for (let f = 0; f <= FLOORS; f++) { g.beginPath(); g.moveTo(0, f * CELL); g.lineTo(PX, f * CELL); g.stroke(); }
      for (let b = 0; b <= BAYS; b++) { g.beginPath(); g.moveTo(b * CELL, 0); g.lineTo(b * CELL, PX); g.stroke(); }
    }
    // грязь, потёки
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(35,30,25,${r() * 0.08})`; g.fillRect(r() * PX, r() * PX, 3 + r() * 24, 40 + r() * 180); }
    const balconyCols = new Set([1, 2, 5, 6].filter(() => r() < 0.8));
    for (let f = 0; f < FLOORS; f++) for (let b = 0; b < BAYS; b++) {
      const x = b * CELL, y = f * CELL;
      const ww = CELL * 0.5, wh = CELL * 0.5, wx = x + (CELL - ww) / 2, wy = y + CELL * 0.18;
      // оконный проём + рама
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(wx - 5, wy - 5, ww + 10, wh + 12);
      const roll = r();
      if (roll < 0.07) { g.fillStyle = '#060606'; g.fillRect(wx, wy, ww, wh); orm(wx, wy, ww, wh, 250, 0); }
      else if (roll < 0.11) { g.fillStyle = '#6b4f32'; for (let k = 0; k < 4; k++) g.fillRect(wx - 3, wy + k * (wh / 4) + 2, ww + 6, wh / 4 - 4); orm(wx, wy, ww, wh, 245, 0); }
      else if (roll < 0.125) { e.fillStyle = `rgb(255,${110 + r() * 70 | 0},35)`; e.fillRect(wx, wy, ww, wh); g.fillStyle = '#2a140a'; g.fillRect(wx, wy, ww, wh); }
      else {
        const k = 0.75 + r() * 0.35, grd = g.createLinearGradient(wx, wy, wx + ww * 0.4, wy + wh);
        grd.addColorStop(0, `rgb(${120 * k},${140 * k},${150 * k})`); grd.addColorStop(1, `rgb(${40 * k},${50 * k},${56 * k})`);
        g.fillStyle = grd; g.fillRect(wx, wy, ww, wh); orm(wx, wy, ww, wh, 20, 120);
        g.fillStyle = st.kind === 'brick' ? '#efe7d6' : '#f2f0ea'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.35, ww, 3);
        if (r() < 0.3) { g.fillStyle = `rgba(${200 + r() * 55},${180 + r() * 60},${150 + r() * 80},0.55)`; g.fillRect(wx + 3, wy + 3, ww * 0.3, wh - 6); } // шторы
      }
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(wx - 6, wy + wh + 5, ww + 12, 5); // отлив
      // балкон с ограждением
      if (st.kind === 'panel' && balconyCols.has(b) && f > 0) {
        const by = y + CELL * 0.68, bh = CELL * 0.3;
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 8, by + bh, CELL - 16, 6);
        g.fillStyle = rgb(st.wall, 0.82); g.fillRect(x + 8, by, CELL - 16, bh);
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let k = x + 14; k < x + CELL - 10; k += 10) { g.beginPath(); g.moveTo(k, by); g.lineTo(k, by + bh); g.stroke(); }
        if (r() < 0.3) { g.fillStyle = '#d8d8d4'; g.fillRect(x + CELL - 34, by + 6, 20, 14); g.fillStyle = '#888'; g.fillRect(x + CELL - 30, by + 9, 12, 8); } // кондиционер
        if (r() < 0.12) { g.fillStyle = '#e8e8e6'; g.beginPath(); g.arc(x + 22, by + 12, 9, 0, 7); g.fill(); } // тарелка
      } else if (r() < 0.12) { g.fillStyle = '#d6d6d2'; g.fillRect(wx + ww + 8, wy + wh * 0.4, 18, 13); } // кондиционер у окна
    }
  }
  const rep = [1 / (BAYS * st.bw), -1 / (FLOORS * st.fh)], off = [0, 1 / (FLOORS * st.fh)];
  return { map: tex(cc, true, rep, off), orm: tex(co, false, rep, off), emi: tex(ce, true, rep, off) };
}

// photo: { имя: { map, normal, rough?, metal? } } — загруженные фото-текстуры
export function makeFacadeMaterials(photo = {}) {
  const mats = {};
  let seed = 11;
  const tiled = (t, tile) => { if (!t) return null; const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1 / tile, -1 / tile); c.needsUpdate = true; return c; };
  for (const [name, st] of Object.entries(STYLES)) {
    const t = drawFacade(st, seed++);
    const ph = st.photo && photo[st.photo];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1,
      emissiveMap: t.emi, emissive: 0xffffff, emissiveIntensity: 1.6,
    });
    if (ph) {
      // окна и балконы — с канвы, стена между ними — фотография с рельефом
      m.normalMap = tiled(ph.normal, st.tile); m.normalScale.set(0.9, 0.9);
      const wallMap = tiled(ph.map, st.tile);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.wallMap = { value: wallMap };
        sh.fragmentShader = 'uniform sampler2D wallMap;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 wallC = texture2D( wallMap, vNormalMapUv ).rgb;
          diffuseColor.rgb *= mix( wallC, sampledDiffuseColor.rgb, sampledDiffuseColor.a );`);
      };
      m.customProgramCacheKey = () => 'photowall';
    }
    mats[name] = m;
  }
  for (const [name, spec] of Object.entries(PHOTO_FACADES)) {
    const ph = photo[name];
    if (!ph) continue;
    mats['ph_' + name] = new THREE.MeshStandardMaterial({
      map: tiled(ph.map, spec.tile), normalMap: tiled(ph.normal, spec.tile),
      roughnessMap: tiled(ph.rough, spec.tile), metalnessMap: tiled(ph.metal, spec.tile),
      roughness: 1, metalness: ph.metal ? 1 : 0.1, envMapIntensity: 1.2,
    });
  }
  for (const [name, spec] of Object.entries(REAL_FACADES)) {
    const ph = photo[name];
    if (!ph) continue;
    const map = ph.map.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(1 / spec.w, -1 / spec.h); map.needsUpdate = true;
    const gl = spec.glass || 0;
    mats['rp_' + name] = new THREE.MeshStandardMaterial({ map, roughness: 0.85 - 0.55 * gl, metalness: 0.45 * gl, envMapIntensity: 0.9 + 0.5 * gl });
  }
  mats.shop = makeShopMaterial();
  return mats;
}

// Первые этажи: витрины магазинов с вывесками (16 м × 4.5 м на текстуру)
export const SHOP_H = 4.5;
function makeShopMaterial() {
  const r = mulberry32(99);
  const W = 2048, H = 576;
  const [cc, g] = canvas(W, H), [co, o] = canvas(W, H), [ce, e] = canvas(W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  o.fillStyle = 'rgb(0,230,0)'; o.fillRect(0, 0, W, H);
  const names = ['ДӘРІХАНА', 'АПТЕКА', 'КАФЕ', 'МАРКЕТ', 'BANK', 'ДҮКЕН', 'COFFEE', 'ОПТИКА', 'ГҮЛДЕР', 'ТЕХНИКА', 'ШАУРМА', 'НАН', 'SALON', 'KASPI', '24/7', 'АЗЫҚ-ТҮЛІК'];
  const signCols = ['#b0302a', '#1f5fa8', '#2a8a4a', '#d89a22', '#5a2a7a', '#202020', '#c84a1a', '#1a7a8a'];
  g.fillStyle = '#5a5650'; g.fillRect(0, 0, W, H);
  const n = 4, sw = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * sw;
    // вывеска
    const sc = signCols[Math.floor(r() * signCols.length)];
    g.fillStyle = sc; g.fillRect(x + 12, 20, sw - 24, 92);
    g.fillStyle = '#fff'; g.font = 'bold 60px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(names[Math.floor(r() * names.length)], x + sw / 2, 68, sw - 60);
    if (r() < 0.35) { e.fillStyle = sc; e.fillRect(x + 12, 20, sw - 24, 92); } // уцелевшая подсветка
    // витрина
    const vx = x + 30, vy = 140, vw = sw - 60, vh = H - 160, roll = r();
    if (roll < 0.3) { // рольставни
      g.fillStyle = '#8a8c8e'; g.fillRect(vx, vy, vw, vh);
      g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = vy; y < vy + vh; y += 12) g.fillRect(vx, y, vw, 3);
      g.fillStyle = 'rgba(30,30,30,0.6)'; g.font = 'bold 44px Arial'; g.fillText(['ЗАКРЫТО', 'ҚАУІП!', 'HELP', '☣'][Math.floor(r() * 4)], vx + vw / 2, vy + vh / 2);
      o.fillStyle = 'rgb(0,120,200)'; o.fillRect(vx, vy, vw, vh);
    } else {
      const grd = g.createLinearGradient(vx, vy, vx + vw * 0.5, vy + vh);
      grd.addColorStop(0, '#5d6d75'); grd.addColorStop(1, '#151b1e');
      g.fillStyle = grd; g.fillRect(vx, vy, vw, vh);
      o.fillStyle = 'rgb(0,15,160)'; o.fillRect(vx, vy, vw, vh);
      if (roll < 0.6) { // разбитая витрина
        g.fillStyle = '#050505'; g.fillRect(vx + vw * 0.2, vy + vh * 0.1, vw * 0.55, vh * 0.75);
        o.fillStyle = 'rgb(0,250,0)'; o.fillRect(vx + vw * 0.2, vy + vh * 0.1, vw * 0.55, vh * 0.75);
        g.strokeStyle = 'rgba(210,225,230,0.7)'; g.lineWidth = 3; g.beginPath();
        for (let k = 0; k < 9; k++) { g.moveTo(vx + vw * 0.47, vy + vh * 0.45); g.lineTo(vx + r() * vw, vy + r() * vh); }
        g.stroke();
      }
      g.fillStyle = '#2a2c2e'; g.fillRect(vx + vw * 0.42, vy, 8, vh); // переплёт
    }
    g.fillStyle = '#3a3836'; g.fillRect(x, 0, 12, H); g.fillRect(x + sw - 12, 0, 12, H);
  }
  g.fillStyle = '#2a2826'; g.fillRect(0, H - 14, W, 14);
  const rep = [1 / 16, -1 / SHOP_H], off = [0, 1 / SHOP_H];
  return new THREE.MeshStandardMaterial({
    map: tex(cc, true, rep, off), roughnessMap: tex(co, false, rep, off), metalnessMap: tex(co, false, rep, off), roughness: 1, metalness: 1,
    emissiveMap: tex(ce, true, rep, off), emissive: 0xffffff, emissiveIntensity: 1.2,
  });
}

// ================= МАШИНЫ =================
// Профили сбоку: x — вперёд, y — вверх. glass — контур остекления.
const CAR_TYPES = {
  sedan: { L: 4.5, W: 1.8, wr: 0.33, wb: 1.38, weight: 40,
    body: [[-2.25, 0.32], [2.25, 0.32], [2.28, 0.6], [2.12, 0.79], [1.25, 0.88], [0.55, 1.38], [-0.75, 1.4], [-1.45, 0.95], [-2.2, 0.9], [-2.3, 0.62]],
    glass: [[1.18, 0.9], [0.55, 1.33], [-0.72, 1.35], [-1.38, 0.95]] },
  hatch: { L: 4.0, W: 1.75, wr: 0.32, wb: 1.25, weight: 22,
    body: [[-1.95, 0.32], [2.0, 0.32], [2.03, 0.6], [1.9, 0.78], [1.05, 0.9], [0.4, 1.42], [-1.7, 1.44], [-1.98, 1.0], [-2.0, 0.6]],
    glass: [[0.98, 0.92], [0.4, 1.37], [-1.62, 1.39], [-1.9, 1.0]] },
  suv: { L: 4.7, W: 1.92, wr: 0.4, wb: 1.42, weight: 26,
    body: [[-2.35, 0.42], [2.35, 0.42], [2.38, 0.82], [2.2, 1.03], [1.3, 1.12], [0.75, 1.76], [-2.15, 1.8], [-2.33, 1.22], [-2.38, 0.8]],
    glass: [[1.22, 1.14], [0.75, 1.71], [-2.1, 1.74], [-2.27, 1.2]] },
  van: { L: 5.2, W: 1.98, wr: 0.36, wb: 1.7, weight: 9,
    body: [[-2.6, 0.38], [2.6, 0.38], [2.63, 0.8], [2.5, 1.12], [1.95, 1.26], [1.45, 2.06], [-2.58, 2.1], [-2.63, 0.8]],
    glass: [[1.9, 1.28], [1.45, 1.99], [0.85, 1.99], [0.85, 1.28]] },
  bus: { L: 12, W: 2.5, wr: 0.5, wb: 3.6, weight: 3,
    body: [[-6, 0.45], [6, 0.45], [6.05, 2.9], [5.85, 3.12], [-5.9, 3.12], [-6.05, 2.9]],
    glass: [[-5.7, 1.35], [5.98, 1.35], [6.0, 2.82], [-5.7, 2.82]] },
};
export const CAR_KINDS = Object.keys(CAR_TYPES);
export function carWeights() { return CAR_KINDS.map((k) => CAR_TYPES[k].weight); }
export function carSpec(k) { return CAR_TYPES[k]; }

function profileGeo(pts, width, bevel) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, bevel ? { depth: width - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3, curveSegments: 1 } : { depth: width, bevelEnabled: false });
  g.translate(0, 0, -(bevel ? width - 0.16 : width) / 2);
  g.rotateY(-Math.PI / 2);
  return g.toNonIndexed();
}
function buildCar(t) {
  const { L, W, wr, wb } = t;
  const parts = { paint: [], glass: [], rubber: [], metal: [], trim: [], head: [], tail: [] };
  parts.paint.push(profileGeo(t.body, W, true));
  const gc = t.glass.reduce((a, [x, y]) => [a[0] + x / t.glass.length, a[1] + y / t.glass.length], [0, 0]);
  parts.glass.push(profileGeo(t.glass.map(([x, y]) => [gc[0] + (x - gc[0]) * 1.02, gc[1] + (y - gc[1]) * 1.04]), W + 0.03, false));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 - 0.13), z = sz * (t === CAR_TYPES.bus && sz < 0 ? wb : wb);
    parts.rubber.push(new THREE.CylinderGeometry(wr, wr, 0.24, 18).rotateZ(Math.PI / 2).translate(x, wr, z).toNonIndexed());
    parts.metal.push(new THREE.CylinderGeometry(wr * 0.58, wr * 0.58, 0.26, 10).rotateZ(Math.PI / 2).translate(x + sx * 0.005, wr, z).toNonIndexed());
  }
  const front = L / 2, by = t.body[0][1];
  // бамперы, решётка, фары, фонари, зеркала
  parts.trim.push(new THREE.BoxGeometry(W - 0.1, 0.22, 0.14).translate(0, by + 0.12, front + 0.02).toNonIndexed());
  parts.trim.push(new THREE.BoxGeometry(W - 0.1, 0.22, 0.14).translate(0, by + 0.12, -front - 0.02).toNonIndexed());
  parts.trim.push(new THREE.BoxGeometry(W * 0.45, 0.16, 0.05).translate(0, by + 0.38, front + 0.03).toNonIndexed());
  for (const sx of [-1, 1]) {
    parts.head.push(new THREE.BoxGeometry(0.34, 0.12, 0.05).translate(sx * (W / 2 - 0.3), by + 0.38, front + 0.03).toNonIndexed());
    parts.tail.push(new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(sx * (W / 2 - 0.25), by + 0.45, -front - 0.03).toNonIndexed());
    if (t !== CAR_TYPES.bus) parts.trim.push(new THREE.BoxGeometry(0.2, 0.1, 0.1).translate(sx * (W / 2 + 0.06), by + 0.62, t.glass[0][0] - 0.1).toNonIndexed());
  }
  const out = {};
  for (const [k, list] of Object.entries(parts)) if (list.length) out[k] = mergeGeometries(list);
  return out;
}

const PART_MATS = () => ({
  paint: new THREE.MeshPhysicalMaterial({ roughness: 0.38, metalness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0b1215, roughness: 0.04, metalness: 0.95 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9a9ea2, roughness: 0.3, metalness: 0.9 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.6, metalness: 0.2 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, emissive: 0xfff2d0, emissiveIntensity: 0.15, roughness: 0.1 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xff2010, emissiveIntensity: 0.25, roughness: 0.2 }),
});

const PAINTS = [0xf2f2ee, 0xd8d8d4, 0x1a1a1c, 0x2b2d30, 0x8e9196, 0x5b5f64, 0x7b1d1d, 0x1d3557, 0x2e4a3a, 0xc8b892, 0x6a4a2a, 0xa52a2a];
const BUS_PAINTS = [0x2a6fb8, 0xf2c230, 0xe8e8e2, 0x2a8a5a];

const CAR_CACHE = {};
const REST_COLORS = { glass: 0x0b1215, rubber: 0x141414, metal: 0x9a9ea2, trim: 0x1c1d1f, head: 0xdfe6ea, tail: 0x8a1010 };
// Парк машин: по одной InstancedMesh на каждую деталь каждого типа
export class CarFleet {
  constructor(scene, cap, rng) {
    this.rng = rng; this.types = {};
    const mats = (CAR_CACHE.mats ||= PART_MATS());
    for (const k of CAR_KINDS) {
      // кузов красится отдельно, остальное (стёкла, колёса, фары) слито в одну деталь с цветом в вершинах — меньше вызовов отрисовки
      const geos = (CAR_CACHE[k] ||= (() => {
        const g = buildCar(CAR_TYPES[k]), rest = [];
        for (const [part, geo] of Object.entries(g)) {
          if (part === 'paint') continue;
          const col = new THREE.Color(REST_COLORS[part]), n = geo.attributes.position.count, a = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
          geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); rest.push(geo);
        }
        const out = { paint: g.paint, rest: mergeGeometries(rest) };
        out.paint.userData.shared = out.rest.userData.shared = true;
        return out;
      })());
      mats.rest ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.45 });
      const n = k === 'bus' ? Math.ceil(cap * 0.1) : cap;
      const ims = {};
      for (const [part, geo] of Object.entries(geos)) {
        const im = new THREE.InstancedMesh(geo, mats[part], n);
        im.castShadow = part === 'paint'; im.receiveShadow = true;
        scene.add(im); ims[part] = im;
      }
      this.types[k] = { ims, n: 0, cap: n };
    }
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.col = new THREE.Color();
  }
  pick() {
    const w = carWeights(), sum = w.reduce((a, b) => a + b, 0);
    let x = this.rng() * sum;
    for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return CAR_KINDS[i]; }
    return 'sedan';
  }
  add(kind, matrix, burnt = false) {
    const t = this.types[kind];
    if (!t || t.n >= t.cap) return false;
    const i = t.n++;
    for (const [part, im] of Object.entries(t.ims)) {
      const gone = burnt && part === 'rest';
      im.setMatrixAt(i, gone ? this.zero : matrix);
    }
    const paints = kind === 'bus' ? BUS_PAINTS : PAINTS;
    this.col.setHex(burnt ? 0x16130f : paints[Math.floor(this.rng() * paints.length)]);
    if (!burnt) this.col.multiplyScalar(0.85 + this.rng() * 0.2); // грязь и выцветание
    t.ims.paint.setColorAt(i, this.col);
    return true;
  }
  finish() {
    for (const t of Object.values(this.types)) for (const im of Object.values(t.ims)) { im.count = t.n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
  }
}

// ================= Dodge Challenger Rider'а =================
// Отдельная (не инстансная) модель: колёса вращаются, стёкла полупрозрачные — видно, кто сидит внутри
const CHALLENGER = { L: 5.0, W: 1.95, wr: 0.36, wb: 1.5,
  body: [[-2.5, 0.3], [2.5, 0.3], [2.53, 0.55], [2.45, 0.86], [0.75, 0.94], [0.0, 1.5], [-1.2, 1.51], [-1.85, 0.98], [-2.48, 0.95], [-2.55, 0.6]],
  glass: [[0.7, 0.95], [0.0, 1.47], [-1.17, 1.48], [-1.78, 0.98]] };
export function makeChallenger() {
  const t = CHALLENGER, { W, wr, wb } = t, front = t.L / 2, by = 0.3;
  const g = new THREE.Group();
  const mats = PART_MATS();
  mats.paint.color.setHex(0xb01414);
  mats.glass = new THREE.MeshStandardMaterial({ color: 0x0b1215, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.88 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 });
  const add = (geo, m, shadow = true) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = shadow; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  // кузов без крыши над салоном не делаем — классическое купе
  add(profileGeo(t.body, W, true), mats.paint);
  const gc = t.glass.reduce((a, [x, y]) => [a[0] + x / 4, a[1] + y / 4], [0, 0]);
  add(profileGeo(t.glass.map(([x, y]) => [gc[0] + (x - gc[0]) * 1.03, gc[1] + (y - gc[1]) * 1.05]), W + 0.03, false), mats.glass, false);
  // гоночные полосы по капоту, крыше и багажнику
  for (const sx of [-0.22, 0.22]) {
    add(new THREE.BoxGeometry(0.22, 0.02, 1.75).translate(sx, 0.95, 1.62), stripe, false);
    add(new THREE.BoxGeometry(0.22, 0.02, 1.15).translate(sx, 1.515, -0.6), stripe, false);
    add(new THREE.BoxGeometry(0.22, 0.02, 0.62).translate(sx, 0.965, -2.17), stripe, false);
  }
  add(new THREE.BoxGeometry(0.7, 0.08, 0.9).translate(0, 0.98, 1.3), mats.paint); // воздухозаборник на капоте
  add(new THREE.BoxGeometry(W - 0.2, 0.06, 0.25).translate(0, 1.0, -2.42), stripe); // спойлер
  // салон: сиденья и руль (видны через стёкла)
  const seat = new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.8 });
  for (const [sx, sz] of [[0.42, -0.2], [-0.42, -0.2], [0.42, -1.1], [-0.42, -1.1]]) {
    add(new THREE.BoxGeometry(0.5, 0.14, 0.5).translate(sx, 0.36, sz), seat, false);
    add(new THREE.BoxGeometry(0.5, 0.6, 0.12).translate(sx, 0.7, sz - 0.3).rotateX(0), seat, false);
  }
  add(new THREE.TorusGeometry(0.18, 0.025, 6, 16).rotateX(-0.4).translate(0.42, 0.9, 0.35), mats.rubber, false);
  // бамперы, решётка, фары, фонари
  add(new THREE.BoxGeometry(W - 0.05, 0.2, 0.14).translate(0, by + 0.1, front + 0.02), mats.metal);
  add(new THREE.BoxGeometry(W - 0.05, 0.2, 0.14).translate(0, by + 0.1, -front - 0.02), mats.metal);
  add(new THREE.BoxGeometry(W - 0.25, 0.3, 0.05).translate(0, by + 0.38, front + 0.04), stripe);
  for (const sx of [-1, 1]) {
    for (const k of [0.25, 0.52]) add(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14).rotateX(Math.PI / 2).translate(sx * (W / 2 - k), by + 0.4, front + 0.06), mats.head, false);
    add(new THREE.BoxGeometry(0.75, 0.13, 0.05).translate(sx * (W / 2 - 0.45), by + 0.5, -front - 0.04), mats.tail, false);
    add(new THREE.BoxGeometry(0.18, 0.1, 0.1).translate(sx * (W / 2 + 0.05), 1.0, 0.6), mats.paint);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8).rotateX(Math.PI / 2).translate(sx * 0.5, by + 0.08, -front - 0.1), mats.metal, false); // выхлоп
  }
  mats.head.emissiveIntensity = 1.2; mats.tail.emissiveIntensity = 0.8;
  // колёса — отдельные группы, чтобы крутить
  g.userData.wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(sx * (W / 2 - 0.15), wr, sz * wb);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.28, 20).rotateZ(Math.PI / 2), mats.rubber); tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, 0.3, 10).rotateZ(Math.PI / 2), mats.metal);
    const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.31, wr * 1.1, 0.07), stripe);
    w.add(tire, rim, spokes, spokes.clone().rotateX(Math.PI / 2)); g.add(w); g.userData.wheels.push(w);
  }
  // свет фар
  const sp = new THREE.SpotLight(0xfff0d0, 60, 35, 0.5, 0.5, 1.2); sp.position.set(0, 0.7, front); sp.target.position.set(0, 0, front + 10);
  g.add(sp, sp.target);
  return g;
}
