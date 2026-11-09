// Оружие игрока, прицеливание, трассеры, кошка, рывки, кунаи, молния и машина Rider'а (клиентская часть)
import * as THREE from 'three';
import { CLASSES } from './config.js';
import { makeKunaiMesh } from './weapons3d.js';
import { makeChallenger } from './cityprops.js';
import { playAttack } from './models.js';

let C = null; // контекст из main.js
const W = { idx: 0, ammo: [0, 0], cd: [0, 0], alt: [0, 0], reloadT: 0, held: false, altHeld: false, altEdge: false, dashT: 0, dashDir: 0, spinT: 0, hook: null, smokeT: 0, regen: 0 };
const r2 = (n) => Math.round(n * 100) / 100;
const lerpAngle = (a, b, t) => { let d = (b - a + Math.PI) % (Math.PI * 2); if (d < 0) d += Math.PI * 2; return a + (d - Math.PI) * t; };
const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

export function initCombat(ctx) { C = ctx; }
export function setClass(cls) {
  const c = CLASSES[cls];
  W.idx = 0; W.ammo = c.weapons.map((w) => w.primary.mag || 0); W.cd = [0, 0]; W.alt = [0, 0];
  applyWeaponVisual();
}
export const weapon = () => CLASSES[C.me.cls].weapons[W.idx];
export const weaponIndex = () => W.idx;
function applyWeaponVisual() { const w = weapon(); C.me.rig?.setWeapon?.(w.id, w.stance); }
export function switchWeapon(i) {
  const n = CLASSES[C.me.cls].weapons.length;
  i = ((i % n) + n) % n;
  if (i === W.idx || W.dashT > 0 || W.spinT > 0) return;
  W.idx = i; W.reloadT = 0; applyWeaponVisual();
}
export function reload() {
  const p = weapon().primary;
  if (!p.mag || p.regen || W.reloadT > 0 || W.ammo[W.idx] >= p.mag) return;
  W.reloadT = p.reload;
}

// ===== ввод =====
export function onKey(code) {
  if (code === 'Digit1') switchWeapon(0);
  else if (code === 'Digit2') switchWeapon(1);
  else if (code === 'KeyQ') switchWeapon(W.idx + 1);
  else if (code === 'KeyR') reload();
  else if (code === 'KeyF') { W.altEdge = true; }
}
export function onMouse(btn, down) {
  if (btn === 0) W.held = down;
  if (btn === 2) { W.altHeld = down; if (down) W.altEdge = true; }
}
export function releaseAll() { W.held = false; W.altHeld = false; W.altEdge = false; }

// ===== прицел: точка, куда смотрит центр экрана =====
export function aim(max) {
  const cam = C.camera;
  cam.getWorldDirection(dir);
  const start = Math.max(1, C.cam.cur || C.cam.dist);
  for (let t = start; t < start + max; t += 0.5) {
    const x = cam.position.x + dir.x * t, y = cam.position.y + dir.y * t, z = cam.position.z + dir.z * t;
    if (y < C.getHeight(x, z) + 0.05 || C.cameraBlocked(x, y, z)) return { p: new THREE.Vector3(x, y, z), hit: true };
  }
  const t = start + max;
  return { p: new THREE.Vector3(cam.position.x + dir.x * t, cam.position.y + dir.y * t, cam.position.z + dir.z * t), hit: false };
}
function chest() {
  const me = C.me, rx = -Math.cos(C.cam.yaw), rz = Math.sin(C.cam.yaw);
  return new THREE.Vector3(me.x + rx * 0.25, me.y + 1.45, me.z + rz * 0.25);
}
function faceAim() { C.me.faceT = 0.5; C.me.ry = C.cam.yaw; }

// ===== выстрел/удар =====
function canAct() { const me = C.me; return C.G.started && !me.downed && !C.G.chatOpen && !inCar() && C.isLocked(); }
function primary() {
  const w = weapon(), p = w.primary;
  if (W.cd[W.idx] > 0 || W.reloadT > 0) return;
  if (p.mag && W.ammo[W.idx] <= 0) { if (!p.regen) reload(); return; }
  W.cd[W.idx] = p.cd;
  faceAim();
  const base = { t: 'atk', w: W.idx, ry: r2(C.cam.yaw) };
  if (p.kind === 'shot') {
    const o = chest(), a = aim(p.range + 10), d = a.p.clone().sub(o).normalize();
    W.ammo[W.idx]--;
    C.send({ ...base, kind: 'shot', o: [r2(o.x), r2(o.y), r2(o.z)], d: [r2(d.x), r2(d.y), r2(d.z)] });
    muzzle(o, d, w.id === 'shotgun' ? 1.6 : 1);
    C.cam.pitch = Math.max(-1.2, C.cam.pitch - (w.id === 'shotgun' ? 0.04 : w.id === 'revolver' ? 0.03 : 0.008));
    if (W.ammo[W.idx] <= 0) reload();
  } else if (p.kind === 'melee') {
    C.send({ ...base, kind: 'melee' });
    anim(p.anim || 'slash');
  } else if (p.kind === 'kunai') {
    const o = chest(), a = aim(60), d = a.p.clone().sub(o).normalize();
    W.ammo[W.idx]--;
    C.send({ ...base, kind: 'kunai', o: [r2(o.x), r2(o.y), r2(o.z)], d: [r2(d.x), r2(d.y), r2(d.z)] });
    anim('throw');
  } else if (p.kind === 'blink') blink(p);
  else if (p.kind === 'summon') { W.cd[W.idx] = 1; summon(); }
}
function alt() {
  const w = weapon(), a = w.alt;
  if (W.alt[W.idx] > 0) return;
  W.alt[W.idx] = a.cd || 0;
  const base = { t: 'atk', w: W.idx, alt: 1, ry: r2(C.cam.yaw) };
  switch (a.kind) {
    case 'grenade': {
      faceAim();
      const o = chest(), t = aim(40), d = t.p.clone().sub(o).normalize();
      C.send({ ...base, kind: 'grenade', o: [r2(o.x), r2(o.y), r2(o.z)], d: [r2(d.x), r2(d.y), r2(d.z)] });
      muzzle(o, d, 2.2);
      break;
    }
    case 'dash': W.dashT = a.dur; W.dashDir = C.cam.yaw; C.me.ry = W.dashDir; C.send({ ...base, kind: 'dash' }); anim('combo'); break;
    case 'spin': W.spinT = a.dur; C.send({ ...base, kind: 'spin' }); anim('spin'); break;
    case 'smoke': W.smokeT = 7; C.send({ ...base, kind: 'smoke' }); anim('smoke'); break;
    case 'hook': {
      const t = aim(a.range);
      const o = chest();
      if (t.hit) { W.hook = { to: t.p, t: 0 }; C.me.vy = 0; C.send({ ...base, kind: 'hook', to: [r2(t.p.x), r2(t.p.y), r2(t.p.z)] }); }
      rope(o, t.p, t.hit ? 0 : 0.25);
      break;
    }
    case 'kunaiTp': C.send({ ...base, kind: 'kunaiTp' }); break;
    case 'blink': blink(a); break;
    case 'summon': W.alt[W.idx] = 1; summon(); break;
  }
}
function blink(spec) {
  const t = aim(spec.range);
  let p = t.p;
  if (!t.hit) { const g = Math.max(C.getHeight(p.x, p.z), C.roofAt(p.x, p.z, p.y + 50)); p = new THREE.Vector3(p.x, g, p.z); }
  const dx = p.x - C.me.x, dz = p.z - C.me.z, d = Math.hypot(dx, dz);
  if (d > spec.range) { p.x = C.me.x + (dx / d) * spec.range; p.z = C.me.z + (dz / d) * spec.range; }
  const ground = Math.max(C.getHeight(p.x, p.z), C.roofAt(p.x, p.z, p.y + 0.5));
  p.y = Math.max(ground, p.y - 1.6);
  faceAim();
  C.send({ t: 'atk', w: W.idx, alt: 0, kind: 'blink', to: [r2(p.x), r2(p.y), r2(p.z)], ry: r2(C.cam.yaw) });
  anim('cast');
}
function summon() {
  const st = C.G.state?.pl.find((p) => p.id === C.G.myId);
  if (st && st.cc > 0) { C.addChat(null, `Машина будет готова через ${st.cc} с`); return; }
  if (C.G.state?.cars?.some((c) => c[1] === C.G.myId)) { C.addChat(null, 'Ваш Challenger уже ждёт — подойдите и нажмите E'); return; }
  C.send({ t: 'summon' });
}
function anim(kind) { C.me.a++; C.me.ak = kind; C.onAttackAnim(C.me.rig, kind); }

// ===== каждый кадр =====
export function update(dt) {
  const w = weapon(), p = w.primary;
  for (let i = 0; i < 2; i++) { W.cd[i] = Math.max(0, W.cd[i] - dt); W.alt[i] = Math.max(0, W.alt[i] - dt); }
  if (W.reloadT > 0) { W.reloadT -= dt; if (W.reloadT <= 0) { W.reloadT = 0; W.ammo[W.idx] = p.mag; } }
  // кунаи восстанавливаются сами
  const ci = CLASSES[C.me.cls].weapons.findIndex((x) => x.primary.regen);
  if (ci >= 0) { const pr = CLASSES[C.me.cls].weapons[ci].primary; if (W.ammo[ci] < pr.mag) { W.regen += dt; if (W.regen >= pr.regen) { W.regen = 0; W.ammo[ci]++; } } else W.regen = 0; }
  if (canAct()) {
    if (W.held && (p.auto || W.cd[W.idx] <= 0)) primary();
    if (W.altEdge || (W.altHeld && w.alt.kind === 'hook' && !W.hook)) { if (W.altEdge) alt(); }
  }
  W.altEdge = false;
  if (W.spinT > 0) W.spinT -= dt;
  if (W.smokeT > 0) {
    W.smokeT -= dt;
    if (Math.random() < dt * 8) C.fx.smoke.emit(C.me.x + Math.sin(C.me.ry) * 0.25, C.me.y + 1.72, C.me.z + Math.cos(C.me.ry) * 0.25, (Math.random() - 0.5) * 0.2, 0.5, (Math.random() - 0.5) * 0.2, 0xdedede, 0.12, 2, { grow: 0.35, alpha: 0.5 });
  }
  updateFx(dt);
  updateCars(dt);
}
export const speedMul = () => (W.spinT > 0 ? 0.5 : 1);

// Особые движения: рывок, полёт на кошке, машина. true — обычное управление отключено
export function moveOverride(dt) {
  const me = C.me;
  if (inCar()) return true;
  if (W.dashT > 0) {
    W.dashT -= dt;
    const sp = weapon().alt.speed || 13;
    me.x += Math.sin(W.dashDir) * sp * dt; me.z += Math.cos(W.dashDir) * sp * dt;
    me.ry = W.dashDir; me.moving = true;
    return true;
  }
  if (W.hook) {
    const h = W.hook; h.t += dt;
    const to = h.to, dx = to.x - me.x, dy = to.y - 1.0 - me.y, dz = to.z - me.z, d = Math.hypot(dx, dy, dz);
    const sp = 30 * dt;
    me.rig.mode = 'fall';
    if (d < 1.2 || h.t > 1.4) {
      W.hook = null; me.rig.mode = '';
      // залезаем на крышу, если зацепились у края
      const fx = Math.sin(me.ry), fz = Math.cos(me.ry);
      const top = C.roofAt(to.x + fx * 1.0, to.z + fz * 1.0, to.y + 2.5);
      if (top > -Infinity && top - to.y < 2.6) { me.x = to.x + fx * 1.0; me.z = to.z + fz * 1.0; me.y = top + 0.05; me.vy = 0; }
      else me.vy = 5;
      return true;
    }
    me.x += (dx / d) * sp; me.y += (dy / d) * sp; me.z += (dz / d) * sp; me.vy = 0;
    me.ry = Math.atan2(dx, dz);
    ropeLine(chest(), to);
    return true;
  }
  return false;
}
export const hooking = () => !!W.hook;

// ===== эффекты: трассеры, вспышки, верёвка, молния =====
const fxObjs = [];
function addLine(points, color, life, width = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, linewidth: width });
  const l = new THREE.Line(g, m); C.scene.add(l);
  fxObjs.push({ o: l, t: 0, life });
  return l;
}
function updateFx(dt) {
  for (let i = fxObjs.length - 1; i >= 0; i--) {
    const f = fxObjs[i]; f.t += dt;
    f.o.material.opacity = Math.max(0, 1 - f.t / f.life);
    if (f.t >= f.life) { C.scene.remove(f.o); f.o.geometry.dispose(); f.o.material.dispose(); if (f.light) C.scene.remove(f.light); fxObjs.splice(i, 1); }
    else if (f.light) f.light.intensity = f.base * (1 - f.t / f.life);
  }
}
let ropeObj = null;
function ropeLine(a, b) {
  if (!ropeObj) { ropeObj = addLine([a, b], 0x2a2a2a, 0.05); }
  ropeObj.geometry.setFromPoints([a, b]);
  const f = fxObjs.find((x) => x.o === ropeObj); if (f) f.t = 0; else ropeObj = null;
}
function rope(a, b, life) { if (life) addLine([a, b], 0x2a2a2a, life); }
function muzzle(o, d, k) {
  const m = o.clone().addScaledVector(d, 0.8);
  C.fx.burst(m.x, m.y, m.z, Math.round(6 * k), [0xfff2b0, 0xffb040], 2.5 * k, 0.16 * k, 0.12, { drag: 6 });
  C.fx.smoke.emit(m.x, m.y, m.z, d.x * 0.6, 0.3, d.z * 0.6, 0x9a9a9a, 0.2 * k, 0.6, { grow: 0.8, alpha: 0.35 });
}
function bolt(x, y, z) {
  const pts = []; let px = x + (Math.random() - 0.5) * 4, pz = z + (Math.random() - 0.5) * 4;
  for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector3(px + (x - px) * t + (Math.random() - 0.5) * 1.6 * (1 - t), y + 45 * (1 - t), pz + (z - pz) * t + (Math.random() - 0.5) * 1.6 * (1 - t))); }
  for (const c of [0xffffff, 0x9fd8ff]) addLine(pts.map((p) => p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3))), c, 0.35);
  const light = new THREE.PointLight(0xbfe6ff, 300, 40, 1.4); light.position.set(x, y + 3, z); C.scene.add(light);
  fxObjs.push({ o: addLine([pts[0], pts[0]], 0xffffff, 0.3), t: 0, life: 0.3, light, base: 300 });
  C.fx.shockwave(x, y, z, [0xcfeaff, 0xffffff, 0x7ac8ff], 12, 60);
  C.fx.burst(x, y + 0.5, z, 30, [0xffffff, 0x9fd8ff], 6, 0.25, 0.4, { gravity: -6, drag: 2 });
}

// ===== события от хоста =====
export function handleEvent(ev) {
  switch (ev.k) {
    case 'tr': {
      const o = new THREE.Vector3(...ev.o);
      for (let i = 0; i < ev.e.length; i += 3) {
        const e = new THREE.Vector3(ev.e[i], ev.e[i + 1], ev.e[i + 2]);
        addLine([o.clone().lerp(e, 0.03), e], ev.w === 'shotgun' ? 0xffd890 : 0xfff2c0, 0.09);
        C.fx.burst(e.x, e.y, e.z, 3, [0xffe0a0, 0x888888], 1.5, 0.1, 0.25, { gravity: -8 });
      }
      if (ev.pid !== C.G.myId) { const v = C.views.players.get(ev.pid); if (v) muzzle(o, new THREE.Vector3(ev.e[0] - o.x, ev.e[1] - o.y, ev.e[2] - o.z).normalize(), 1); }
      return true;
    }
    case 'rope': { if (ev.pid === C.G.myId) return true; const v = C.views.players.get(ev.pid); if (v && ev.to.length === 3) rope(v.pos.clone().setY(v.pos.y + 1.4), new THREE.Vector3(...ev.to), 0.6); return true; }
    case 'bolt': bolt(ev.x, ev.y, ev.z); return true;
    case 'carFx': C.fx.burst(ev.x, C.getHeight(ev.x, ev.z) + 1, ev.z, 30, [0x9a9a9a, 0x6a6a6a], 3, 0.9, 1.2, { smoke: true, grow: 1.5, alpha: 0.6 }); return true;
  }
  return false;
}

// ===== снаряды (гранаты, кунаи) =====
const projViews = new Map();
let grenadeGeo = null, grenadeMat = null;
export function applyProjectiles(list) {
  if (!grenadeGeo) { grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8); grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, metalness: 0.5, roughness: 0.5 }); }
  const seen = new Set();
  for (const [id, x, y, z, type, stuck, ry, rx] of list) {
    seen.add(id);
    let v = projViews.get(id);
    if (!v) {
      const o = type === 'k' ? makeKunaiMesh() : new THREE.Mesh(grenadeGeo, grenadeMat);
      if (type === 'k') o.scale.setScalar(1.6);
      o.position.set(x, y, z); C.scene.add(o);
      v = { o, type, tgt: new THREE.Vector3(x, y, z) }; projViews.set(id, v);
    }
    v.tgt.set(x, y, z); v.stuck = stuck;
    v.o.rotation.set(rx || 0, ry || 0, 0, 'YXZ');
  }
  for (const [id, v] of projViews) if (!seen.has(id)) { C.scene.remove(v.o); projViews.delete(id); }
}
export function updateProjectiles(dt) {
  for (const v of projViews.values()) {
    v.o.position.lerp(v.tgt, v.stuck ? 1 : 1 - Math.exp(-25 * dt));
    if (!v.stuck && v.type === 'g' && Math.random() < 0.6) C.fx.smoke.emit(v.o.position.x, v.o.position.y, v.o.position.z, 0, 0.2, 0, 0x8a8a8a, 0.12, 0.5, { grow: 0.5, alpha: 0.4 });
    if (!v.stuck && v.type === 'k' && Math.random() < 0.5) C.fx.glow.emit(v.o.position.x, v.o.position.y, v.o.position.z, 0, 0, 0, 0xcfe4ff, 0.08, 0.15);
  }
}

// ===== машина Dodge Challenger =====
const SEATS = [[0.42, -0.1, -0.2], [-0.42, -0.1, -0.2], [0.42, -0.1, -1.1], [-0.42, -0.1, -1.1]];
const cars = new Map(); // id → {group, pos, ry, tgt, try, seats, owner, t, v}
let myCar = null; // {id, seat, sim:{x,y,z,ry,v}}
export const inCar = () => !!myCar;
export const myCarId = () => myCar?.id;
export function applyCars(list) {
  const seen = new Set();
  for (const [id, owner, x, y, z, ry, v, seats, t] of list || []) {
    seen.add(id);
    let c = cars.get(id);
    if (!c) {
      const g = makeChallenger(); g.position.set(x, y, z); g.rotation.y = ry; C.scene.add(g);
      c = { id, group: g, pos: new THREE.Vector3(x, y, z), ry, tgt: new THREE.Vector3(), try: ry };
      cars.set(id, c);
      C.fx.burst(x, y + 1, z, 30, [0x9a9a9a], 3, 0.9, 1.2, { smoke: true, grow: 1.5, alpha: 0.6 });
    }
    Object.assign(c, { owner, seats, t, v });
    c.tgt.set(x, y, z); c.try = ry;
  }
  for (const [id, c] of cars) if (!seen.has(id)) { C.scene.remove(c.group); cars.delete(id); }
  // моё место в машине
  const mine = [...cars.values()].find((c) => c.seats.includes(C.G.myId));
  if (mine) {
    const seat = mine.seats.indexOf(C.G.myId);
    if (!myCar || myCar.id !== mine.id || myCar.seat !== seat) {
      myCar = { id: mine.id, seat, sim: { x: mine.tgt.x, y: mine.tgt.y, z: mine.tgt.z, ry: mine.try, v: 0 } };
      C.addChat(null, seat === 0 ? 'Вы за рулём: W/S — газ/тормоз, A/D — руль, E — выйти' : 'Вы пассажир. E — выйти');
    }
  } else if (myCar) { exitCarLocal(); }
}
function exitCarLocal() {
  const c = cars.get(myCar?.id);
  const me = C.me;
  if (c) { const s = myCar.seat % 2 === 0 ? 1 : -1, ry = c.group.rotation.y; me.x = c.group.position.x + Math.cos(ry) * 2.2 * s; me.z = c.group.position.z - Math.sin(ry) * 2.2 * s; me.y = C.getHeight(me.x, me.z); }
  myCar = null; me.rig.mode = ''; me.vy = 0;
}
function seatWorld(c, seat) {
  const s = SEATS[seat] || SEATS[0], g = c.group, cos = Math.cos(g.rotation.y), sin = Math.sin(g.rotation.y);
  return { x: g.position.x + s[0] * cos + s[2] * sin, y: g.position.y + s[1], z: g.position.z - s[0] * sin + s[2] * cos, ry: g.rotation.y };
}
// Где сидит другой игрок (для отрисовки)
export function seatPose(pid) {
  for (const c of cars.values()) { const i = c.seats.indexOf(pid); if (i >= 0) return { ...seatWorld(c, i), mode: i === 0 ? 'drive' : 'sit' }; }
  return null;
}
export function nearestCar() {
  let best = null, bd = 4.5;
  for (const c of cars.values()) { const d = Math.hypot(c.group.position.x - C.me.x, c.group.position.z - C.me.z); if (d < bd && c.seats.includes(null)) { bd = d; best = c; } }
  return best;
}
export function enterCar(c) { C.send({ t: 'carIn', id: c.id }); }
export function leaveCar() { C.send({ t: 'carOut' }); exitCarLocal(); }
export function carState() { return myCar && myCar.seat === 0 ? [r2(myCar.sim.x), r2(myCar.sim.y), r2(myCar.sim.z), r2(myCar.sim.ry), r2(myCar.sim.v)] : undefined; }

function updateCars(dt) {
  const k = 1 - Math.exp(-12 * dt);
  for (const c of cars.values()) {
    if (myCar && myCar.id === c.id && myCar.seat === 0) continue;
    c.pos.lerp(c.tgt, k); c.ry = lerpAngle(c.ry, c.try, k);
    placeCar(c, c.pos.x, c.pos.y, c.pos.z, c.ry);
    spinWheels(c, c.v || 0, dt);
  }
  if (!myCar) return;
  const c = cars.get(myCar.id); if (!c) return;
  const me = C.me;
  if (myCar.seat === 0) driveSim(c, dt);
  const s = seatWorld(c, myCar.seat);
  me.x = s.x; me.y = s.y; me.z = s.z; me.ry = s.ry; me.vy = 0; me.moving = false;
  me.rig.mode = myCar.seat === 0 ? 'drive' : 'sit';
  C.cam.yaw = lerpAngle(C.cam.yaw, s.ry, Math.min(1, dt * 2.5));
}
function placeCar(c, x, y, z, ry) {
  // наклон по рельефу
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const hf = C.getHeight(x + fx * 1.6, z + fz * 1.6), hb = C.getHeight(x - fx * 1.6, z - fz * 1.6);
  c.group.position.set(x, y, z);
  c.group.rotation.set(-Math.atan2(hf - hb, 3.2), ry, 0, 'YXZ');
}
function spinWheels(c, v, dt) { for (const w of c.group.userData.wheels || []) w.rotation.x += (v * dt) / 0.36; }
function driveSim(c, dt) {
  const s = myCar.sim, keys = C.keys, chat = C.G.chatOpen;
  const W_ = !chat && keys.KeyW, S_ = !chat && keys.KeyS, A_ = !chat && keys.KeyA, D_ = !chat && keys.KeyD;
  if (W_) s.v += 17 * dt;
  if (S_) s.v -= (s.v > 0.5 ? 28 : 10) * dt;
  if (!W_ && !S_) s.v *= 1 - 0.7 * dt;
  if (keys.Space && !chat) s.v *= 1 - 3 * dt; // ручник
  s.v = Math.max(-10, Math.min(36, s.v));
  const steer = (A_ ? 1 : 0) - (D_ ? 1 : 0);
  s.ry += steer * dt * 1.9 * Math.min(1, Math.abs(s.v) / 7) * Math.sign(s.v || 1);
  s.x += Math.sin(s.ry) * s.v * dt; s.z += Math.cos(s.ry) * s.v * dt;
  // столкновения: центр и нос машины
  const before = { x: s.x, z: s.z };
  const nose = { x: s.x + Math.sin(s.ry) * 2.0 * Math.sign(s.v || 1), z: s.z + Math.cos(s.ry) * 2.0 * Math.sign(s.v || 1) };
  const n0 = { ...nose }; C.resolveCollision(nose, 1.0);
  const center = { x: s.x, z: s.z }; C.resolveCollision(center, 1.15);
  const push = Math.hypot(nose.x - n0.x, nose.z - n0.z) + Math.hypot(center.x - before.x, center.z - before.z);
  s.x = center.x + (nose.x - n0.x); s.z = center.z + (nose.z - n0.z);
  if (push > 0.05) { if (Math.abs(s.v) > 12) C.fx.burst(s.x + Math.sin(s.ry) * 2, s.y + 0.6, s.z + Math.cos(s.ry) * 2, 20, [0xffe0a0, 0xaaaaaa], 4, 0.15, 0.4, { gravity: -9 }); s.v *= -0.25; }
  s.y = Math.max(C.getHeight(s.x, s.z), C.roofAt(s.x, s.z, s.y + 0.6));
  placeCar(c, s.x, s.y, s.z, s.ry); c.pos.set(s.x, s.y, s.z); c.ry = s.ry;
  spinWheels(c, s.v, dt);
  if (Math.abs(s.v) > 8 && Math.random() < dt * 12) C.fx.smoke.emit(s.x - Math.sin(s.ry) * 2.4, s.y + 0.3, s.z - Math.cos(s.ry) * 2.4, 0, 0.3, 0, 0x8a8682, 0.4, 0.8, { grow: 1.2, alpha: 0.35 });
}

// ===== HUD: панель оружия =====
export function hudHTML() {
  const c = CLASSES[C.me.cls], st = C.G.state?.pl.find((p) => p.id === C.G.myId);
  return c.weapons.map((w, i) => {
    const p = w.primary, sel = i === W.idx;
    let ammo = p.mag ? `${W.ammo[i]}/${p.mag}` : w.id === 'car' ? (C.G.state?.cars?.some((x) => x[1] === C.G.myId) ? 'на месте' : st && st.cc > 0 ? `⏳${st.cc} с` : 'готова') : '∞';
    if (sel && W.reloadT > 0) ammo = 'перезарядка…';
    const altCd = W.alt[i] > 0 ? `<i style="height:${Math.min(100, (W.alt[i] / (w.alt.cd || 1)) * 100)}%"></i>` : '';
    return `<div class="wslot${sel ? ' sel' : ''}"><div class="wk">${i + 1}</div><div class="wi">${w.icon}</div><div class="wn">${w.name}</div><div class="wa">${ammo}</div><div class="walt">ПКМ/F: ${w.alt.name || ''}${altCd}</div></div>`;
  }).join('') + `<div class="wslot pot"><div class="wk">H</div><div class="wi">🧪</div><div class="wn">Аптечка</div><div class="wa" id="pot-count">${C.me.potions}</div></div>`;
}
