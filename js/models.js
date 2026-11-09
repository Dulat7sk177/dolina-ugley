// Персонажи: реалистичные модели Mixamo (Adobe) с анимациями + самодельный волк
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BASE = 'assets/mixamo/';
// model — файл с моделью; height — рост (м); anims — какие файлы анимаций для каких действий: [файл, длительность]
const DEFS = {
  warrior: {
    model: 'warrior_idle', height: 1.85, metal: 0.45,
    anims: { idle: 'warrior_idle', run: 'warrior_run', jump: 'warrior_jump', down: 'warrior_death', die: 'warrior_death', hit: ['warrior_hit', 0.6], cheer: ['warrior_cheer', 4.0], slash: ['warrior_slash', 0.75], spin: ['warrior_spin', 0.95], shield: ['warrior_block', 0.6] },
  },
  mage: {
    model: 'mage_idle', height: 1.8, staff: true,
    anims: { idle: 'mage_idle', run: 'mage_run', jump: 'mage_jump', down: 'mage_death', die: 'mage_death', hit: ['mage_hit', 0.7], cheer: ['mage_cheer', 4.0], fireball: ['mage_fireball', 0.9], heal: ['mage_heal', 1.3], nova: ['mage_nova', 1.2] },
  },
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

function loadFBX(loader, name) {
  if (!fileCache.has(name)) fileCache.set(name, loader.loadAsync(`${BASE}${name}.fbx`));
  return fileCache.get(name);
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

// Посох мага: дерево + светящийся кристалл
function makeStaff() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.8 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.7, 8), wood);
  shaft.position.y = 0.25; g.add(shaft);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x3ab8ff, emissiveIntensity: 3, roughness: 0.2 }));
  crystal.scale.y = 1.6; crystal.position.y = 1.17; crystal.userData.glow = true; g.add(crystal);
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.16, 4), wood); p.position.set(Math.cos(i * 2.1) * 0.05, 1.1, Math.sin(i * 2.1) * 0.05); p.rotation.set(Math.sin(i * 2.1) * 0.4, 0, -Math.cos(i * 2.1) * 0.4); g.add(p); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
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
  if (def.staff) {
    const hand = model.getObjectByName('RightHand');
    if (hand) {
      const st = makeStaff();
      const srcHand = src.scene.getObjectByName('RightHand');
      const hs = srcHand.getWorldScale(new THREE.Vector3()).x * model.scale.x; // во сколько раз кость меньше метра
      const k = 1 / hs;
      st.scale.setScalar(k);
      st.rotation.set(Math.PI / 2, 0, 0);
      st.position.set(0, 0.08 * k, 0.02 * k);
      hand.add(st);
      st.traverse((o) => { if (o.isMesh) rig.mats.push(o.material); });
    }
  }
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
      let base = downed ? 'down' : airborne && rig.clipInfo.jump ? 'jump' : moving && rig.clipInfo.run ? 'run' : 'idle';
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
  if (kind === 'warrior' || kind === 'mage') addAura(rig);
  return rig;
}
function addAura(rig) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.15, depthWrite: false }));
  m.position.y = 1.0; m.visible = false;
  rig.root.add(m); rig.aura = m;
}
