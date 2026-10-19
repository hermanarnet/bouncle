// Particles: impact sparks, shock rings, confetti.
const TAU = Math.PI * 2;
const CONF = ['#ffce2c', '#ff5c86', '#46ecbe', '#8a74ff', '#ff9a3c', '#ffffff', '#22d4ff'];

export class FX {
  constructor() { this.p = []; }
  clear() { this.p.length = 0; }

  sparks(x, y, color, n = 8, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * (0.4 + 0.6 * Math.random());
      this.p.push({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.42, age: 0, color });
    }
  }
  ring(x, y, color, r1 = 34, life = 0.36) { this.p.push({ t: 'ring', x, y, r1, life, age: 0, color }); }
  confetti(x, y, n = 110) {
    for (let i = 0; i < n; i++) {
      const a = (-90 + (Math.random() * 124 - 62)) * Math.PI / 180;
      const v = 380 + Math.random() * 460;
      this.p.push({
        t: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 2.4 + Math.random() * 0.4, age: -Math.random() * 0.12,
        rot: Math.random() * TAU, vr: (Math.random() * 2 - 1) * 12, flip: Math.random() * TAU, vf: 6 + Math.random() * 8,
        size: 3 + Math.random() * 2.6, color: CONF[i % CONF.length], wob: Math.random() * TAU,
      });
    }
  }

  update(dt) {
    for (const q of this.p) {
      q.age += dt;
      if (q.age < 0) continue;
      if (q.t === 'spark') {
        const d = Math.exp(-5 * dt);
        q.vx *= d; q.vy = q.vy * d + 260 * dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
      } else if (q.t === 'conf') {
        const d = Math.exp(-1.8 * dt);
        q.vx *= d; q.vy = q.vy * d + 230 * dt;
        q.x += q.vx * dt + Math.sin(q.age * 4 + q.wob) * 14 * dt;
        q.y += q.vy * dt;
        q.rot += q.vr * dt; q.flip += q.vf * dt;
      }
    }
    this.p = this.p.filter(q => q.age < q.life);
  }

  draw(g, dark) {
    if (!this.p.length) return;
    g.save();
    for (const q of this.p) {
      if (q.age < 0) continue;
      const k = q.age / q.life;
      if (q.t === 'spark') {
        g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
        g.strokeStyle = q.color; g.globalAlpha = 1 - k; g.lineWidth = 2.2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(q.x - q.vx * 0.025, q.y - q.vy * 0.025); g.lineTo(q.x, q.y); g.stroke();
      } else if (q.t === 'ring') {
        g.globalCompositeOperation = 'source-over';
        const r = 6 + (q.r1 - 6) * (1 - (1 - k) ** 3);
        g.strokeStyle = q.color; g.globalAlpha = (1 - k) * 0.9; g.lineWidth = 3.4 - 2.4 * k;
        g.beginPath(); g.arc(q.x, q.y, r, 0, TAU); g.stroke();
      } else {
        g.globalCompositeOperation = 'source-over';
        const fade = Math.min(1, (q.life - q.age) / 0.5);
        const f = Math.cos(q.flip);
        g.globalAlpha = fade;
        g.fillStyle = Math.abs(f) > 0.92 ? '#ffffff' : q.color;
        g.save(); g.translate(q.x, q.y); g.rotate(q.rot);
        g.fillRect(-q.size, -q.size * 0.5 * Math.abs(f) - 0.4, q.size * 2, q.size * Math.abs(f) + 0.8);
        g.restore();
      }
    }
    g.restore();
  }
}
