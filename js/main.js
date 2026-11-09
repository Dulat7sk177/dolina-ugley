// Главный файл: рендер, управление, камера, интерфейс, синхронизация
import * as THREE from 'three';
import { CLASSES, ENEMIES, QUESTS, ZONES, ELDER_LINES, WATER_LEVEL } from './config.js';
import { buildWorld, loadWorldAssets, getHeight, resolveCollision, colliders } from './world.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeCharacter, animateRig, playAttack, playHit, playCheer, playDeath, loadModels } from './models.js';
import { FX } from './particles.js';
import { surfaceAt, ceilingAt, resolveBoxes, pointBlocked } from './buildings.js';
import { HostSim } from './host.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
function lerpAngle(a, b, t) {
  let d = (b - a + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return a + (d - Math.PI) * t;
}
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ================= Рендер и сцена =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0xb4bcc4; // холодная северная дымка
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.0062);
scene.environmentIntensity = 0.75;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);
scene.add(new THREE.HemisphereLight(0xc8d8e8, 0x3a4030, 0.35));
const sun = new THREE.DirectionalLight(0xffeedd, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(45, 55, -30).normalize().multiplyScalar(90);
let world = null;
const fx = new FX(scene);
fx.setScale(renderer, camera);

// Постобработка: мягкое свечение огня, фонарей и магии
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  fx.setScale(renderer, camera);
});

// ================= Состояние =================
const G = { started: false, isHost: false, myId: null, sim: null, net: null, code: null, sendAcc: 0, snapAcc: 0, hudAcc: 0, partyAcc: 0, state: null, quest: [0, 0], lv: [1, 0, 100], chatOpen: false, hurt: 0 };
const me = { name: '', cls: 'warrior', x: 0, y: 0, z: 0, vy: 0, ry: 0, onGround: true, moving: false, mp: 100, maxMp: 100, hp: 100, maxHp: 100, downed: false, potions: 0, shield: false, revive: 0, a: 0, ak: '', faceT: 0, cds: { atk: 0, q: 0, f: 0, r: 0 }, rig: null, manaWarn: 0, jumps: 0, flipN: 0, flipT: -1 };
const cam = { yaw: 0, pitch: 0.35, dist: 6.5 };
const keys = {};
let mouseDown = false, locked = false;
const views = { players: new Map(), enemies: new Map(), proj: new Map(), drops: new Map() };
const dying = [], fxList = [], floaters = [];
const tmp = new THREE.Vector3();

// ================= Метки над головами =================
const labelLayer = $('labels');
function makeLabel(text, cls) {
  const el = document.createElement('div');
  el.className = 'label ' + cls;
  el.style.display = 'none';
  el.innerHTML = '<div class="bubble hidden"></div><div class="lname"></div><div class="lbar"><i></i></div>';
  el.querySelector('.lname').textContent = text;
  labelLayer.appendChild(el);
  el._bar = el.querySelector('.lbar i');
  return el;
}
function placeLabel(el, pos, h, hp, mh, maxDist = 45) {
  tmp.set(pos.x, pos.y + h, pos.z);
  const d = tmp.distanceTo(camera.position);
  tmp.project(camera);
  if (tmp.z > 1 || d > maxDist) { el.style.display = 'none'; return; }
  el.style.display = '';
  const x = (tmp.x * 0.5 + 0.5) * innerWidth, y = (-tmp.y * 0.5 + 0.5) * innerHeight;
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  if (mh) el._bar.style.width = clamp((hp / mh) * 100, 0, 100) + '%';
}

// ================= Старейшина (NPC) =================
let elder = null;
const ELDER_POS = new THREE.Vector3(4.5, 0, 2.5);
ELDER_POS.y = getHeight(ELDER_POS.x, ELDER_POS.z);
function spawnElder() {
  elder = makeCharacter('elder');
  elder.root.position.copy(ELDER_POS);
  elder.root.rotation.y = Math.atan2(-ELDER_POS.x, -ELDER_POS.z) + 0.6;
  scene.add(elder.root);
}
const elderLabel = makeLabel('Старейшина Ольгерд', 'npc');
const elderBubble = elderLabel.querySelector('.bubble');

// ================= Эффекты =================
function addFx(mesh, dur, update) { scene.add(mesh); fxList.push({ mesh, t: 0, dur, update }); }
function spawnRing(x, z, r, color) {
  const geo = new THREE.RingGeometry(0.8, 1, 48); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, getHeight(x, z) + 0.2, z);
  addFx(m, 0.6, (f, p) => { f.mesh.scale.setScalar(r * (0.25 + 0.75 * (1 - (1 - p) * (1 - p)))); f.mesh.material.opacity = 0.85 * (1 - p); });
}
function spawnWarn(x, z, r, dur) {
  const geo = new THREE.CircleGeometry(1, 40); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.1, depthWrite: false }));
  m.position.set(x, getHeight(x, z) + 0.15, z);
  addFx(m, dur, (f, p) => { f.mesh.scale.setScalar(r * p); f.mesh.material.opacity = 0.15 + 0.3 * p; });
}
function spawnBoom(x, y, z, color = 0xff8a30) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.set(x, y, z);
  addFx(m, 0.35, (f, p) => { f.mesh.scale.setScalar(1 + p * 2.5); f.mesh.material.opacity = 0.9 * (1 - p); });
}
function spawnSlash(root) {
  const geo = new THREE.RingGeometry(1.4, 2.3, 20, 1, -Math.PI * 0.3, Math.PI * 0.6); geo.rotateX(-Math.PI / 2); geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  m.position.copy(root.position); m.position.y += 1.2; m.rotation.y = root.rotation.y;
  addFx(m, 0.22, (f, p) => { f.mesh.material.opacity = 0.6 * (1 - p); f.mesh.scale.setScalar(0.8 + p * 0.3); });
}
function spawnPillar(x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 8, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd760, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, y + 4, z);
  addFx(m, 1.4, (f, p) => { f.mesh.material.opacity = 0.5 * (1 - p); f.mesh.scale.set(1 - p * 0.6, 1, 1 - p * 0.6); });
}
function spawnFloater(x, y, z, text, cls) {
  const el = document.createElement('div');
  el.className = 'dmg ' + cls; el.textContent = text;
  labelLayer.appendChild(el);
  floaters.push({ el, pos: new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6), t: 0 });
}
function onAttackAnim(rig, kind) {
  playAttack(rig, kind);
  if (kind === 'slash' && rig.kind === 'warrior') spawnSlash(rig.root);
}

// ================= Чат и сообщения =================
function addChat(from, text) {
  const log = $('chat-log');
  const line = document.createElement('div');
  line.className = from ? 'msg' : 'msg sys';
  if (from) { const b = document.createElement('b'); b.textContent = from + ': '; line.appendChild(b); }
  line.appendChild(document.createTextNode(text));
  log.appendChild(line);
  while (log.children.length > 8) log.firstChild.remove();
  setTimeout(() => line.classList.add('old'), 12000);
}
function banner(text, cls = '') {
  const b = $('banner');
  b.textContent = text; b.className = 'show ' + cls;
  clearTimeout(banner.t);
  banner.t = setTimeout(() => (b.className = ''), 3200);
}
function openChat() {
  G.chatOpen = true;
  $('chat').classList.add('open');
  const inp = $('chat-input');
  inp.classList.remove('hidden'); inp.value = ''; inp.focus();
  for (const k in keys) keys[k] = false;
  mouseDown = false;
}
function closeChat(send) {
  const inp = $('chat-input');
  const text = inp.value.trim();
  if (send && text) sendToHost({ t: 'chat', text: text.slice(0, 200) });
  inp.blur(); inp.classList.add('hidden');
  $('chat').classList.remove('open');
  G.chatOpen = false;
}

// ================= Лобби =================
let selClass = 'warrior', busy = false;
try { $('name').value = localStorage.getItem('rpg-name') || ''; } catch { /* нет доступа к хранилищу */ }
document.querySelectorAll('.class-card').forEach((card) => card.addEventListener('click', () => {
  document.querySelectorAll('.class-card').forEach((c) => c.classList.remove('sel'));
  card.classList.add('sel');
  selClass = card.dataset.cls;
}));
const urlJoin = new URLSearchParams(location.search).get('join');
if (urlJoin) $('join-code').value = urlJoin.toUpperCase();
$('btn-host').onclick = () => startGame('host');
// Загрузка 3D-моделей; кнопки заблокированы, пока не загрузится
$('btn-host').disabled = $('btn-join').disabled = true;
{
  let pm = 0, pw = 0;
  const prog = () => setStatus(`Загрузка мира… ${Math.round((pm * 0.4 + pw * 0.6) * 100)}%`);
  Promise.all([
    loadModels((p) => { pm = p; prog(); }),
    loadWorldAssets(renderer, scene, (p) => { pw = p; prog(); }),
  ])
  .then(() => {
    world = buildWorld(scene);
    setStatus(''); $('btn-host').disabled = $('btn-join').disabled = false; spawnElder();
  })
  .catch((err) => { console.error(err); setStatus('Не удалось загрузить мир. Запусти игру через start.bat', true); });
}
$('btn-join').onclick = () => {
  const c = $('join-code').value.trim().toUpperCase();
  if (!c) return setStatus('Введите код комнаты', true);
  startGame('join', c);
};
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
function setStatus(t, err) { $('status').textContent = t; $('status').classList.toggle('err', !!err); }

async function startGame(mode, code) {
  if (busy) return;
  busy = true;
  me.name = ($('name').value.trim() || 'Герой').slice(0, 16);
  try { localStorage.setItem('rpg-name', me.name); } catch { /* ignore */ }
  me.cls = selClass;
  const c = CLASSES[me.cls];
  me.maxMp = me.mp = c.mp; me.maxHp = me.hp = c.hp;
  if (mode === 'host') {
    G.isHost = true; G.myId = 'host';
    G.sim = new HostSim();
    G.sim.addPlayer('host', me.name, me.cls);
    G.net = new Net();
    setStatus('Создаём комнату…');
    try {
      G.code = await G.net.host({ onData: hostOnData, onLeave: (pid) => G.sim.removePlayer(pid) });
    } catch (err) {
      console.warn(err);
      G.net.destroy(); G.net = null; G.code = null;
      setTimeout(() => addChat(null, 'Сеть недоступна — играем соло.'), 100);
    }
    enterGame();
  } else {
    G.net = new Net();
    setStatus('Подключаемся к комнате ' + code + '…');
    try {
      await G.net.join(code, { onData: clientOnData, onClose: onDisconnect });
      G.code = code;
      G.net.send({ t: 'hello', name: me.name, cls: me.cls });
      setStatus('Ждём ответа хоста…');
    } catch (err) {
      setStatus('Не удалось подключиться: ' + (err.message || err.type || err), true);
      G.net.destroy(); G.net = null; busy = false;
    }
  }
}

function hostOnData(pid, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    G.sim.addPlayer(pid, String(msg.name || 'Герой').slice(0, 16), CLASSES[msg.cls] ? msg.cls : 'warrior');
    G.net.sendTo(pid, { t: 'welcome', id: pid });
    return;
  }
  G.sim.onMessage(pid, msg);
}
function clientOnData(msg) {
  if (!msg) return;
  if (msg.t === 'welcome' && !G.started) { G.myId = msg.id; enterGame(); }
  else if (msg.t === 's' && G.started) applyState(msg);
}
function onDisconnect() {
  if (!G.started) return;
  $('disconnect').classList.remove('hidden');
  document.exitPointerLock?.();
}
function sendToHost(msg) {
  if (G.isHost) G.sim.onMessage('host', msg);
  else G.net?.send(msg);
}
addEventListener('beforeunload', () => G.net?.destroy());

const ICONS = { slash: '⚔️', spin: '🌀', shield: '🛡️', fireball: '🔥', heal: '💚', nova: '❄️' };
function enterGame() {
  G.started = true;
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  me.rig = makeCharacter(me.cls);
  scene.add(me.rig.root);
  me.x = (Math.random() - 0.5) * 6; me.z = -4; me.y = getHeight(me.x, me.z);
  const z0 = ZONES[QUESTS[0].zone];
  cam.yaw = Math.atan2(z0.x - me.x, z0.z - me.z);
  const ab = CLASSES[me.cls].abilities;
  const slots = [['atk', 'ЛКМ'], ['q', 'Q'], ['f', 'F']];
  $('abilities').innerHTML = slots.map(([k, key]) => `<div class="slot" id="slot-${k}" title="${esc(ab[k].name)}"><div class="icon">${ICONS[ab[k].kind]}</div><div class="cd"></div><div class="key">${key}</div><div class="mpc">${ab[k].mp || ''}</div></div>`).join('')
    + '<div class="slot" id="slot-r" title="Зелье здоровья (+50%)"><div class="icon">🧪</div><div class="cd"></div><div class="key">R</div><div class="cnt" id="pot-count">0</div></div>';
  $('ability-help').innerHTML = `<b>${esc(CLASSES[me.cls].name)}:</b><br>` + slots.map(([k, key]) => `${key} — ${esc(ab[k].name)}${ab[k].mp ? ` (${ab[k].mp} маны)` : ''}`).join('<br>');
  if (G.code) {
    $('room').innerHTML = `<span>Код комнаты: <b>${esc(G.code)}</b></span><button id="copy-code">Копировать</button>`;
    $('copy-code').onclick = () => { navigator.clipboard?.writeText(G.code); $('copy-code').textContent = 'Готово'; };
  } else $('room').textContent = 'Одиночная игра';
  addChat(null, 'Добро пожаловать в Долину Углей! Esc — пауза и управление.');
  if (G.isHost && G.code) addChat(null, `Друзья могут войти по коду ${G.code}`);
}

// ================= Управление =================
addEventListener('keydown', (e) => {
  if (!G.started) return;
  if (G.chatOpen) {
    if (e.code === 'Enter') closeChat(true);
    else if (e.code === 'Escape') closeChat(false);
    return;
  }
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') tryJump();
  if (e.code === 'Enter') { e.preventDefault(); openChat(); }
  else if (e.code === 'KeyQ') useAbility('q');
  else if (e.code === 'KeyF') useAbility('f');
  else if (e.code === 'KeyR') usePotion();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
const lockTarget = renderer.domElement;
// Захват мыши; если браузер не даёт (встроенные окна) — камера крутится зажатой правой кнопкой
let noLock = false, rmbDrag = false;
function tryLock() {
  if (!G.started) return;
  if (noLock) { setFreeMode(); return; }
  const p = lockTarget.requestPointerLock();
  if (p && p.catch) p.catch(() => { noLock = true; setFreeMode(); });
}
function setFreeMode() {
  locked = true;
  $('pause').classList.add('hidden');
  addChat(null, 'Режим без захвата мыши: поворот камеры — зажатая правая кнопка мыши');
}
lockTarget.addEventListener('click', () => { if (!locked) tryLock(); });
$('pause').addEventListener('click', tryLock);
document.addEventListener('pointerlockchange', () => {
  if (noLock) return;
  locked = document.pointerLockElement === lockTarget;
  $('pause').classList.toggle('hidden', locked);
  if (!locked) mouseDown = false;
});
addEventListener('keydown', (e) => { if (noLock && e.code === 'Escape' && G.started) { locked = false; $('pause').classList.remove('hidden'); } });
addEventListener('mousemove', (e) => {
  if (!locked || (noLock && !rmbDrag)) return;
  cam.yaw -= e.movementX * 0.0024;
  cam.pitch = clamp(cam.pitch + e.movementY * 0.002, -0.3, 1.25);
});
addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0 && e.target === lockTarget) mouseDown = true;
  if (e.button === 2) { if (noLock) rmbDrag = true; else useAbility('q'); }
});
addEventListener('mouseup', (e) => { if (e.button === 2) rmbDrag = false; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (G.started) cam.dist = clamp(cam.dist + e.deltaY * 0.005, 3, 13); }, { passive: true });

function useAbility(slot) {
  if (!G.started || me.downed || G.chatOpen || !locked) return;
  const ab = CLASSES[me.cls].abilities[slot];
  if (me.cds[slot] > 0) return;
  if (me.mp < ab.mp) {
    if (me.manaWarn <= 0) { me.manaWarn = 1.5; addChat(null, 'Не хватает маны'); }
    return;
  }
  me.mp -= ab.mp; me.cds[slot] = ab.cd;
  me.a++; me.ak = ab.kind; me.faceT = 0.45; me.ry = cam.yaw;
  me.rig.root.rotation.y = me.ry;
  onAttackAnim(me.rig, ab.kind);
  sendToHost({ t: 'atk', kind: ab.kind, ry: r2(cam.yaw) });
}
// Прыжок; в воздухе — второй прыжок с сальто (как в Devil May Cry)
function tryJump() {
  if (!G.started || me.downed || G.chatOpen) return;
  if (me.onGround) { me.vy = 8.5; me.onGround = false; me.jumps = 1; return; }
  if (me.jumps < 2) {
    me.vy = 9.5; me.jumps = 2; me.flipT = 0; me.flipN++;
    flipBurst(me.x, me.y, me.z);
  }
}
function flipBurst(x, y, z) {
  fx.shockwave(x, y - 0.2, z, [0xffffff, 0xdfe8ff, 0xffe6a0], 6, 40);
  fx.burst(x, y + 0.6, z, 14, [0xffffff, 0xffe6a0], 2.5, 0.18, 0.4, { drag: 2 });
}
// Сальто: вращение тела вокруг центра (≈1 м над ногами) за 0.55 с, со шлейфом искр
const FLIP_DUR = 0.55, FLIP_C = 1.0;
function applyFlip(rig, t, dt, pos) {
  if (t < 0 || t === undefined) return -1;
  t += dt;
  const p = Math.min(1, t / FLIP_DUR), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, th = e * Math.PI * 2;
  rig.body.rotation.x = th;
  rig.body.position.set(0, FLIP_C - FLIP_C * Math.cos(th), -FLIP_C * Math.sin(th));
  if (pos && p < 1) {
    const ry = rig.root.rotation.y, hx = Math.sin(th) * 1.0, hy = Math.cos(th) * 1.0;
    fx.glow.emit(pos.x + Math.sin(ry) * hx, pos.y + FLIP_C + hy, pos.z + Math.cos(ry) * hx, 0, 0, 0, 0xcfe4ff, 0.22, 0.25);
  }
  if (p >= 1) { rig.body.rotation.x = 0; rig.body.position.set(0, 0, 0); return -1; }
  return t;
}

function usePotion() {
  if (me.downed || me.cds.r > 0) return;
  if (me.potions <= 0) { addChat(null, 'Нет зелий — их роняют враги'); return; }
  if (me.hp >= me.maxHp) return;
  me.cds.r = 1;
  sendToHost({ t: 'potion' });
}

// ================= Локальный игрок =================
function updateLocal(dt) {
  const c = CLASSES[me.cls];
  for (const k in me.cds) me.cds[k] = Math.max(0, me.cds[k] - dt);
  me.manaWarn -= dt;
  me.mp = Math.min(me.maxMp, me.mp + c.mpRegen * dt);
  const canAct = !me.downed && !G.chatOpen;
  let fwd = 0, side = 0;
  if (canAct) {
    fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  }
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  let ix = fx * fwd + rx * side, iz = fz * fwd + rz * side;
  const len = Math.hypot(ix, iz);
  me.moving = len > 0;
  const inWater = me.y < WATER_LEVEL - 0.3;
  if (me.moving) {
    ix /= len; iz /= len;
    const spd = c.speed * (keys.ShiftLeft || keys.ShiftRight ? 1.55 : 1) * (inWater ? 0.6 : 1);
    me.x += ix * spd * dt; me.z += iz * spd * dt;
  }
  let targetRy = me.ry;
  if (me.faceT > 0) { me.faceT -= dt; targetRy = cam.yaw; }
  else if (me.moving) targetRy = Math.atan2(ix, iz);
  me.ry = lerpAngle(me.ry, targetRy, 1 - Math.exp(-14 * dt));

  me.vy -= 25 * dt;
  me.y += me.vy * dt;
  resolveCollision(me, 0.45);
  resolveBoxes(me, 0.4, me.y);
  const ceil = ceilingAt(me.x, me.z, me.y);
  if (me.y + 1.85 > ceil && me.vy > 0) { me.y = ceil - 1.85; me.vy = 0; }
  const ground = Math.max(getHeight(me.x, me.z), surfaceAt(me.x, me.z, me.y));
  if (me.y <= ground) { me.y = ground; me.vy = 0; me.onGround = true; me.jumps = 0; }
  else if (me.onGround && me.vy <= 0 && me.y - ground < 0.45) { me.y = ground; me.vy = 0; } // спуск по ступенькам
  else me.onGround = false;

  if (canAct && mouseDown && locked) useAbility('atk');
}

function updateCamera() {
  const tx = me.x, ty = me.y + 1.6, tz = me.z;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  const sh = 0.7;
  // камера не проходит сквозь камни, стены и деревья: укорачиваем дистанцию до первого препятствия
  let dist = cam.dist;
  const near = colliders.filter((c) => Math.abs(c.x - tx) < cam.dist + c.r + 1 && Math.abs(c.z - tz) < cam.dist + c.r + 1);
  for (let d = 0.8; d <= cam.dist; d += 0.2) {
    const qx = tx - fx * d * cp + rx * sh * (d / cam.dist), qz = tz - fz * d * cp + rz * sh * (d / cam.dist), qy = ty + d * sp;
    if (qy - getHeight(qx, qz) > 6) continue; // выше препятствий
    if (pointBlocked(qx, qy, qz, 0.25)) { dist = Math.max(0.9, d - 0.35); break; }
    if (qy - getHeight(qx, qz) > 6) continue;
    if (near.some((c) => (qx - c.x) ** 2 + (qz - c.z) ** 2 < (c.r + 0.25) ** 2)) { dist = Math.max(1.2, d - 0.3); break; }
  }
  cam.cur = cam.cur === undefined ? dist : dist < cam.cur ? dist : cam.cur + (dist - cam.cur) * 0.08;
  dist = cam.cur;
  let px = tx - fx * dist * cp + rx * sh, py = ty + dist * sp, pz = tz - fz * dist * cp + rz * sh;
  const g = Math.max(getHeight(px, pz), WATER_LEVEL) + 0.6;
  if (py < g) py = g;
  camera.position.set(px, py, pz);
  camera.lookAt(tx + rx * sh, ty, tz + rz * sh);
  sun.position.set(tx + SUN_DIR.x, ty + SUN_DIR.y, tz + SUN_DIR.z);
  sun.target.position.set(tx, ty, tz);
}

// ================= Применение состояния от хоста =================
function handleEvent(ev) {
  switch (ev.k) {
    case 'dmg':
      spawnFloater(ev.x, ev.y, ev.z, ev.v, ev.c);
      if (ev.c === 'heal') fx.ring(ev.x, ev.y - 2.3, ev.z, 0.8, [0x6fff8f, 0xd8ffd0], 18, 2.5);
      else if (ev.c === 'player') {
        fx.sparks(ev.x, ev.y - 1.1, ev.z, false);
        if (ev.pid === G.myId) { G.hurt = 0.55; playHit(me.rig); }
        else { const pv = views.players.get(ev.pid); if (pv) playHit(pv.rig); }
      } else fx.sparks(ev.x, ev.y - 0.9, ev.z, ev.c === 'crit');
      break;
    case 'die': {
      const v = views.enemies.get(ev.id);
      if (v) { views.enemies.delete(ev.id); v.label.remove(); playDeath(v.rig); dying.push({ v, t: 0 }); fx.soul(v.pos.x, v.pos.y, v.pos.z, v.type === 'wolf' ? 0xcfc6b8 : 0x9a7aff); }
      break;
    }
    case 'ring': {
      spawnRing(ev.x, ev.z, ev.r, ev.c);
      const y = getHeight(ev.x, ev.z);
      if (ev.c === 0x55ff88) fx.ring(ev.x, y, ev.z, ev.r, [0x55ff88, 0xbfffcf, 0xffffff], 90, 3);
      else if (ev.c === 0x88ddff) { fx.shockwave(ev.x, y, ev.z, [0x88ddff, 0xffffff, 0x4aa8ff], 14, 90); fx.ring(ev.x, y, ev.z, ev.r, [0xcff4ff], 30, 1); }
      else if (ev.c === 0xff5533) { fx.shockwave(ev.x, y, ev.z, [0x9a8466, 0x7a6a50], 12, 50, true); fx.shockwave(ev.x, y, ev.z, [0xffa040, 0xff5533], 10, 40); }
      else fx.shockwave(ev.x, y + 0.6, ev.z, [0xffffff, 0xdde8ff], 10, 50);
      break;
    }
    case 'warn': {
      spawnWarn(ev.x, ev.z, ev.r, ev.t);
      const v = views.enemies.get(ev.id);
      if (v) playAttack(v.rig, 'slam');
      break;
    }
    case 'boom': spawnBoom(ev.x, ev.y, ev.z); fx.fireBurst(ev.x, ev.y, ev.z); break;
    case 'levelup':
      banner(`Уровень ${ev.level}!`);
      spawnPillar(me.x, me.y, me.z); playCheer(me.rig); fx.spiral(me.x, me.y, me.z, [0xffd760, 0xfff2b0, 0xffffff]);
      for (const v of views.players.values()) { spawnPillar(v.pos.x, v.pos.y, v.pos.z); playCheer(v.rig); fx.spiral(v.pos.x, v.pos.y, v.pos.z, [0xffd760, 0xfff2b0]); }
      break;
    case 'quest': banner(`Задание выполнено: ${ev.title}`); addChat(null, `Задание «${ev.title}» выполнено!`); break;
    case 'victory': setTimeout(() => banner('Гримвальд Рогатый повержен! Долина спасена!'), 3300); break;
    case 'tp':
      if (ev.id === G.myId) { me.x = ev.x; me.z = ev.z; me.y = getHeight(ev.x, ev.z) + 0.5; me.vy = 0; }
      break;
    case 'down': addChat(null, `${ev.name} повержен!`); break;
    case 'revive': addChat(null, `${ev.name} снова в строю`); break;
    case 'wipe': banner('Отряд пал… Возрождение в деревне', 'red'); break;
    case 'chat': addChat(ev.from, ev.text); break;
    case 'sys': addChat(null, ev.text); break;
    case 'pickup': {
      const pv = ev.id === G.myId ? { x: me.x, y: me.y, z: me.z } : views.players.get(ev.id)?.pos;
      if (pv) fx.burst(pv.x, pv.y + 0.8, pv.z, 20, [0xff4060, 0xffffff], 2.5, 0.25, 0.7, { gravity: 2 });
      if (ev.id === G.myId) addChat(null, 'Подобрано зелье здоровья (R — выпить)');
      break;
    }
  }
}

function syncView(map, id, create) {
  let v = map.get(id);
  if (!v) { v = create(); map.set(id, v); }
  v.seen = true;
  return v;
}
function prune(map, onRemove) {
  for (const [id, v] of map) { if (!v.seen) { onRemove(v); map.delete(id); } else v.seen = false; }
}

let potionGeo = null, potionMat = null, fireCore = null, fireGlow = null;
function applyState(s) {
  G.state = s;
  for (const ev of s.ev) handleEvent(ev);

  for (const p of s.pl) {
    if (p.id === G.myId) {
      me.hp = p.hp; me.maxHp = p.mh; me.downed = !!p.d; me.potions = p.po; me.shield = !!p.sh; me.revive = p.rv;
      continue;
    }
    const v = syncView(views.players, p.id, () => {
      const rig = makeCharacter(p.c, 0);
      scene.add(rig.root);
      return { rig, pos: new THREE.Vector3(p.x, p.y, p.z), tgt: new THREE.Vector3(), ry: p.ry, a: p.a, label: makeLabel(p.n, 'ally') };
    });
    v.tgt.set(p.x, p.y, p.z); v.try = p.ry; v.mv = p.mv; v.hp = p.hp; v.mh = p.mh; v.d = p.d; v.rv = p.rv; v.sh = p.sh; v.name = p.n;
    if (p.a !== v.a) { v.a = p.a; onAttackAnim(v.rig, p.ak); }
    if (p.fl !== v.fl) { if (v.fl !== undefined) { v.flipT = 0; flipBurst(v.pos.x, v.pos.y, v.pos.z); } v.fl = p.fl; }
  }
  prune(views.players, (v) => { scene.remove(v.rig.root); v.label.remove(); });

  for (const e of s.en) {
    const [id, type, x, z, ry, mv, seq, hp, mh, slow] = e;
    const v = syncView(views.enemies, id, () => {
      const rig = makeCharacter(type, id);
      scene.add(rig.root);
      return { rig, type, pos: new THREE.Vector3(x, getHeight(x, z), z), tgt: new THREE.Vector3(), ry, seq, hp, label: makeLabel(ENEMIES[type].name, type === 'boss' ? 'boss' : 'enemy') };
    });
    v.tgt.set(x, getHeight(x, z), z); v.try = ry; v.mv = mv; v.mh = mh; v.slow = slow;
    if (seq !== v.seq) { v.seq = seq; playAttack(v.rig, type === 'wolf' ? 'bite' : type === 'boss' ? 'bossHit' : 'enemy'); }
    if (hp < v.hp) playHit(v.rig);
    v.hp = hp;
  }
  prune(views.enemies, (v) => { scene.remove(v.rig.root); v.label.remove(); });

  if (!fireCore) {
    fireCore = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    fireGlow = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55, depthWrite: false });
    potionGeo = new THREE.SphereGeometry(0.22, 10, 8);
    potionMat = new THREE.MeshLambertMaterial({ color: 0xe0303a, emissive: 0x551010 });
  }
  for (const [id, x, y, z] of s.pr) {
    const v = syncView(views.proj, id, () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), fireCore), new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), fireGlow));
      g.position.set(x, y, z);
      scene.add(g);
      return { g, tgt: new THREE.Vector3() };
    });
    v.tgt.set(x, y, z);
  }
  prune(views.proj, (v) => scene.remove(v.g));

  for (const [id, x, z] of s.dr) {
    syncView(views.drops, id, () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(potionGeo, potionMat));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 6), new THREE.MeshLambertMaterial({ color: 0xd8c8a0 }));
      neck.position.y = 0.25; g.add(neck);
      g.position.set(x, getHeight(x, z) + 0.5, z);
      scene.add(g);
      return { g, y0: g.position.y };
    });
  }
  prune(views.drops, (v) => scene.remove(v.g));

  G.quest = s.q; G.lv = s.lv;
}

// ================= Обновление видимых объектов =================
function updateViews(dt, t) {
  const k = 1 - Math.exp(-10 * dt);
  // свой персонаж
  me.rig.root.position.set(me.x, me.y, me.z);
  me.rig.root.rotation.y = me.ry;
  animateRig(me.rig, dt, me.moving, me.downed, !me.onGround && me.vy > -2);
  me.flipT = applyFlip(me.rig, me.flipT, dt, me);
  if (me.rig.aura) me.rig.aura.visible = me.shield;

  for (const v of views.players.values()) {
    v.pos.lerp(v.tgt, k);
    v.ry = lerpAngle(v.ry, v.try, k);
    v.rig.root.position.copy(v.pos); v.rig.root.rotation.y = v.ry;
    animateRig(v.rig, dt, v.mv, v.d);
    v.flipT = applyFlip(v.rig, v.flipT ?? -1, dt, v.pos);
    if (v.rig.aura) v.rig.aura.visible = !!v.sh;
    placeLabel(v.label, v.pos, 2.5, v.hp, v.mh, 80);
  }
  let boss = null;
  for (const v of views.enemies.values()) {
    v.pos.lerp(v.tgt, k);
    v.ry = lerpAngle(v.ry, v.try, k);
    v.rig.root.position.copy(v.pos); v.rig.root.rotation.y = v.ry;
    animateRig(v.rig, dt * (v.slow ? 0.5 : 1), v.mv, false);
    placeLabel(v.label, v.pos, v.rig.labelH, v.hp, v.mh, v.type === 'boss' ? 70 : 40);
    if (v.type === 'boss' && Math.hypot(v.pos.x - me.x, v.pos.z - me.z) < 40) boss = v;
  }
  $('bossbar').classList.toggle('hidden', !boss);
  if (boss) $('bossbar').querySelector('i').style.width = (boss.hp / boss.mh) * 100 + '%';

  for (let i = dying.length - 1; i >= 0; i--) {
    const d = dying[i];
    d.t += dt;
    animateRig(d.v.rig, dt, false, false);
    if (d.t > 1.8) d.v.rig.root.position.y -= dt * 0.8;
    if (d.t > 3.2) { scene.remove(d.v.rig.root); dying.splice(i, 1); }
  }
  for (const v of views.proj.values()) {
    v.g.position.lerp(v.tgt, 1 - Math.exp(-20 * dt));
    const pp = v.g.position;
    for (let k = 0; k < 3; k++) fx.glow.emit(pp.x + (Math.random() - 0.5) * 0.2, pp.y + (Math.random() - 0.5) * 0.2, pp.z + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.6, 0.5 + Math.random(), (Math.random() - 0.5) * 0.6, k ? 0xff7a20 : 0xffe08a, 0.45, 0.35, { grow: -0.8 });
  }
  ambient(dt);
  for (const v of views.drops.values()) { v.g.position.y = v.y0 + Math.sin(t * 3) * 0.12; v.g.rotation.y = t * 1.5; }

  // старейшина
  if (elder) animateRig(elder, dt, false, false);
  placeLabel(elderLabel, ELDER_POS, 2.5, 0, 0, 30);
  const near = Math.hypot(me.x - ELDER_POS.x, me.z - ELDER_POS.z) < 7;
  elderBubble.classList.toggle('hidden', !near);
  if (near) elderBubble.textContent = ELDER_LINES[Math.min(G.quest[0], ELDER_LINES.length - 1)];

  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    const p = Math.min(1, f.t / f.dur);
    f.update(f, p);
    if (p >= 1) { scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); fxList.splice(i, 1); }
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt; f.pos.y += dt * 1.6;
    tmp.copy(f.pos).project(camera);
    if (f.t > 1 || tmp.z > 1) { f.el.remove(); floaters.splice(i, 1); continue; }
    f.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
    f.el.style.opacity = String(1 - f.t * f.t);
  }
  G.hurt = Math.max(0, G.hurt - dt * 1.5);
  $('hurt').style.opacity = String(G.hurt);
}

// ================= Атмосфера: искры костров, дым из труб, светлячки, пыль =================
const rnd = () => Math.random() - 0.5;
let ambAcc = 0, dustAcc = 0;
const FIRE_COLS = { green: [0xd8ffe8, 0x66ffaa, 0x1f9a5a], orange: [0xfff0b0, 0xffa040, 0xff5a1a] };
function ambient(dt) {
  if (!world) return;
  const cx = G.started ? me.x : 0, cz = G.started ? me.z : 0;
  for (const f of world.flames) {
    if (Math.hypot(f.x - cx, f.z - cz) > 60) continue;
    // языки пламени из частиц
    const pal = f.color === 0x55ff99 || f.color === 0x66ffaa ? FIRE_COLS.green : FIRE_COLS.orange;
    const fr = f.size * dt * 70;
    const fn = Math.floor(fr) + (Math.random() < fr % 1 ? 1 : 0);
    for (let k = 0; k < fn; k++) {
      const c = pal[Math.floor(Math.random() * 3)];
      fx.glow.emit(f.x + rnd() * 0.6 * f.size, f.y + Math.random() * 0.1, f.z + rnd() * 0.6 * f.size, rnd() * 0.3, (1.2 + Math.random() * 1.2) * Math.sqrt(f.size), rnd() * 0.3, c, (0.35 + Math.random() * 0.35) * (0.4 + f.size * 0.6), 0.45 + Math.random() * 0.35, { grow: -0.4 * f.size, drag: 0.5 });
    }
    const rate = f.size * dt * 10;
    const n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      fx.glow.emit(f.x + rnd() * 0.5 * f.size, f.y, f.z + rnd() * 0.5 * f.size, rnd() * 0.6, 1.5 + Math.random() * 2, rnd() * 0.6,
        Math.random() < 0.5 ? f.color : 0xffd080, 0.1 + Math.random() * 0.1, 1 + Math.random() * 0.8, { drag: 0.3 });
    }
    if (f.size >= 1 && Math.random() < dt * 4) fx.smoke.emit(f.x, f.y + 0.8, f.z, rnd() * 0.3, 1.0, rnd() * 0.3, 0x6a6a6a, 0.6, 3, { grow: 0.9, alpha: 0.3 });
  }
  for (const s of world.smokes) {
    if (Math.hypot(s.x - cx, s.z - cz) > 80) continue;
    if (Math.random() < dt * 3) fx.smoke.emit(s.x + rnd() * 0.2, s.y, s.z + rnd() * 0.2, 0.3 + rnd() * 0.3, 0.9 + Math.random() * 0.4, rnd() * 0.3, 0xc4c4c4, 0.45, 4, { grow: 0.8, alpha: 0.45 });
  }
  for (const l of world.lamps) {
    if (Math.hypot(l.x - cx, l.z - cz) < 40 && Math.random() < dt * 1.5) fx.glow.emit(l.x + rnd() * 0.4, l.y + rnd() * 0.3, l.z + rnd() * 0.4, rnd() * 0.2, 0.15, rnd() * 0.2, 0xffd080, 0.08, 2);
  }
  // светлячки в лесу и пыльца на лугах
  ambAcc += dt * 14;
  while (ambAcc >= 1) {
    ambAcc--;
    const a = Math.random() * 6.28, d = 4 + Math.random() * 26, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = getHeight(x, z);
    if (h < WATER_LEVEL) continue;
    const forest = Math.hypot(x - ZONES.forest.x, z - ZONES.forest.z) < 40;
    fx.glow.emit(x, h + 0.4 + Math.random() * 1.8, z, rnd() * 0.4, rnd() * 0.2, rnd() * 0.4, forest ? 0xd8ff6a : 0xfff4c0, forest ? 0.14 : 0.07, 4 + Math.random() * 3, { alpha: forest ? 1 : 0.6 });
  }
  // пыль из-под ног
  if (G.started && me.moving && me.onGround && !me.downed) {
    dustAcc += dt;
    if (dustAcc > 0.09) { dustAcc = 0; fx.smoke.emit(me.x + rnd() * 0.3, me.y + 0.1, me.z + rnd() * 0.3, rnd() * 0.4, 0.4, rnd() * 0.4, 0xb8a888, 0.35, 0.7, { grow: 1.0, alpha: 0.35 }); }
  }
}

// ================= Интерфейс =================
function setBar(name, v, max, text) {
  const el = document.querySelector(`#stats .bar.${name}`);
  el.querySelector('i').style.width = clamp((v / max) * 100, 0, 100) + '%';
  el.querySelector('span').textContent = text ?? `${Math.ceil(v)} / ${Math.round(max)}`;
}
function updateHUD() {
  setBar('hp', me.hp, me.maxHp);
  setBar('mp', me.mp, me.maxMp);
  $('lvl').textContent = G.lv[0];
  setBar('xp', G.lv[1], G.lv[2], '');
  const ab = CLASSES[me.cls].abilities;
  for (const k of ['atk', 'q', 'f']) {
    const el = $('slot-' + k);
    el.querySelector('.cd').style.height = (me.cds[k] / ab[k].cd) * 100 + '%';
    el.classList.toggle('nomana', me.mp < ab[k].mp);
  }
  $('slot-r').querySelector('.cd').style.height = me.cds.r * 100 + '%';
  $('pot-count').textContent = me.potions;

  const [qi, qp] = G.quest;
  const q = QUESTS[qi];
  if (q) { $('qtitle').textContent = q.title; $('qdesc').textContent = q.desc; $('qprog').textContent = `${qp} / ${q.need}`; }
  else { $('qtitle').textContent = 'Долина спасена!'; $('qdesc').textContent = 'Свободная охота: враги возрождаются, Король тоже вернётся.'; $('qprog').textContent = ''; }
  const zone = q ? ZONES[q.zone] : null;
  $('compass').classList.toggle('hidden', !zone);
  if (zone) {
    const dx = zone.x - me.x, dz = zone.z - me.z;
    const rel = normAngle(Math.atan2(dx, dz) - cam.yaw);
    $('carrow').style.transform = `rotate(${-rel}rad)`;
    $('cdist').textContent = `${zone.name} · ${Math.round(Math.hypot(dx, dz))} м`;
  }

  // сообщения по центру
  let msg = '';
  if (me.downed) {
    const solo = views.players.size === 0;
    msg = solo ? 'Вы повержены… Возрождение в деревне' : 'Вы повержены! Союзник может поднять вас (держать E рядом)';
    if (!solo) msg += `<div class="prog"><i style="width:${(me.revive / 3) * 100}%"></i></div>`;
  } else {
    for (const v of views.players.values()) {
      if (v.d && Math.hypot(v.pos.x - me.x, v.pos.z - me.z) < 2.6) {
        msg = `Держите <kbd>E</kbd>, чтобы поднять ${esc(v.name)}<div class="prog"><i style="width:${(v.rv / 3) * 100}%"></i></div>`;
        break;
      }
    }
  }
  if ($('center-msg').innerHTML !== msg) $('center-msg').innerHTML = msg;
}
function updateParty() {
  if (!G.state) return;
  $('party').innerHTML = G.state.pl.map((p) => `<div class="pm${p.d ? ' down' : ''}"><div class="pn"><span>${esc(p.n)}${p.id === G.myId ? ' (вы)' : ''}</span><small>${esc(CLASSES[p.c]?.name || '')}</small></div><div class="pbar"><i style="width:${(p.hp / p.mh) * 100}%"></i></div></div>`).join('');
}

// ================= Главный цикл =================
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (G.started) {
    updateLocal(dt);
    if (G.isHost) {
      G.sim.update(dt);
      G.snapAcc += dt;
      if (G.snapAcc >= 1 / 15) {
        G.snapAcc = 0;
        const s = G.sim.snapshot();
        if (G.net) G.net.broadcast(s);
        applyState(s);
      }
    }
    G.sendAcc += dt;
    if (G.sendAcc >= 0.05) {
      G.sendAcc = 0;
      sendToHost({ t: 'p', x: r2(me.x), y: r2(me.y), z: r2(me.z), ry: r2(me.ry), mv: me.moving ? 1 : 0, a: me.a, ak: me.ak, fl: me.flipN, e: keys.KeyE && !G.chatOpen ? 1 : 0 });
    }
    updateCamera();
    updateViews(dt, t);
    G.hudAcc += dt;
    if (G.hudAcc > 0.08) { G.hudAcc = 0; updateHUD(); }
    G.partyAcc += dt;
    if (G.partyAcc > 0.25) { G.partyAcc = 0; updateParty(); }
  } else {
    // в лобби камера медленно облетает деревню
    const a = t * 0.06;
    camera.position.set(Math.sin(a) * 32, 15, Math.cos(a) * 32);
    camera.lookAt(0, 2, 0);
    sun.position.copy(SUN_DIR); sun.target.position.set(0, 0, 0);
    if (elder) animateRig(elder, dt, false, false);
    ambient(dt);
  }
  world?.update(t);
  fx.update(dt);
  composer.render();
}
requestAnimationFrame(loop);

// Если хост свернул вкладку, браузер останавливает отрисовку — но мир должен жить дальше
setInterval(() => {
  if (!G.started || !G.isHost || performance.now() - last < 250) return;
  G.sim.update(0.05);
  const s = G.sim.snapshot();
  G.net?.broadcast(s);
  applyState(s);
}, 50);

// Для отладки из консоли браузера
window.__game = { G, me, cam, keys, useAbility, scene, fx, setLocked: (v) => { locked = v; } };
