// Персонажи: реалистичные модели Mixamo (Adobe) с анимациями + самодельный волк
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeWeaponProp } from './weapons3d.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

import { CLASSES } from './config.js';
const BASE = 'assets/mixamo/';
const CLASS_WEAPONS = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.weapons]));
// model — файл с моделью; height — рост (м); anims — какие файлы анимаций для каких действий: [файл, длительность]
// Общий набор анимаций игроков (снят на одном скелете Mixamo и подходит всем четырём)
const PLAYER_ANIMS = {
  idle: 'a_idle', run: 'a_run', idle_rifle: 'a_rifle_idle', run_rifle: 'a_rifle_run', idle_pistol: 'a_pistol_idle', run_pistol: 'a_pistol_run',
  idle_sword: 'a_sword_idle', run_sword: 'a_sword_run', jump: 'a_jump', down: 'a_death', die: 'a_death', drive: 'a_drive', sit: 'a_sit', fall: 'a_fall',
  hit: ['a_hit', 0.6], cheer: ['a_cheer', 3.0], slash: ['a_sword_slash', 0.6], slash1h: ['a_slash1h', 0.6], combo: ['a_sword_combo', 1.1],
  spin: ['a_sword_spin', 2.0], smoke: ['a_smoking', 7], throw: ['a_throw', 0.5], cast: ['a_cast', 0.8],
};
const DEFS = {
  juggernaut: { model: 'c_juggernaut.glb', height: 1.92, metal: 0.3, anims: PLAYER_ANIMS },
  sector: { model: 'c_sector.glb', height: 1.85, metal: 0.2, anims: PLAYER_ANIMS },
  rider: { model: 'c_rider.glb', height: 1.85, anims: PLAYER_ANIMS },
  shinobi: { model: 'c_shinobi.glb', height: 1.8, anims: PLAYER_ANIMS },
  minion: {
    model: 'zombie_idle', height: 1.8,
    anims: { idle: 'zombie_idle', run: 'zombie_run', die: 'zombie_death', down: 'zombie_death', hit: ['zombie_hit', 0.5], enemy: ['zombie_attack', 1.1] },
  },
  minion2: {
    model: 'warzombie_idle', height: 1.8,
    anims: { idle: 'warzombie_idle', run: 'zombie_run', die: 'zombie_death', down: 'zombie_death', hit: ['zombie_hit', 0.7], enemy: ['zombie_attack2', 1.4] },
  },
  skeleton: {
    model: 'ganfaul_idle', height: 1.95, metal: 0.3,
    anims: { idle: 'ganfaul_idle', run: 'zombie_run', die: 'zombie_death', down: 'zombie_death', hit: ['zombie_hit', 0.7], enemy: ['zombie_attack2', 1.4] },
  },
  boss: {
    model: 'boss_idle', height: 4.4,
    anims: { idle: 'boss_idle', run: 'boss_run', die: 'boss_death', down: 'boss_death', hit: ['boss_hit', 0.8], bossHit: ['boss_swipe', 1.2], slam: ['boss_slam', 1.6] },
  },
  elder: { model: 'elder_idle', height: 1.8, anims: { idle: 'elder_idle' } },
};

const loaded = {}; // kind -> { scene, height, clips: {action: clip} }
const fileCache = new Map();
const cleanName = (n) => n.replace(/^mixamorig\d*:?/, '');

const gltfLoader = new GLTFLoader();
function loadFBX(loader, name) {
  if (!fileCache.has(name)) {
    // .glb — сжатые модели персонажей; приводим к виду, как у FBX: группа + animations
    const p = name.endsWith('.glb')
      ? gltfLoader.loadAsync(BASE + name).then((g) => { g.scene.animations = g.animations; return g.scene; })
      : loader.loadAsync(`${BASE}${name}.fbx`);
    fileCache.set(name, p);
  }
  return fileCache.get(name);
}

// Некоторые модели состоят из сотен кусков с общими вершинами и одним материалом — склеиваем их,
// иначе каждый кусок рисуется отдельным вызовом (у одной модели их было 264)
function mergeSkinnedParts(scene) {
  const ids = new WeakMap(); let next = 1;
  const id = (o) => { if (!ids.has(o)) ids.set(o, next++); return ids.get(o); };
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || Array.isArray(o.material) || !o.geometry.index) return;
    const k = [o.material.map ? o.material.map.uuid : o.material.color.getHexString(), id(o.geometry.attributes.position), id(o.parent), o.skeleton.bones.map((b) => b.name).join(",")].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const total = list.reduce((n, o) => n + o.geometry.index.count, 0), idx = new Uint32Array(total);
    let off = 0;
    for (const o of list) { idx.set(o.geometry.index.array, off); off += o.geometry.index.count; }
    const first = list[0], g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(first.geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    first.geometry = g;
    for (const o of list.slice(1)) o.parent.remove(o);
  }
}

export async function loadModels(onProgress) {
  const loader = new FBXLoader();
  const files = new Set();
  for (const d of Object.values(DEFS)) { files.add(d.model); for (const a of Object.values(d.anims)) files.add(Array.isArray(a) ? a[0] : a); }
  let done = 0;
  const total = files.size;
  await Promise.all([...files].map((f) => loadFBX(loader, f).then(() => onProgress?.(++done / total))));

  for (const [kind, d] of Object.entries(DEFS)) {
    const src = await loadFBX(loader, d.model);
    const scene = src; // FBX-группа
    scene.traverse((o) => {
      o.name = cleanName(o.name);
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
          const sm = new THREE.MeshStandardMaterial({
            map: m.map || null, normalMap: m.normalMap || null, color: m.map ? 0xffffff : m.color,
            roughness: 0.65, metalness: d.metal || 0.05, transparent: m.transparent, alphaTest: m.transparent ? 0.3 : 0, side: THREE.FrontSide,
          });
          if (sm.map) sm.map.colorSpace = THREE.SRGBColorSpace;
          return sm;
        });
        o.material = Array.isArray(o.material) ? mats : mats[0];
      }
    });
    mergeSkinnedParts(scene);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    scene.traverse((o) => { if (o.isSkinnedMesh) box.expandByObject(o, true); });
    if (box.isEmpty()) box.setFromObject(scene, true);
    const clips = {};
    for (const [action, spec] of Object.entries(d.anims)) {
      const file = Array.isArray(spec) ? spec[0] : spec;
      const a = await loadFBX(loader, file);
      if (!a.animations[0]) continue;
      const clip = a.animations[0].clone();
      clip.name = action;
      for (const t of clip.tracks) {
        const [node, prop] = t.name.split('.');
        t.name = cleanName(node) + '.' + prop;
      }
      // убираем смещение корня (рывки и вихрь не должны уводить модель от позиции игрока)
      const hip = clip.tracks.find((t) => t.name.endsWith('Hips.position'));
      if (hip) { const v = hip.values, n = v.length; if (Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) > 20) for (let i = 0; i < n; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; } }
      clips[action] = { clip, dur: Array.isArray(spec) ? spec[1] : 0 };
    }
    loaded[kind] = { scene, height: box.max.y - box.min.y, clips };
  }
}

function newRig(type) {
  const rig = { type, root: new THREE.Group(), body: new THREE.Group(), mats: [], flash: 0, labelH: 2.4, phase: Math.random() * 6, idleT: Math.random() * 6, attackT: -1 };
  rig.root.add(rig.body);
  return rig;
}

function mixamoRig(kind, seed) {
  const key = kind === 'minion' && seed % 2 ? 'minion2' : kind;
  const def = DEFS[key];
  const src = loaded[key];
  const rig = newRig('gltf');
  const model = SkeletonUtils.clone(src.scene);
  model.scale.setScalar(def.height / src.height);
  rig.body.add(model);
  rig.labelH = def.height + 0.3;
  rig.isSkeleton = false;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) rig.mats.push(m);
  });
  // оружие в правой руке (переключается rig.setWeapon)
  rig.props = {}; rig.stance = 'none'; rig.mode = '';
  const hand = model.getObjectByName('RightHand');
  if (hand && CLASS_WEAPONS[kind]) {
    const srcHand = src.scene.getObjectByName('RightHand');
    const k = 1 / (srcHand.getWorldScale(new THREE.Vector3()).x * model.scale.x); // кость → метры
    for (const w of CLASS_WEAPONS[kind]) {
      const prop = makeWeaponProp(w.id);
      if (!prop) continue;
      prop.scale.multiplyScalar(k); prop.position.multiplyScalar(k);
      prop.visible = false; hand.add(prop); rig.props[w.id] = prop;
      prop.traverse((o) => { if (o.isMesh) rig.mats.push(o.material); });
    }
  }
  rig.hand = hand;
  rig.setWeapon = (id, stance) => { for (const [k2, p] of Object.entries(rig.props)) p.visible = k2 === id; if (rig.stance !== stance) { rig.stance = stance; rig.baseName = null; } };
  rig.mixer = new THREE.AnimationMixer(model);
  rig.actions = {};
  rig.clipInfo = src.clips;
  rig.act = (name) => {
    if (!rig.actions[name]) {
      const c = src.clips[name];
      if (!c) return null;
      rig.actions[name] = rig.mixer.clipAction(c.clip);
    }
    return rig.actions[name];
  };
  rig.current = null; rig.lockT = 0; rig.dead = false;
  switchTo(rig, rig.act('idle'), 0, true);
  rig.mixer.update(Math.random() * 2);
  return rig;
}

function switchTo(rig, a, fade, loop, dur) {
  if (!a) return;
  a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  a.clampWhenFinished = !loop;
  a.timeScale = dur ? a.getClip().duration / dur : 1;
  if (rig.current === a) { a.reset().setEffectiveWeight(1).play(); return; }
  a.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (rig.current) rig.current.fadeOut(fade);
  rig.current = a;
}
function playOnce(rig, action) {
  const info = rig.clipInfo[action];
  const a = rig.act(action);
  if (!a || !info) return false;
  const dur = info.dur || 0.6;
  switchTo(rig, a, 0.1, false, dur);
  rig.lockT = dur * 0.92;
  rig.baseName = null;
  return true;
}

export function playAttack(rig, kind) {
  if (rig.type === 'quad') { rig.attackT = 0; return; }
  if (rig.type !== 'gltf' || rig.dead) return;
  if (!playOnce(rig, kind)) playOnce(rig, 'enemy') || playOnce(rig, 'slash') || playOnce(rig, 'fireball');
}
export function playHit(rig) {
  rig.flash = 0.12;
  if (rig.type === 'gltf' && rig.lockT <= 0 && !rig.dead && !rig.downed) playOnce(rig, 'hit');
}
export function playCheer(rig) { if (rig.type === 'gltf' && !rig.downed) playOnce(rig, 'cheer'); }
export function playDeath(rig) {
  rig.dead = true;
  if (rig.type === 'quad') return;
  switchTo(rig, rig.act('die'), 0.12, false);
  rig.lockT = Infinity;
}

export function animateRig(rig, dt, moving, downed, airborne = false) {
  rig.idleT += dt;
  if (rig.flash > 0) rig.flash -= dt;
  const fl = rig.flash > 0;
  if (fl !== rig._fl) {
    rig._fl = fl;
    for (const m of rig.mats) if (m.emissive && !m.userData.glow) m.emissive.setHex(fl ? 0x551515 : 0x000000);
  }
  if (rig.type === 'quad') return animateWolf(rig, dt, moving);

  rig.lockT -= dt;
  if (!rig.dead) {
    if (downed !== !!rig.downed) { rig.downed = downed; rig.baseName = null; rig.lockT = 0; }
    if (rig.lockT <= 0) {
      const st = rig.stance && rig.stance !== 'none' ? '_' + rig.stance : '';
      let base = downed ? 'down'
        : rig.mode && rig.clipInfo[rig.mode] ? rig.mode
        : airborne && rig.clipInfo.jump ? 'jump'
        : moving ? (rig.clipInfo['run' + st] ? 'run' + st : 'run')
        : (rig.clipInfo['idle' + st] ? 'idle' + st : 'idle');
      if (!rig.clipInfo[base]) base = 'idle';
      if (rig.baseName !== base) {
        rig.baseName = base;
        switchTo(rig, rig.act(base), 0.2, base !== 'down');
      }
    }
  }
  rig.mixer.update(dt);
}

// ---------- Волк (самодельный) ----------
function std(rig, color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
  if (opts.emissive) m.userData.glow = true;
  rig.mats.push(m);
  return m;
}
function part(geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true;
  return m;
}
function makeWolf(seed) {
  const rig = newRig('quad');
  const palette = [[0x6a655d, 0x3d3833, 0xb8ae9e], [0x55504a, 0x2c2824, 0xa49a8a], [0x7e7466, 0x4a4037, 0xd0c4b0]][seed % 3];
  const fur = std(rig, palette[0]), dark = std(rig, palette[1]), light = std(rig, palette[2]);
  const nose = std(rig, 0x111111), eye = std(rig, 0xffc830, { emissive: 0xaa6a00 }), tooth = std(rig, 0xf4f0e6);
  const sph = new THREE.SphereGeometry(1, 14, 10), cone = new THREE.ConeGeometry(1, 1, 6), cyl = new THREE.CylinderGeometry(1, 0.8, 1, 8);
  const b = rig.body;
  b.add(part(sph, fur, 0, 0.88, 0.25, 0.36, 0.38, 0.55));
  b.add(part(sph, fur, 0, 0.84, -0.35, 0.3, 0.32, 0.45));
  b.add(part(sph, light, 0, 0.7, 0.2, 0.28, 0.24, 0.42));
  b.add(part(sph, dark, 0, 1.08, 0.05, 0.22, 0.12, 0.6));
  for (let i = 0; i < 5; i++) b.add(part(cone, dark, 0, 1.12 + (i % 2) * 0.03, 0.42 - i * 0.12, 0.09, 0.22, 0.09));
  rig.head = new THREE.Group(); rig.head.position.set(0, 1.08, 0.72); b.add(rig.head);
  rig.head.add(part(sph, fur, 0, 0.02, 0.05, 0.24, 0.22, 0.26));
  rig.head.add(part(sph, light, 0, -0.06, 0.12, 0.2, 0.14, 0.2));
  const snout = new THREE.Group(); snout.position.set(0, -0.04, 0.28); rig.head.add(snout);
  snout.add(part(cyl, fur, 0, 0, 0.1, 0.1, 0.26, 0.09).rotateX(Math.PI / 2));
  snout.add(part(sph, nose, 0, 0.03, 0.24, 0.05, 0.04, 0.04));
  rig.jaw = new THREE.Group(); rig.jaw.position.set(0, -0.08, 0.02); snout.add(rig.jaw);
  rig.jaw.add(part(new THREE.BoxGeometry(1, 1, 1), light, 0, -0.02, 0.1, 0.13, 0.05, 0.22));
  for (const x of [-0.04, 0.04]) rig.jaw.add(part(cone, tooth, x, 0.02, 0.18, 0.012, 0.05, 0.012));
  for (const x of [-0.1, 0.1]) {
    rig.head.add(part(cone, dark, x, 0.25, -0.02, 0.07, 0.18, 0.05));
    rig.head.add(part(sph, eye, x * 0.95, 0.07, 0.24, 0.035, 0.03, 0.02));
  }
  rig.tail = new THREE.Group(); rig.tail.position.set(0, 0.98, -0.75); b.add(rig.tail);
  rig.tail.add(part(sph, fur, 0, -0.05, -0.22, 0.1, 0.1, 0.28), part(sph, light, 0, -0.08, -0.46, 0.07, 0.07, 0.1));
  rig.tail.rotation.x = 0.7;
  rig.legs = [];
  for (const [x, z, ph, front] of [[-0.17, 0.42, 0, 1], [0.17, 0.42, Math.PI, 1], [-0.16, -0.5, Math.PI, 0], [0.16, -0.5, 0, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x, 0.85, z); hip.ph = ph;
    hip.add(part(sph, fur, 0, -0.12, 0, 0.1, front ? 0.22 : 0.26, front ? 0.11 : 0.15));
    const knee = new THREE.Group(); knee.position.set(0, -0.32, front ? 0 : -0.04); hip.add(knee);
    knee.add(part(cyl, dark, 0, -0.2, 0, 0.055, 0.42, 0.055));
    knee.add(part(sph, dark, 0, -0.43, 0.04, 0.07, 0.04, 0.09));
    hip.knee = knee; hip.front = front;
    b.add(hip); rig.legs.push(hip);
  }
  rig.root.scale.setScalar(1.05);
  rig.labelH = 1.7;
  return rig;
}
function animateWolf(rig, dt, moving) {
  const mv = moving ? 1 : 0;
  rig.phase += dt * 11 * mv;
  for (const l of rig.legs) {
    const s = Math.sin(rig.phase + l.ph) * mv;
    l.rotation.x = s * 0.6;
    l.knee.rotation.x = (l.front ? -1 : 1) * Math.max(0, -Math.cos(rig.phase + l.ph)) * 0.6 * mv;
  }
  let at = -1;
  if (rig.attackT >= 0) { rig.attackT += dt / 0.35; if (rig.attackT >= 1) rig.attackT = -1; else at = rig.attackT; }
  const lunge = at >= 0 ? Math.sin(at * Math.PI) : 0;
  rig.head.position.z = 0.72 + lunge * 0.3;
  rig.head.rotation.x = -lunge * 0.35 + Math.sin(rig.idleT * 1.5) * 0.04 * (1 - mv);
  rig.jaw.rotation.x = lunge * 0.6;
  rig.tail.rotation.y = Math.sin(rig.idleT * (moving ? 9 : 3)) * 0.35;
  rig.tail.rotation.x = 0.7 - mv * 0.3;
  rig.body.position.y = Math.abs(Math.sin(rig.phase)) * 0.06 * mv + Math.sin(rig.idleT * 2) * 0.01;
  rig.body.rotation.x = Math.sin(rig.phase * 2) * 0.03 * mv;
  if (rig.dead) rig.body.rotation.z = Math.min(Math.PI / 2, rig.body.rotation.z + dt * 5);
}

export function makeCharacter(kind, seed = 0) {
  const rig = kind === 'wolf' ? makeWolf(seed) : mixamoRig(kind, seed);
  rig.kind = kind;
  if (CLASSES[kind]) addAura(rig);
  return rig;
}
function addAura(rig) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.15, depthWrite: false }));
  m.position.y = 1.0; m.visible = false;
  rig.root.add(m); rig.aura = m;
}
