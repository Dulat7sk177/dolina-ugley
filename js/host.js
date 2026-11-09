// Симуляция на стороне хоста: враги, урон, опыт, задания. Клиенты получают снимки состояния.
import { CLASSES, ENEMIES, ZONES, QUESTS, xpNeed } from './config.js';
import { getHeight, resolveCollision, cameraBlocked } from './maps.js';
import { resolveBoxes, pointBlocked } from './buildings.js';
// игрок на другом этаже (выше врага) — недосягаем для ближнего боя
const reachY = (p, e) => Math.abs(p.y - getHeight(e.x, e.z)) < 2.4;

const r2 = (n) => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const BOSS_QUEST = QUESTS.findIndex((q) => q.type === 'boss');
let nextId = 1;

export class HostSim {
  constructor() {
    this.players = new Map();
    this.enemies = []; this.projectiles = []; this.drops = []; this.events = [];
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
    this.players.set(id, { id, name, cls, x: sp.x, y: getHeight(sp.x, sp.z), z: sp.z, ry: 0, mv: 0, a: 0, ak: '', hp: maxHp, maxHp, downed: false, reviveT: 0, potions: 2, shieldT: 0, lastHit: -99, holdE: false });
    this.events.push({ k: 'tp', id, x: r2(sp.x), z: r2(sp.z) }, { k: 'sys', text: `${name} присоединился к отряду` });
  }
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.events.push({ k: 'sys', text: `${p.name} покинул игру` });
  }

  onMessage(id, m) {
    const p = this.players.get(id);
    if (!p || !m) return;
    switch (m.t) {
      case 'p':
        if (Number.isFinite(m.x) && Number.isFinite(m.z)) { p.x = m.x; p.y = m.y; p.z = m.z; }
        p.ry = m.ry; p.mv = m.mv; p.a = m.a; p.ak = m.ak; p.fl = m.fl | 0; p.holdE = !!m.e;
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
      case 'chat':
        if (typeof m.text === 'string' && m.text.trim()) this.events.push({ k: 'chat', from: p.name, text: m.text.slice(0, 200) });
        break;
    }
  }

  doAttack(p, m) {
    const base = CLASSES[p.cls].dmg * (1 + 0.12 * (this.level - 1));
    const ry = Number(m.ry) || 0, fx = Math.sin(ry), fz = Math.cos(ry);
    const alive = this.enemies.filter((e) => !e.dead);
    switch (m.kind) {
      case 'slash':
        for (const e of alive) {
          const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
          if (reachY(p, e) && d < 2.7 + ENEMIES[e.type].radius && (d < 0.8 || (dx * fx + dz * fz) / d > 0.3)) this.damageEnemy(e, base, p.id);
        }
        break;
      case 'spin':
        for (const e of alive) if (reachY(p, e) && dist(e, p) < 3.6 + ENEMIES[e.type].radius) this.damageEnemy(e, base * 1.5, p.id);
        this.events.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: 3.8, c: 0xffffff });
        break;
      case 'shield':
        p.shieldT = 5;
        break;
      case 'fireball':
        this.projectiles.push({ id: nextId++, x: p.x + fx * 0.8, y: p.y + 1.4, z: p.z + fz * 0.8, vx: fx * 24, vz: fz * 24, life: 1.5, dmg: base, owner: p.id });
        break;
      case 'heal':
        for (const q of this.players.values()) {
          if (dist(q, p) > 7.5) continue;
          if (q.downed) { q.downed = false; q.reviveT = 0; q.hp = Math.round(q.maxHp * 0.3); this.events.push({ k: 'revive', id: q.id, name: q.name }); continue; }
          const heal = Math.round(q.maxHp * 0.35);
          q.hp = Math.min(q.maxHp, q.hp + heal);
          this.events.push({ k: 'dmg', x: r2(q.x), y: r2(q.y + 2.3), z: r2(q.z), v: '+' + heal, c: 'heal' });
        }
        this.events.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: 7.5, c: 0x55ff88 });
        break;
      case 'nova':
        for (const e of alive) if (reachY(p, e) && dist(e, p) < 6 + ENEMIES[e.type].radius) { e.slowT = 3; this.damageEnemy(e, base * 0.8, p.id); }
        this.events.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: 6, c: 0x88ddff });
        break;
    }
  }

  damageEnemy(e, dmg, byId) {
    if (e.dead) return;
    const crit = Math.random() < 0.1;
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
          if (d < range && d < td && reachY(p, e)) { tgt = p; td = d; }
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

    // --- снаряды ---
    this.projectiles = this.projectiles.filter((pr) => {
      pr.x += pr.vx * dt; pr.z += pr.vz * dt; pr.life -= dt;
      let hit = pr.y < getHeight(pr.x, pr.z) + 0.2 || cameraBlocked(pr.x, pr.y, pr.z);
      if (!hit) {
        for (const e of live) {
          if (e.dead) continue;
          const def = ENEMIES[e.type];
          if (Math.hypot(e.x - pr.x, e.z - pr.z) < def.radius + 0.55 && Math.abs(pr.y - getHeight(e.x, e.z) - def.scale) < def.scale * 1.6 + 0.6) { this.damageEnemy(e, pr.dmg, pr.owner); hit = true; break; }
        }
      }
      if (hit) this.events.push({ k: 'boom', x: r2(pr.x), y: r2(pr.y), z: r2(pr.z) });
      return !hit && pr.life > 0;
    });

    // --- зелья на земле ---
    this.drops = this.drops.filter((d) => {
      d.t -= dt;
      for (const p of standing) {
        if (p.potions < 5 && Math.hypot(p.x - d.x, p.z - d.z) < 1.6) {
          p.potions++;
          this.events.push({ k: 'pickup', id: p.id });
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
        hp: Math.ceil(p.hp), mh: p.maxHp, d: p.downed ? 1 : 0, rv: r2(p.reviveT), po: p.potions, sh: p.shieldT > 0 ? 1 : 0, fl: p.fl | 0,
      })),
      en: this.enemies.filter((e) => !e.dead).map((e) => [e.id, e.type, r2(e.x), r2(e.z), r2(e.ry), e.mv, e.atkSeq, Math.ceil(e.hp), e.maxHp, e.slowT > 0 ? 1 : 0]),
      pr: this.projectiles.map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z)]),
      dr: this.drops.map((d) => [d.id, r2(d.x), r2(d.z)]),
      q: [this.questIdx, this.questProg],
      lv: [this.level, Math.floor(this.xp), xpNeed(this.level)],
      ev: this.events,
    };
    this.events = [];
    return s;
  }
}
