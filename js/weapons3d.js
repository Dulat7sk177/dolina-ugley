// Модели оружия, собранные из простых форм. Ствол/клинок направлен вдоль +Z, рукоять — у начала координат.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.85, roughness: 0.35 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.18 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.6 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: 0.7 }),
  blade: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.95, roughness: 0.2 }),
  wrap: new THREE.MeshStandardMaterial({ color: 0x241818, roughness: 0.9 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xb8902a, metalness: 0.9, roughness: 0.3 }),
};
const B = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
const CYL = (r, l, x = 0, y = 0, z = 0, seg = 10) => new THREE.CylinderGeometry(r, r, l, seg).rotateX(Math.PI / 2).translate(x, y, z).toNonIndexed();
function group(parts) {
  const g = new THREE.Group();
  const byMat = new Map();
  for (const [m, geo] of parts) { if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(geo); }
  for (const [m, geos] of byMat) { const mesh = new THREE.Mesh(mergeGeometries(geos), m.clone()); mesh.castShadow = true; g.add(mesh); }
  return g;
}

// Положение в ладони: подобрано под кость RightHand скелета Mixamo
const HOLD = {
  gun: { pos: [0.0, 0.09, 0.03], rot: [-Math.PI / 2, 0, Math.PI / 2] },
  blade: { pos: [0.0, 0.08, 0.02], rot: [-Math.PI / 2, 0, Math.PI / 2] },
};

const BUILD = {
  shotgun: () => group([
    [M.steel, CYL(0.022, 0.75, 0, 0.05, 0.42)], [M.steel, CYL(0.02, 0.62, 0, 0.012, 0.36)],
    [M.wood, B(0.05, 0.05, 0.3, 0, 0.012, 0.32)], // цевьё
    [M.steel, B(0.055, 0.09, 0.26, 0, 0.03, 0.02)], // ствольная коробка
    [M.polymer, B(0.04, 0.12, 0.05, 0, -0.06, 0.0)], // рукоять
    [M.wood, B(0.05, 0.1, 0.32, 0, -0.01, -0.26).rotateX(0.12)], // приклад
  ]),
  rifle: () => group([
    [M.steel, CYL(0.012, 0.42, 0, 0.04, 0.5)], [M.polymer, B(0.05, 0.07, 0.34, 0, 0.035, 0.24)], // ствол и цевьё
    [M.polymer, B(0.06, 0.1, 0.3, 0, 0.03, -0.02)], [M.polymer, B(0.03, 0.035, 0.25, 0, 0.1, 0.02)], // коробка и планка
    [M.steel, B(0.04, 0.05, 0.12, 0, 0.14, 0.02)], // прицел
    [M.polymer, B(0.04, 0.16, 0.07, 0, -0.09, 0.08).rotateX(0.2)], // магазин
    [M.polymer, B(0.035, 0.11, 0.045, 0, -0.06, -0.06)], // рукоять
    [M.polymer, B(0.045, 0.09, 0.26, 0, 0.02, -0.28)], // приклад
  ]),
  revolver: () => group([
    [M.chrome, CYL(0.014, 0.2, 0, 0.05, 0.14)], [M.chrome, CYL(0.035, 0.06, 0, 0.035, 0.03, 8)],
    [M.chrome, B(0.03, 0.05, 0.1, 0, 0.04, -0.02)], [M.wood, B(0.03, 0.11, 0.045, 0, -0.03, -0.05).rotateX(-0.25)],
  ]),
  machete: () => group([
    [M.wrap, B(0.03, 0.035, 0.14, 0, 0, -0.02)], [M.steel, B(0.05, 0.012, 0.02, 0, 0, 0.06)],
    [M.blade, B(0.006, 0.07, 0.5, 0, 0.012, 0.32)], [M.blade, new THREE.ConeGeometry(0.035, 0.08, 4).rotateX(Math.PI / 2).scale(0.2, 1, 1).translate(0, 0.012, 0.61).toNonIndexed()],
  ]),
  katana: () => group([
    [M.wrap, B(0.028, 0.032, 0.26, 0, 0, -0.04)], [M.gold, CYL(0.04, 0.012, 0, 0, 0.1, 12)],
    [M.blade, B(0.005, 0.032, 0.78, 0, 0.012, 0.5)], [M.blade, B(0.005, 0.03, 0.06, 0, 0.022, 0.92).rotateX(-0.25)],
  ]),
  kunai: () => group([
    [M.wrap, CYL(0.012, 0.1, 0, 0, -0.01)], [M.steel, new THREE.TorusGeometry(0.02, 0.005, 6, 12).translate(0, 0, -0.08).toNonIndexed()],
    [M.steel, new THREE.ConeGeometry(0.028, 0.16, 4).rotateX(Math.PI / 2).scale(1, 0.25, 1).translate(0, 0, 0.12).toNonIndexed()],
  ]),
};
const KIND = { shotgun: 'gun', rifle: 'gun', revolver: 'gun', machete: 'blade', katana: 'blade', kunai: 'blade' };

export function makeWeaponProp(id) {
  if (!BUILD[id]) return null;
  const inner = BUILD[id]();
  const g = new THREE.Group(); g.add(inner);
  const h = HOLD[KIND[id]];
  g.position.set(...h.pos); g.rotation.set(...h.rot);
  g.userData.inner = inner;
  return g;
}
// Отдельная модель куная для брошенных/воткнутых
export function makeKunaiMesh() { return BUILD.kunai(); }
