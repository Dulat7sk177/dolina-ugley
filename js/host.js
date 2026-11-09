// Симуляция на стороне хоста: враги, урон, опыт, задания. Клиенты получают снимки состояния.
import { CLASSES, ENEMIES, ZONES, QUESTS, xpNeed } from './config.js';
import { getHeight, resolveCollision, cameraBlocked } from './maps.js';
import { resolveBoxes, pointBlocked } from './buildings.js';
import { LOOT } from './interiors.js';
import { MAP } from './config.js';
// игрок на другом этаже (выше врага) — недосягаем для ближнего боя
const reachY = (p, e) => Math.abs(p.y - getHeight(e.x, e.z)) < 2.4;

const r2 = (n) => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const BOSS_QUEST = QUESTS.findIndex((q) => q.type === 'boss');
let nextId = 1;

export class HostSim {
  constructor() {
    this.players = new Map();
    this.enemies = []; this.projectiles = []; this.drops = []; this.events = []; this.cars = [];
    if (MAP.id === 'astana') for (const l of LOOT) this.drops.push({ id: nextId++, x: l.x, y: l.y, z: l.z, t: Infinity, perm: true, hidden: 0 });
    this.level = 1; this.xp = 0; this.questIdx = 0; this.questProg = 0;
    this.time = 0; this.wipeT = 0;
    for (const [key, z] of Object.entries(ZONES)) {
      if (!z.enemy || z.enemy === 'boss') continue;
      for (let i = 0; i < z.count; i++) this.spawnEnemy(z.enemy, key);
    }
  }

  spawnPoint() { const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 2.5; return { x: ZONES.village.x + Math.sin(a) * d, z: ZONES.village.z + Math.cos(a) * d }; }
  maxHpFor(cls) { return CLASSES[cls].hp + (this.level - 1) * 15; }

  spawnEnemy(type, zoneKey) {
    const z = ZONES[zoneKey];
    const a = Math.random() * Math.PI * 2, d = type === 'boss' ? 0 : Math.random() * z.r * 0.7;
    const e = { type, zone: zoneKey, hx: z.x + Math.cos(a) * d, hz: z.z + Math.sin(a) * d };
    this.resetEnemy(e);
    this.enemies.push(e);
    return e;
  }
  resetEnemy(e) {
    const def = ENEMIES[e.type];
    const mul = (1 + 0.1 * (this.level - 1)) * (e.type === 'boss' ? 0.6 + 0.4 * Math.max(1, this.players.size) : 1);
    Object.assign(e, {
      id: nextId++, x: e.hx, z: e.hz, ry: Math.random() * 6.28, maxHp: Math.round(def.hp * mul),
      atkCd: 1, atkSeq: 0, target: null, aggroLock: 0, mv: 0, slowT: 0, dead: false, respawnT: 0,
      slamT: 4, slamWind: 0, wanderT: Math.random() * 3, wx: e.hx, wz: e.hz,
    });
    e.hp = e.maxHp;
  }
  checkBoss() {
    if (this.questIdx >= BOSS_QUEST && !this.enemies.some((e) => e.type === 'boss')) {
      this.spawnEnemy('boss', 'arena');
      this.events.push({ k: 'sys', text: 'Гримвальд Рогатый пробудился на арене!' });
    }
  }

  addPlayer(id, name, cls) {
    const sp = this.spawnPoint();
    const maxHp = this.maxHpFor(cls);
    this.players.set(id, { id, name, cls, x: sp.x, y: getHeight(sp.x, sp.z), z: sp.z, ry: 0, mv: 0, a: 0, ak: '', hp: maxHp, maxHp, downed: false, reviveT: 0, potions: 2, shieldT: 0, lastHit: -99, holdE: false, w: 0, dashT: 0, spinT: 0, tick: 0, carCd: 0, car: 0 });
    this.events.push({ k: 'tp', id, x: r2(sp.x), z: r2(sp.z) }, { k: 'sys', text: `${name} присоединился к отряду` });
  }
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.leaveCar(p);
    this.players.delete(id);
    this.events.push({ k: 'sys', text: `${p.name} покинул игру` });
  }

  onMessage(id, m) {
    const p = this.players.get(id);
    if (!p || !m) return;
    switch (m.t) {
      case 'p':
        if (Number.isFinite(m.x) && Number.isFinite(m.z)) { p.x = m.x; p.y = m.y; p.z = m.z; }
        p.ry = m.ry; p.mv = m.mv; p.a = m.a; p.ak = m.ak; p.fl = m.fl | 0; p.holdE = !!m.e; p.w = m.w | 0;
        // водитель присылает состояние машины
        if (m.car && p.car) { const c = this.cars.find((c2) => c2.id === p.car); if (c && c.seats[0] === p.id) Object.assign(c, { x: m.car[0], y: m.car[1], z: m.car[2], ry: m.car[3], v: m.car[4] }); }
        break;
      case 'atk':
        if (!p.downed) this.doAttack(p, m);
        break;
      case 'potion':
        if (!p.downed && p.potions > 0 && p.hp < p.maxHp) {
          p.potions--;
          const heal = Math.round(p.maxHp * 0.5);
          p.hp = Math.min(p.maxHp, p.hp + heal);
          this.events.push({ k: 'dmg', x: r2(p.x), y: r2(p.y + 2.3), z: r2(p.z), v: '+' + heal, c: 'heal' });
        }
        break;
      case 'summon': this.summonCar(p); break;
      case 'carIn': this.enterCar(p, m.id); break;
      case 'carOut': this.leaveCar(p); break;
      case 'chat':
        if (typeof m.text === 'string' && m.text.trim()) this.events.push({ k: 'chat', from: p.name, text: m.text.slice(0, 200) });
        break;
    }
  }

  weapon(p, m) { const c = CLASSES[p.cls]; return c && c.weapons[(m.w | 0) % c.weapons.length]; }
  mult() { return 1 + 0.12 * (this.level - 1); }
  // Луч: первая стена/земля (шаг 0.6 м)
  wallHit(o, d, max) {
    for (let t = 0.6; t < max; t += 0.6) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      if (y < getHeight(x, z) + 0.02 || cameraBlocked(x, y, z)) return t;
    }
    return max;
  }
  // Луч: ближайший враг до дистанции max
  rayEnemy(o, d, max, skip) {
    let best = null, bt = max;
    for (const e of this.enemies) {
      if (e.dead || (skip && skip.has(e.id))) continue;
      const def = ENEMIES[e.type], cy = getHeight(e.x, e.z) + def.scale * 1.0;
      const vx = e.x - o[0], vy = cy - o[1], vz = e.z - o[2], t = vx * d[0] + vy * d[1] + vz * d[2];
      if (t < 0 || t > bt) continue;
      const px = vx - d[0] * t, py = (vy - d[1] * t) * 0.6, pz = vz - d[2] * t; // вытянутая по вертикали «капсула»
      if (px * px + py * py + pz * pz < (def.radius + 0.35) ** 2 * (e.type === 'boss' ? 4 : 1)) { best = e; bt = t; }
    }
    return best ? { e: best, t: bt } : null;
  }
  doAttack(p, m) {
    const w = this.weapon(p, m);
    if (!w) return;
    const spec = m.alt ? w.alt : w.primary, mult = this.mult();
    const o = Array.isArray(m.o) ? m.o.map(Number) : [p.x, p.y + 1.45, p.z];
    let d = Array.isArray(m.d) ? m.d.map(Number) : [Math.sin(p.ry), 0, Math.cos(p.ry)];
    const dl = Math.hypot(...d) || 1; d = d.map((v) => v / dl);
    const ry = Number(m.ry) || p.ry || 0, fx = Math.sin(ry), fz = Math.cos(ry);
    const alive = this.enemies.filter((e) => !e.dead);
    switch (spec.kind) {
      case 'shot': {
        const ends = [];
        for (let i = 0; i < (spec.pellets || 1); i++) {
          const j = [d[0] + (Math.random() - 0.5) * 2 * spec.spread, d[1] + (Math.random() - 0.5) * 2 * spec.spread, d[2] + (Math.random() - 0.5) * 2 * spec.spread];
          const jl = Math.hypot(...j); for (let k = 0; k < 3; k++) j[k] /= jl;
          const wt = this.wallHit(o, j, spec.range), hit = this.rayEnemy(o, j, wt);
          const t = hit ? hit.t : wt;
          if (hit) { const fall = spec.falloff ? Math.max(0.35, 1 - t / spec.range) : 1; this.damageEnemy(hit.e, spec.dmg * mult * fall, p.id, true); }
          ends.push(r2(o[0] + j[0] * t), r2(o[1] + j[1] * t), r2(o[2] + j[2] * t));
        }
        this.events.push({ k: 'tr', pid: p.id, o: o.map(r2), e: ends, w: w.id });
        break;
      }
      case 'grenade':
        this.projectiles.push({ id: nextId++, type: 'g', x: o[0] + d[0], y: o[1] + d[1], z: o[2] + d[2], vx: d[0] * 26, vy: d[1] * 26 + 3, vz: d[2] * 26, g: -16, life: 3, dmg: spec.dmg * mult, radius: spec.radius, owner: p.id });
        break;
      case 'melee':
        for (const e of alive) {
          const dx = e.x - p.x, dz = e.z - p.z, dd = Math.hypot(dx, dz);
          if (reachY(p, e) && dd < spec.range + ENEMIES[e.type].radius && (dd < 0.8 || (dx * fx + dz * fz) / dd > 0.25)) this.damageEnemy(e, spec.dmg * mult, p.id);
        }
        break;
      case 'dash': p.dashT = spec.dur; p.tick = 0; p.dashSpec = spec; break;
      case 'spin': p.spinT = spec.dur; p.tick = 0; p.spinSpec = spec; break;
      case 'smoke': break;
      case 'hook': this.events.push({ k: 'rope', pid: p.id, to: (m.to || []).map(r2) }); break;
      case 'kunai':
        this.projectiles.push({ id: nextId++, type: 'k', x: o[0] + d[0] * 0.6, y: o[1] + d[1] * 0.6, z: o[2] + d[2] * 0.6, vx: d[0] * spec.speed, vy: d[1] * spec.speed, vz: d[2] * spec.speed, g: -2, life: 1.6, dmg: spec.dmg * mult, pierce: spec.pierce, hits: new Set(), owner: p.id, t: 0 });
        break;
      case 'kunaiTp': {
        const k = this.projectiles.filter((q) => q.type === 'k' && q.owner === p.id && q.stuck).sort((a, b) => b.t - a.t)[0];
        if (!k) break;
        let x = k.x, y = k.y, z = k.z;
        if (k.enemy) { const e = this.enemies.find((e2) => e2.id === k.enemy && !e2.dead); if (e) { this.damageEnemy(e, 40 * mult, p.id); x = e.x - Math.sin(k.ry || 0) * 1.4; z = e.z - Math.cos(k.ry || 0) * 1.4; y = getHeight(x, z); } }
        else { x -= Math.sin(k.ry || 0) * 0.8; z -= Math.cos(k.ry || 0) * 0.8; y = Math.max(getHeight(x, z), y - 1.2); }
        this.projectiles = this.projectiles.filter((q) => q !== k);
        this.events.push({ k: 'tp', id: p.id, x: r2(x), y: r2(y), z: r2(z), fx: 'smoke' });
        break;
      }
      case 'blink': {
        const to = (m.to || []).map(Number);
        if (to.length !== 3 || Math.hypot(to[0] - p.x, to[2] - p.z) > spec.range + 2) break;
        for (const e of alive) if (Math.hypot(e.x - to[0], e.z - to[2]) < spec.radius + ENEMIES[e.type].radius) { e.slowT = 1.5; this.damageEnemy(e, spec.dmg * mult, p.id); }
        this.events.push({ k: 'bolt', x: r2(to[0]), y: r2(to[1]), z: r2(to[2]), from: [r2(p.x), r2(p.y), r2(p.z)] });
        this.events.push({ k: 'tp', id: p.id, x: r2(to[0]), y: r2(to[1]), z: r2(to[2]) });
        break;
      }
    }
  }

  // ===== машина Rider'а =====
  summonCar(p) {
    if (p.cls !== 'rider' || p.carCd > 0 || p.downed) return;
    if (this.cars.some((c) => c.owner === p.id)) return; // машина уже есть
    const x = p.x + Math.sin(p.ry) * 4, z = p.z + Math.cos(p.ry) * 4;
    this.cars.push({ id: nextId++, owner: p.id, x, y: Math.max(getHeight(x, z), p.y), z, ry: p.ry + Math.PI / 2, v: 0, t: 180, seats: [null, null, null, null] });
    this.events.push({ k: 'sys', text: `${p.name} призвал Dodge Challenger! Садитесь — E` }, { k: 'carFx', x: r2(x), z: r2(z) });
  }
  dropCar(c) { for (const id of c.seats) { const q = this.players.get(id); if (q) q.car = 0; } c.seats = [null, null, null, null]; const o = this.players.get(c.owner); if (o) o.carCd = 60; }
  enterCar(p, id) {
    const c = this.cars.find((c2) => c2.id === id);
    if (!c || p.car || p.downed || Math.hypot(c.x - p.x, c.z - p.z) > 5) return;
    const seat = c.seats.indexOf(null);
    if (seat < 0) return;
    c.seats[seat] = p.id; p.car = c.id;
  }
  leaveCar(p) {
    if (!p || !p.car) return;
    const c = this.cars.find((c2) => c2.id === p.car);
    if (c) { const i = c.seats.indexOf(p.id); if (i >= 0) c.seats[i] = null; if (i === 0) c.v = 0; }
    p.car = 0;
  }

  damageEnemy(e, dmg, byId, ranged) {
    if (e.dead) return;
    const crit = Math.random() < (ranged ? 0.06 : 0.1);
    dmg = Math.round(dmg * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1));
    e.hp -= dmg; e.target = byId; e.aggroLock = 6;
    const def = ENEMIES[e.type];
    this.events.push({ k: 'dmg', x: r2(e.x), y: r2(getHeight(e.x, e.z) + def.scale * 2.1), z: r2(e.z), v: dmg, c: crit ? 'crit' : 'enemy' });
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    const def = ENEMIES[e.type];
    e.dead = true; e.hp = 0;
    e.respawnT = e.type === 'boss' ? 180 : 25;
    this.events.push({ k: 'die', id: e.id });
    this.gainXp(def.xp);
    const q = QUESTS[this.questIdx];
    if (q && q.type === e.type) {
      this.questProg++;
      if (this.questProg >= q.need) {
        this.events.push({ k: 'quest', title: q.title });
        this.questIdx++; this.questProg = 0;
        this.gainXp(q.reward);
        if (this.questIdx >= QUESTS.length) this.events.push({ k: 'victory' });
        this.checkBoss();
      }
    }
    const drops = e.type === 'boss' ? 4 : Math.random() < 0.3 ? 1 : 0;
    for (let i = 0; i < drops; i++) this.drops.push({ id: nextId++, x: e.x + (Math.random() - 0.5) * 2 * Math.min(1, i), z: e.z + (Math.random() - 0.5) * 2 * Math.min(1, i), t: 60 });
  }

  gainXp(n) {
    this.xp += n;
    while (this.xp >= xpNeed(this.level)) {
      this.xp -= xpNeed(this.level);
      this.level++;
      for (const p of this.players.values()) { p.maxHp = this.maxHpFor(p.cls); if (!p.downed) p.hp = p.maxHp; }
      this.events.push({ k: 'levelup', level: this.level });
    }
  }

  damagePlayer(p, dmg) {
    if (p.downed) return;
    if (p.shieldT > 0) dmg *= 0.35;
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg; p.lastHit = this.time;
    this.events.push({ k: 'dmg', x: r2(p.x), y: r2(p.y + 2.3), z: r2(p.z), v: dmg, c: 'player', pid: p.id });
    if (p.hp <= 0) {
      p.hp = 0; p.downed = true; p.reviveT = 0;
      this.events.push({ k: 'down', id: p.id, name: p.name });
    }
  }

  update(dt) {
    this.time += dt;
    const players = [...this.players.values()];
    const standing = players.filter((p) => !p.downed);

    // --- игроки: регенерация, щит, поднятие союзников ---
    for (const p of players) {
      p.shieldT = Math.max(0, p.shieldT - dt);
      p.carCd = Math.max(0, p.carCd - dt);
      if (p.dashT > 0 || p.spinT > 0) {
        p.tick -= dt;
        const spin = p.spinT > 0, sp = spin ? p.spinSpec : p.dashSpec;
        if (spin) p.spinT -= dt; else p.dashT -= dt;
        if (p.tick <= 0 && sp) {
          p.tick = sp.tick;
          const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
          for (const e of this.enemies) {
            if (e.dead || !reachY(p, e)) continue;
            const dx = e.x - p.x, dz = e.z - p.z, dd = Math.hypot(dx, dz), r = (spin ? sp.radius : 2.8) + ENEMIES[e.type].radius;
            if (dd < r && (spin || dd < 0.8 || (dx * fx + dz * fz) / dd > 0.2)) this.damageEnemy(e, sp.dmg * this.mult(), p.id);
          }
        }
      }
      if (!p.downed && this.time - p.lastHit > 6 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.02 * dt);
      if (p.downed) {
        const helper = standing.find((q) => q.holdE && dist(q, p) < 2.6);
        p.reviveT = helper ? p.reviveT + dt : Math.max(0, p.reviveT - dt * 0.5);
        if (p.reviveT >= 3) {
          p.downed = false; p.reviveT = 0; p.hp = Math.round(p.maxHp * 0.4);
          this.events.push({ k: 'revive', id: p.id, name: p.name });
        }
      }
    }
    if (players.length && standing.length === 0) {
      this.wipeT += dt;
      if (this.wipeT >= 4) {
        this.wipeT = 0;
        for (const p of players) {
          const sp = this.spawnPoint();
          p.downed = false; p.reviveT = 0; p.hp = Math.round(p.maxHp * 0.6); p.x = sp.x; p.z = sp.z;
          this.events.push({ k: 'tp', id: p.id, x: r2(sp.x), z: r2(sp.z) });
        }
        this.events.push({ k: 'wipe' });
      }
    } else this.wipeT = 0;

    // --- враги ---
    const live = [];
    for (const e of this.enemies) {
      if (e.dead) {
        e.respawnT -= dt;
        if (e.respawnT <= 0) this.resetEnemy(e);
        continue;
      }
      live.push(e);
      const def = ENEMIES[e.type];
      e.atkCd -= dt; e.slowT = Math.max(0, e.slowT - dt); e.aggroLock -= dt;
      const spd = def.speed * (e.slowT > 0 ? 0.45 : 1);
      e.mv = 0;

      if (e.slamWind > 0) { // босс замахивается — стоит на месте
        e.slamWind -= dt;
        if (e.slamWind <= 0) {
          for (const p of standing) if (dist(p, e) < 6.5 && reachY(p, e)) this.damagePlayer(p, def.dmg * 1.4);
          this.events.push({ k: 'ring', x: r2(e.x), z: r2(e.z), r: 6.5, c: 0xff5533 });
        }
        continue;
      }

      const homeD = Math.hypot(e.x - e.hx, e.z - e.hz);
      let tgt = null, td = Infinity;
      if (homeD < 42) {
        for (const p of standing) {
          const d = dist(p, e);
          const range = e.target === p.id && e.aggroLock > 0 ? 40 : def.aggro;
          if (d < range && d < td && reachY(p, e) && !p.car) { tgt = p; td = d; }
        }
      }
      if (tgt) {
        e.target = tgt.id;
        const dx = tgt.x - e.x, dz = tgt.z - e.z;
        e.ry = Math.atan2(dx, dz);
        const reach = def.range + 0.4;
        if (td > reach - 0.4) { e.x += (dx / td) * spd * dt; e.z += (dz / td) * spd * dt; e.mv = 1; }
        if (td < reach && e.atkCd <= 0) {
          e.atkCd = def.cd; e.atkSeq++;
          this.damagePlayer(tgt, def.dmg * (1 + 0.08 * (this.level - 1)));
        }
        if (e.type === 'boss') {
          e.slamT -= dt;
          if (e.slamT <= 0 && td < 9) { e.slamT = 7; e.slamWind = 1.1; this.events.push({ k: 'warn', id: e.id, x: r2(e.x), z: r2(e.z), r: 6.5, t: 1.1 }); }
        }
      } else {
        e.target = null;
        let gx, gz, sp = spd;
        if (homeD > 3) { gx = e.hx; gz = e.hz; e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25 * dt); }
        else {
          e.wanderT -= dt;
          if (e.wanderT <= 0) {
            const a = Math.random() * 6.28, d = Math.random() * ZONES[e.zone].r * 0.6;
            e.wx = e.hx + Math.cos(a) * d; e.wz = e.hz + Math.sin(a) * d; e.wanderT = 3 + Math.random() * 4;
          }
          gx = e.wx; gz = e.wz; sp = spd * 0.4;
        }
        const dx = gx - e.x, dz = gz - e.z, d = Math.hypot(dx, dz);
        if (d > 0.5) { e.x += (dx / d) * sp * dt; e.z += (dz / d) * sp * dt; e.ry = Math.atan2(dx, dz); e.mv = 1; }
      }
    }
    // раздвигаем врагов, чтобы не слипались
    for (let i = 0; i < live.length; i++) {
      const a = live[i], ra = ENEMIES[a.type].radius;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j], rr = ra + ENEMIES[b.type].radius;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), k = ((rr - d) / d) * 0.5; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; }
      }
      resolveCollision(a, ra);
      resolveBoxes(a, ra, getHeight(a.x, a.z));
    }

    // --- снаряды: гранаты и кунаи ---
    const boom = (pr) => {
      for (const e of live) if (!e.dead && Math.hypot(e.x - pr.x, e.z - pr.z) < pr.radius + ENEMIES[e.type].radius && Math.abs(getHeight(e.x, e.z) - pr.y) < pr.radius) this.damageEnemy(e, pr.dmg * Math.max(0.4, 1 - Math.hypot(e.x - pr.x, e.z - pr.z) / (pr.radius * 1.4)), pr.owner);
      this.events.push({ k: 'boom', x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), big: 1 });
    };
    this.projectiles = this.projectiles.filter((pr) => {
      pr.t = (pr.t || 0) + dt;
      if (pr.stuck) {
        pr.life -= dt;
        if (pr.enemy) { const e = this.enemies.find((e2) => e2.id === pr.enemy); if (!e || e.dead) return false; pr.x = e.x + pr.ox; pr.z = e.z + pr.oz; pr.y = getHeight(e.x, e.z) + pr.oy; }
        return pr.life > 0;
      }
      const steps = Math.ceil(Math.hypot(pr.vx, pr.vy, pr.vz) * dt / 0.5) || 1, h = dt / steps;
      for (let i = 0; i < steps; i++) {
        pr.vy += pr.g * h; pr.x += pr.vx * h; pr.y += pr.vy * h; pr.z += pr.vz * h;
        pr.ry = Math.atan2(pr.vx, pr.vz); pr.rx = -Math.atan2(pr.vy, Math.hypot(pr.vx, pr.vz));
        const wall = pr.y < getHeight(pr.x, pr.z) + 0.05 || cameraBlocked(pr.x, pr.y, pr.z);
        if (pr.type === 'g') {
          let hit = wall;
          if (!hit) for (const e of live) if (!e.dead && Math.hypot(e.x - pr.x, e.z - pr.z) < ENEMIES[e.type].radius + 0.4 && Math.abs(getHeight(e.x, e.z) + ENEMIES[e.type].scale - pr.y) < ENEMIES[e.type].scale + 0.6) { hit = true; break; }
          if (hit) { boom(pr); return false; }
        } else {
          if (wall) { pr.stuck = true; pr.life = 5; pr.x -= pr.vx * h; pr.y -= pr.vy * h; pr.z -= pr.vz * h; return true; }
          for (const e of live) {
            if (e.dead || pr.hits.has(e.id)) continue;
            const def = ENEMIES[e.type];
            if (Math.hypot(e.x - pr.x, e.z - pr.z) < def.radius + 0.35 && Math.abs(getHeight(e.x, e.z) + def.scale - pr.y) < def.scale * 1.2 + 0.3) {
              pr.hits.add(e.id); this.damageEnemy(e, pr.dmg, pr.owner, true);
              if (--pr.pierce <= 0 && !e.dead) { pr.stuck = true; pr.life = 5; pr.enemy = e.id; pr.ox = pr.x - e.x; pr.oz = pr.z - e.z; pr.oy = pr.y - getHeight(e.x, e.z); return true; }
            }
          }
        }
      }
      pr.life -= dt;
      if (pr.life <= 0 && pr.type === 'g') { boom(pr); return false; }
      return pr.life > 0;
    });

    // --- машины: таймер, давим зомби ---
    this.cars = this.cars.filter((c) => {
      c.t -= dt;
      if (c.t <= 0) { this.dropCar(c); this.events.push({ k: 'carFx', x: r2(c.x), z: r2(c.z) }); return false; }
      if (Math.abs(c.v) > 3) {
        const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
        for (const e of live) {
          if (e.dead) continue;
          e.carHit = (e.carHit || 0) - dt;
          const dx = e.x - c.x, dz = e.z - c.z, along = dx * fx + dz * fz, side = -dx * fz + dz * fx;
          if (Math.abs(along) < 2.9 + ENEMIES[e.type].radius && Math.abs(side) < 1.2 + ENEMIES[e.type].radius && e.carHit <= 0) {
            e.carHit = 0.6;
            this.damageEnemy(e, Math.abs(c.v) * (e.type === 'boss' ? 1.5 : 4) * this.mult(), c.seats[0] || c.owner);
            if (!e.dead && e.type !== 'boss') { const k = Math.sign(side || 1) * 3; e.x += -fz * k + fx * 2; e.z += fx * k + fz * 2; }
          }
        }
      }
      return true;
    });

    // --- зелья на земле ---
    this.drops = this.drops.filter((d) => {
      d.t -= dt;
      if (d.hidden > 0) { d.hidden -= dt; return true; } // аптечка в здании ждёт возрождения
      const dy = d.y ?? getHeight(d.x, d.z);
      for (const p of standing) {
        if (p.potions < 5 && Math.hypot(p.x - d.x, p.z - d.z) < 1.6 && Math.abs(p.y - dy) < 2) {
          p.potions++;
          this.events.push({ k: 'pickup', id: p.id });
          if (d.perm) { d.hidden = 120; return true; }
          return false;
        }
      }
      return d.t > 0;
    });
  }

  snapshot() {
    const s = {
      t: 's',
      pl: [...this.players.values()].map((p) => ({
        id: p.id, n: p.name, c: p.cls, x: r2(p.x), y: r2(p.y), z: r2(p.z), ry: r2(p.ry), mv: p.mv ? 1 : 0, a: p.a, ak: p.ak,
        hp: Math.ceil(p.hp), mh: p.maxHp, d: p.downed ? 1 : 0, rv: r2(p.reviveT), po: p.potions, sh: p.shieldT > 0 ? 1 : 0, fl: p.fl | 0, w: p.w | 0, car: p.car || 0, cc: Math.ceil(p.carCd),
      })),
      en: this.enemies.filter((e) => !e.dead).map((e) => [e.id, e.type, r2(e.x), r2(e.z), r2(e.ry), e.mv, e.atkSeq, Math.ceil(e.hp), e.maxHp, e.slowT > 0 ? 1 : 0]),
      pr: this.projectiles.map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), p.type, p.stuck ? 1 : 0, r2(p.ry || 0), r2(p.rx || 0), p.owner]),
      cars: this.cars.map((c) => [c.id, c.owner, r2(c.x), r2(c.y), r2(c.z), r2(c.ry), r2(c.v), c.seats, Math.ceil(c.t)]),
      dr: this.drops.filter((d) => !(d.hidden > 0)).map((d) => (d.y !== undefined ? [d.id, r2(d.x), r2(d.z), r2(d.y)] : [d.id, r2(d.x), r2(d.z)])),
      q: [this.questIdx, this.questProg],
      lv: [this.level, Math.floor(this.xp), xpNeed(this.level)],
      ev: this.events,
    };
    this.events = [];
    return s;
  }
}
