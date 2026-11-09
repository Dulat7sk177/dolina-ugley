// Система частиц на GPU: искры, огонь, дым, магия, светлячки
import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const TEX = softTexture();
const tmpC = new THREE.Color();

export class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX }, scale: { value: 600 } },
      vertexShader: `attribute vec3 pcolor; attribute float psize; attribute float palpha; uniform float scale;
        varying vec3 vC; varying float vA;
        void main(){ vC = pcolor; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = palpha > 0.0 ? psize * scale / -mv.z : 0.0; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  setScale(renderer, camera) {
    this.mat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  emit(x, y, z, vx, vy, vz, color, size, life, o = {}) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    tmpC.set(color);
    this.col[i3] = tmpC.r; this.col[i3 + 1] = tmpC.g; this.col[i3 + 2] = tmpC.b;
    this.size[i] = size; this.life[i] = this.maxLife[i] = life;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0; this.grow[i] = o.grow ?? 0; this.a0[i] = o.alpha ?? 1;
  }
  update(dt) {
    const { pos, vel, life, maxLife, alpha, size } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      life[i] -= dt;
      const i3 = i * 3, k = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k + this.grav[i] * dt; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      size[i] += this.grow[i] * dt;
      const t = life[i] / maxLife[i];
      alpha[i] = life[i] > 0 ? this.a0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8) : 0;
    }
    for (const n of ['position', 'pcolor', 'psize', 'palpha']) this.geo.attributes[n].needsUpdate = true;
  }
}

// Готовые эффекты
export class FX {
  constructor(scene) {
    this.glow = new Particles(scene, 4000, true);
    this.smoke = new Particles(scene, 1200, false);
  }
  setScale(r, c) { this.glow.setScale(r, c); this.smoke.setScale(r, c); }
  update(dt) { this.glow.update(dt); this.smoke.update(dt); }
  burst(x, y, z, n, colors, speed, size, life, o = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.6);
      const col = colors[Math.floor(Math.random() * colors.length)];
      (o.smoke ? this.smoke : this.glow).emit(x, y, z, Math.cos(a) * r * sp, Math.abs(u) * sp * (o.up ?? 1), Math.sin(a) * r * sp, col, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), o);
    }
  }
  sparks(x, y, z, crit) { this.burst(x, y, z, crit ? 26 : 12, [0xffffff, 0xffe08a, 0xffa040], crit ? 9 : 6, 0.18, 0.4, { gravity: -14, drag: 1 }); }
  fireBurst(x, y, z) {
    this.burst(x, y, z, 26, [0xffe08a, 0xff9a30, 0xff5a1a], 5, 0.55, 0.45, { drag: 3, gravity: 2 });
    this.burst(x, y, z, 8, [0x555555, 0x777777], 1.5, 0.6, 1.0, { smoke: true, grow: 1.2, gravity: 1, alpha: 0.5 });
  }
  ring(x, y, z, r, colors, n = 50, rise = 2) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, d = r * (0.3 + Math.random() * 0.7);
      this.glow.emit(x + Math.cos(a) * d, y + 0.2, z + Math.sin(a) * d, 0, rise * (0.5 + Math.random()), 0, colors[k % colors.length], 0.28, 0.9 + Math.random() * 0.5, { drag: 0.5 });
    }
  }
  shockwave(x, y, z, colors, speed, n = 60, smoke = false) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.1, sp = speed * (0.7 + Math.random() * 0.4);
      (smoke ? this.smoke : this.glow).emit(x, y + 0.3 + Math.random() * 0.4, z, Math.cos(a) * sp, Math.random() * 1.5, Math.sin(a) * sp, colors[k % colors.length], smoke ? 0.9 : 0.3, 0.6, { drag: 3, grow: smoke ? 1.5 : 0, alpha: smoke ? 0.6 : 1 });
    }
  }
  spiral(x, y, z, colors) {
    for (let k = 0; k < 70; k++) {
      const a = k * 0.45, h = k * 0.05;
      this.glow.emit(x + Math.cos(a) * 1.1, y + h, z + Math.sin(a) * 1.1, -Math.sin(a) * 1.5, 1.6, Math.cos(a) * 1.5, colors[k % colors.length], 0.16, 1.3, { drag: 0.5 });
    }
  }
  soul(x, y, z, color) {
    this.burst(x, y + 0.8, z, 22, [color, 0xffffff], 1.6, 0.4, 1.3, { gravity: 2.2, drag: 1.5 });
    this.burst(x, y + 0.4, z, 10, [0x8a8070, 0x6a6458], 1.2, 0.8, 1.2, { smoke: true, grow: 1.2, alpha: 0.5 });
  }
}
