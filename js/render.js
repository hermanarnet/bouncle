// Canvas renderer: soft-3D "toy diorama" look (glossy tubes, domes, glass cup, soft shadows).
import { R, spinnerEnds } from './physics.js';
import { THEMES, rgba, lighten, darken, mix } from './themes.js';

const TAU = Math.PI * 2;
const LX = -0.561, LY = -0.828;            // direction towards the key light (world xy)
const SHX = 0.636, SHY = 0.939;            // shadow offset per unit of height
const ZP = 16;                             // height of the play plane above the back wall
const IMG = {};

export function loadImages(list) {
  return Promise.all(list.map(([k, src]) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[k] = im; res(); };
    im.onerror = () => res();
    im.src = src;
  })));
}

function capsulePath(g, x1, y1, x2, y2, w) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.beginPath();
  g.arc(x1, y1, w, a + Math.PI / 2, a + Math.PI * 1.5);
  g.arc(x2, y2, w, a - Math.PI / 2, a + Math.PI / 2);
  g.closePath();
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// draw only the (blurred, offset) shadow of a filled path; scale = device px per world unit
function shadowOf(g, scale, pathFn, offX, offY, blur, color) {
  g.save();
  const BIG = 20000;
  g.translate(-BIG / scale, 0);
  g.shadowColor = color;
  g.shadowBlur = blur * scale;
  g.shadowOffsetX = BIG + offX * scale;
  g.shadowOffsetY = offY * scale;
  g.fillStyle = '#000';
  pathFn();
  g.fill();
  g.restore();
}

function tube(g, x1, y1, x2, y2, w, col, opts = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  if (nx * LX + ny * LY < 0) { nx = -nx; ny = -ny; }   // n points to the lit side
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const gr = g.createLinearGradient(mx + nx * w, my + ny * w, mx - nx * w, my - ny * w);
  const dark = opts.dark;
  gr.addColorStop(0, dark ? lighten(col, 0.25) : lighten(col, 0.5));
  gr.addColorStop(0.22, dark ? lighten(col, 0.12) : lighten(col, 0.18));
  gr.addColorStop(0.55, col);
  gr.addColorStop(0.86, darken(col, dark ? 0.35 : 0.22));
  gr.addColorStop(1, darken(col, dark ? 0.55 : 0.42));
  capsulePath(g, x1, y1, x2, y2, w);
  g.fillStyle = gr;
  g.fill();
  // glossy highlight line on the lit side
  g.save();
  g.lineCap = 'round';
  const ox = nx * w * 0.42, oy = ny * w * 0.42;
  const ux = dx / len, uy = dy / len;
  const inset = w * 0.5;
  g.strokeStyle = 'rgba(255,255,255,0.32)';
  g.lineWidth = w * 0.75;
  g.beginPath(); g.moveTo(x1 + ox + ux * inset, y1 + oy + uy * inset); g.lineTo(x2 + ox - ux * inset, y2 + oy - uy * inset); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = w * 0.24;
  g.beginPath(); g.moveTo(x1 + ox * 1.15 + ux * inset, y1 + oy * 1.15 + uy * inset); g.lineTo(x2 + ox * 1.15 - ux * inset, y2 + oy * 1.15 - uy * inset); g.stroke();
  if (opts.glow) {
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = rgba(opts.glow, 0.55);
    g.lineWidth = w * 0.5;
    g.shadowColor = opts.glow;
    g.shadowBlur = 10 * (opts.scale || 2);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  g.restore();
}

function dome(g, x, y, r, col, hiK = 0.62) {
  const gr = g.createRadialGradient(x - r * 0.36, y - r * 0.42, r * 0.04, x, y, r);
  gr.addColorStop(0, lighten(col, hiK));
  gr.addColorStop(0.3, lighten(col, 0.18));
  gr.addColorStop(0.75, col);
  gr.addColorStop(1, darken(col, 0.38));
  g.beginPath(); g.arc(x, y, r, 0, TAU);
  g.fillStyle = gr; g.fill();
  const sp = g.createRadialGradient(x - r * 0.38, y - r * 0.45, 0, x - r * 0.38, y - r * 0.45, r * 0.42);
  sp.addColorStop(0, 'rgba(255,255,255,0.95)');
  sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp; g.fill();
}

function softShadow(g, x, y, r, color, k = 1) {
  const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r * 1.35);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = k;
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r * 1.35, 0, TAU); g.fill();
  g.globalAlpha = 1;
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ball = document.createElement('canvas');
    this.static = null;
    this.C = null;
    this.theme = THEMES.toybox;
    this.resize();
  }

  resize() {
    const cssW = this.cv.clientWidth || window.innerWidth;
    const cssH = this.cv.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cv.width = Math.round(cssW * this.dpr);
    this.cv.height = Math.round(cssH * this.dpr);
    this.cssW = cssW; this.cssH = cssH;
    let s = cssW / 540;
    if (960 * s > cssH) s = cssH / 960;
    this.s = s;
    this.ox = (cssW - 540 * s) / 2;
    this.oy = 0;
    if (960 * s < cssH && cssW / cssH > 0.5) this.oy = Math.max(0, (cssH - 960 * s) * 0.35);
    this.static = null;
  }

  // world -> css px (for DOM overlays)
  toCss(x, y, cam) {
    const z = cam ? cam.z : 1, fx = cam ? cam.fx : 0, fy = cam ? cam.fy : 0, shx = cam ? cam.shx : 0, shy = cam ? cam.shy : 0;
    return [this.ox + this.s * ((x - fx) * z + fx + shx), this.oy + this.s * ((y - fy) * z + fy + shy)];
  }
  toWorld(cx, cy) { return [(cx - this.ox) / this.s, (cy - this.oy) / this.s]; }

  setLevel(C, themeKey) {
    this.C = C;
    this.theme = THEMES[themeKey] || THEMES.toybox;
    this.static = null;
  }

  // ------------------------------------------------------------- static layer
  buildStatic() {
    const S = this.s * this.dpr;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(540 * S); cv.height = Math.ceil(960 * S);
    const g = cv.getContext('2d');
    g.setTransform(S, 0, 0, S, 0, 0);
    const T = this.theme, C = this.C;
    // tray
    let gr = g.createLinearGradient(0, 0, 0, 960);
    gr.addColorStop(0, T.trayHi); gr.addColorStop(1, T.trayLo);
    g.fillStyle = gr; g.fillRect(0, 0, 540, 960);
    // board
    const bx = 22, by = 148, bw = 496, bh = 900;
    roundRectPath(g, bx, by, bw, bh, 18);
    gr = g.createLinearGradient(0, by, 0, 800);
    gr.addColorStop(0, T.wallTop); gr.addColorStop(1, T.wallBot);
    g.fillStyle = gr; g.fill();
    g.save();
    roundRectPath(g, bx, by, bw, bh, 18); g.clip();
    // soft key light falloff on the board
    const lg = g.createRadialGradient(170, 260, 20, 170, 260, 620);
    lg.addColorStop(0, T.dark ? 'rgba(120,110,255,0.10)' : 'rgba(255,255,255,0.22)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(bx, by, bw, bh);
    // pit
    gr = g.createLinearGradient(0, 770, 0, 905);
    gr.addColorStop(0, rgba(T.pit, 0)); gr.addColorStop(1, rgba(T.pit, 0.96));
    g.fillStyle = gr; g.fillRect(bx, 770, bw, 300);
    // pegboard dimples
    if (T.dimple) {
      for (let y = 12; y < 790; y += 24) {
        if (y < by + 8) continue;
        for (let x = 6; x < 540; x += 24) {
          if (x < bx + 8 || x > bx + bw - 8) continue;
          g.fillStyle = 'rgba(40,20,110,0.16)';
          g.beginPath(); g.arc(x - 0.35, y - 0.35, 2.3, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.28)';
          g.beginPath(); g.arc(x + 0.55, y + 0.65, 1.7, 0, TAU); g.fill();
          g.fillStyle = 'rgba(70,50,150,0.10)';
          g.beginPath(); g.arc(x, y, 1.5, 0, TAU); g.fill();
        }
      }
    }
    // inner shadow from the tray rim (light from top-left)
    shadowOf(g, S, () => {
      g.beginPath();
      g.rect(-200, -200, 940, 1400);
      roundRectPath(g, bx, by, bw, bh, 18);
    }, 5, 8, 12, T.dark ? 'rgba(0,0,0,0.7)' : 'rgba(30,10,90,0.42)');
    g.restore();
    // tray bevel highlights
    g.save();
    roundRectPath(g, bx - 1.5, by - 1.5, bw + 3, bh + 3, 19.5);
    g.strokeStyle = T.dark ? 'rgba(160,140,255,0.25)' : 'rgba(255,255,255,0.35)';
    g.lineWidth = 2; g.stroke();
    g.restore();
    // cup back panel tint
    const cup = C.cup;
    g.save();
    roundRectPath(g, cup.x0 + 4, cup.rim - 8, cup.x1 - cup.x0 - 8, cup.bot - cup.rim + 10, 6);
    g.fillStyle = rgba(T.cup, T.dark ? 0.18 : 0.32); g.fill();
    g.restore();
    // static shadows
    const shCol = T.shadow;
    for (const s of C.segs) {
      if (s.kind === 'wall') continue;
      const h = ZP + s.w;
      shadowOf(g, S, () => capsulePath(g, s.x1, s.y1, s.x2, s.y2, s.w), SHX * h * 0.62, SHY * h * 0.62, 3.2, shCol);
    }
    // tubes
    for (const s of C.segs) {
      if (s.kind === 'wall') continue;
      let col = T.rail;
      if (s.kind === 'pad') col = T.pad;
      if (s.kind === 'cup' || s.kind === 'cupwall') col = T.cup;
      tube(g, s.x1, s.y1, s.x2, s.y2, s.w, col, { dark: T.dark, glow: T.dark && s.kind === 'rail' ? T.glow : (T.dark && s.kind !== 'rail' ? col : null), scale: S });
    }
    // launch spot ring
    const [sx, sy] = C.start;
    g.save();
    g.strokeStyle = T.dark ? rgba(T.pad, 0.5) : 'rgba(255,255,255,0.55)';
    g.setLineDash([3, 4]);
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(sx, sy, R + 6, 0, TAU); g.stroke();
    g.restore();
    this.static = cv;
  }

  // ------------------------------------------------------------- frame
  begin(cam) {
    const g = this.ctx, T = this.theme;
    if (!this.static) this.buildStatic();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // backdrop outside the world
    g.fillStyle = T.trayLo;
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    const bottom = (this.oy + 960 * this.s) * this.dpr;
    if (bottom < this.cv.height) {
      g.fillStyle = T.pit;
      g.fillRect(0, bottom - 2, this.cv.width, this.cv.height - bottom + 2);
    }
    const z = cam.z, a = this.dpr * this.s * z;
    const e = this.dpr * (this.ox + this.s * (cam.fx - z * cam.fx + cam.shx * z));
    const f = this.dpr * (this.oy + this.s * (cam.fy - z * cam.fy + cam.shy * z));
    this.scale = a;
    g.setTransform(a, 0, 0, a, e, f);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.static, 0, 0, 540, 960);
    // extend pit below world
    g.fillStyle = T.pit;
    g.fillRect(22, 958, 496, 600);
  }

  bumpers(pulses = [], scales = null) {
    const g = this.ctx, T = this.theme;
    this.C.pegs.forEach((p, i) => {
      const k = scales ? scales[i] : 1;
      if (k <= 0.01) return;
      const pulse = pulses[i] || 0;
      const r = p.r * k * (1 + 0.22 * pulse);
      softShadow(g, p.x + SHX * (ZP + 2) * 0.62, p.y + SHY * (ZP + 2) * 0.62, r * 1.05, T.shadow);
      dome(g, p.x, p.y, r * 1.12, T.bumperBase, 0.5);
      dome(g, p.x, p.y, r * 0.84, mix(T.bumper, '#ffffff', pulse * 0.35));
      const core = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.8);
      core.addColorStop(0, rgba(T.bumper, 0.25 + 0.6 * pulse));
      core.addColorStop(1, rgba(T.bumper, 0));
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = core; g.beginPath(); g.arc(p.x, p.y, r * 1.8, 0, TAU); g.fill();
      g.restore();
    });
  }

  spinners(tick, flash = [], scales = null) {
    const g = this.ctx, T = this.theme;
    this.C.spinners.forEach((s, i) => {
      const k = scales ? scales[i] : 1;
      if (k <= 0.01) return;
      let [x1, y1, x2, y2] = spinnerEnds(s, tick);
      x1 = s.x + (x1 - s.x) * k; y1 = s.y + (y1 - s.y) * k; x2 = s.x + (x2 - s.x) * k; y2 = s.y + (y2 - s.y) * k;
      const h = ZP + 6;
      shadowOf(g, this.scale, () => capsulePath(g, x1, y1, x2, y2, s.w * k), SHX * h * 0.62, SHY * h * 0.62, 3, T.shadow);
      tube(g, x1, y1, x2, y2, s.w * k, mix(T.spinner, '#ffffff', (flash[i] || 0) * 0.4), { dark: T.dark, glow: T.dark ? T.spinner : null, scale: this.scale });
      dome(g, s.x, s.y, 9.5 * k, T.hub, 0.8);
    });
  }

  portals(time, flash = 0, scales = null) {
    const g = this.ctx, T = this.theme;
    this.C.portals.forEach((P, i) => {
      for (const which of ['a', 'b']) {
        const k = scales ? scales[i] : 1;
        if (k <= 0.01) continue;
        const [x, y] = P[which];
        const r = P.r * k;
        const col = which === 'a' ? T.pa : T.pb;
        softShadow(g, x + 8, y + 12, r * 1.05, T.shadow, 0.8);
        // hole
        const hole = g.createRadialGradient(x, y, 0, x, y, r);
        hole.addColorStop(0, '#05020f');
        hole.addColorStop(0.7, darken(col, 0.75));
        hole.addColorStop(1, darken(col, 0.4));
        g.fillStyle = hole; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        // swirl
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.lineCap = 'round';
        const dir = which === 'a' ? 1 : -1;
        for (let j = 0; j < 4; j++) {
          const a0 = time * 4.2 * dir + j * TAU / 4;
          for (let q = 0; q < 3; q++) {
            const rr = r * (0.28 + q * 0.2);
            g.strokeStyle = rgba(col, 0.55 - q * 0.12 + flash * 0.3);
            g.lineWidth = r * 0.12;
            g.beginPath(); g.arc(x, y, rr, a0 + q * 0.5 * dir, a0 + q * 0.5 * dir + 1.1 * dir, dir < 0); g.stroke();
          }
        }
        const glow = g.createRadialGradient(x, y, r * 0.5, x, y, r * 2.2);
        glow.addColorStop(0, rgba(col, 0.32 + 0.5 * flash));
        glow.addColorStop(1, rgba(col, 0));
        g.fillStyle = glow; g.beginPath(); g.arc(x, y, r * 2.2, 0, TAU); g.fill();
        g.restore();
        // ring (torus)
        const ring = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.2, x, y, r * 1.25);
        ring.addColorStop(0, lighten(col, 0.6)); ring.addColorStop(0.55, col); ring.addColorStop(1, darken(col, 0.35));
        g.strokeStyle = ring; g.lineWidth = 8.4 * k;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2 * k;
        g.beginPath(); g.arc(x, y, r + 1.2, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
      }
    });
  }

  // ------------------------------------------------------------- balls
  drawBall(x, y, phi, o = {}) {
    const g = this.ctx, T = this.theme;
    const scale = this.scale;
    const r = (o.r || R) * (o.k ?? 1);
    if (r < 0.3) return;
    const alpha = o.alpha ?? 1;
    if (!o.noShadow) softShadow(g, x + SHX * (ZP + 4) * 0.62, y + SHY * (ZP + 4) * 0.62, r, T.shadow, 0.9 * alpha);
    const D = Math.ceil(r * 2 * 1.15 * scale) + 4;
    const bc = this.ball;
    if (bc.width !== D) { bc.width = D; bc.height = D; }
    const c = bc.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, D, D);
    const rp = r * scale;
    c.translate(D / 2, D / 2);
    this.paintSphere(c, rp, phi, o.skin || 'classic', o.tint);
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    if (o.squash) {
      const { ax, ay, s } = o.squash;
      const ang = Math.atan2(ay, ax);
      g.rotate(ang); g.scale(s, 1 / Math.sqrt(s)); g.rotate(-ang);
    }
    g.drawImage(bc, -D / 2 / scale, -D / 2 / scale, D / scale, D / scale);
    g.restore();
    if (o.tint) {
      g.save(); g.globalCompositeOperation = 'lighter';
      const gl = g.createRadialGradient(x, y, r * 0.6, x, y, r * 2.4);
      gl.addColorStop(0, rgba(o.tint, 0.35 * alpha)); gl.addColorStop(1, rgba(o.tint, 0));
      g.fillStyle = gl; g.beginPath(); g.arc(x, y, r * 2.4, 0, TAU); g.fill();
      g.restore();
    }
  }

  paintSphere(c, rp, phi, skin, tint) {
    c.save();
    c.beginPath(); c.arc(0, 0, rp, 0, TAU); c.clip();
    const metal = skin === 'chrome' || skin === 'gold';
    if (tint) {
      c.fillStyle = tint; c.fillRect(-rp, -rp, rp * 2, rp * 2);
    } else if (metal && IMG[skin]) {
      c.drawImage(IMG[skin], -rp, -rp, rp * 2, rp * 2);
      c.restore();
      return;
    } else if ((skin === 'lava' || skin === 'galaxy') && IMG[skin]) {
      c.save(); c.rotate(phi); c.drawImage(IMG[skin], -rp, -rp, rp * 2, rp * 2); c.restore();
    } else if (skin === 'candy') {
      c.fillStyle = '#ff6aa6'; c.fillRect(-rp, -rp, rp * 2, rp * 2);
      c.save(); c.rotate(phi);
      c.fillStyle = '#ffffff';
      for (let k = -3; k <= 3; k++) {
        c.beginPath();
        const o = k * rp * 0.62;
        c.moveTo(o - rp * 1.6, -rp * 1.6); c.lineTo(o - rp * 1.6 + rp * 0.26, -rp * 1.6); c.lineTo(o + rp * 1.6 + rp * 0.26, rp * 1.6); c.lineTo(o + rp * 1.6, rp * 1.6);
        c.fill();
      }
      c.restore();
    } else {
      c.fillStyle = '#ffcd2a'; c.fillRect(-rp, -rp, rp * 2, rp * 2);
      c.save(); c.rotate(phi);
      c.fillStyle = '#ffffff'; c.fillRect(-rp, -rp * 0.25, rp * 2, rp * 0.5);
      c.restore();
    }
    // diffuse shading
    c.globalCompositeOperation = 'multiply';
    const sh = c.createRadialGradient(-rp * 0.35, -rp * 0.42, rp * 0.05, 0, 0, rp * 1.05);
    sh.addColorStop(0, '#ffffff'); sh.addColorStop(0.45, '#f1eef9'); sh.addColorStop(0.82, '#b4aad8'); sh.addColorStop(1, '#6d5ea6');
    c.fillStyle = sh; c.fillRect(-rp, -rp, rp * 2, rp * 2);
    // speculars
    c.globalCompositeOperation = 'screen';
    const sp = c.createRadialGradient(-rp * 0.38, -rp * 0.46, 0, -rp * 0.38, -rp * 0.46, rp * 0.45);
    sp.addColorStop(0, 'rgba(255,255,255,0.98)'); sp.addColorStop(0.4, 'rgba(255,255,255,0.35)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sp; c.fillRect(-rp, -rp, rp * 2, rp * 2);
    const rim = c.createRadialGradient(rp * 0.55, rp * 0.62, 0, rp * 0.55, rp * 0.62, rp * 0.7);
    rim.addColorStop(0, 'rgba(190,170,255,0.45)'); rim.addColorStop(1, 'rgba(190,170,255,0)');
    c.fillStyle = rim; c.fillRect(-rp, -rp, rp * 2, rp * 2);
    if (skin === 'lava' && !tint) {
      c.globalCompositeOperation = 'lighter';
      c.save(); c.rotate(phi); c.globalAlpha = 0.5;
      if (IMG.lava) c.drawImage(IMG.lava, -rp, -rp, rp * 2, rp * 2);
      c.restore();
    }
    c.restore();
  }

  trail(pts, color, width = 4, alpha = 1) {
    if (pts.length < 2) return;
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = this.theme.dark ? 'lighter' : 'source-over';
    g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const k = i / (pts.length - 1);
      g.strokeStyle = color + (alpha * k * k * 0.75).toFixed(3) + ')';
      g.lineWidth = width * (0.25 + 0.75 * k);
      g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }
    g.restore();
  }

  cupGlass(glow = 0) {
    const g = this.ctx, T = this.theme, c = this.C.cup;
    const x0 = c.x0 + 6, x1 = c.x1 - 6, y0 = c.rim - 2, y1 = c.bot - 6;
    g.save();
    g.fillStyle = rgba(T.cup, 0.12 + glow * 0.3);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.42)'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(x0 + (x1 - x0) * 0.22, y1 + 6); g.lineTo(x0 + (x1 - x0) * 0.45, y0 - 6); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(x0 + (x1 - x0) * 0.4, y1 + 6); g.lineTo(x0 + (x1 - x0) * 0.63, y0 - 6); g.stroke();
    g.restore();
    if (glow > 0.02) {
      g.save(); g.globalCompositeOperation = 'lighter';
      const cx = (c.x0 + c.x1) / 2, cy = (c.rim + c.bot) / 2;
      const gl = g.createRadialGradient(cx, cy, 5, cx, cy, 90);
      gl.addColorStop(0, rgba(T.cup, 0.6 * glow)); gl.addColorStop(1, rgba(T.cup, 0));
      g.fillStyle = gl; g.beginPath(); g.arc(cx, cy, 90, 0, TAU); g.fill();
      g.restore();
    }
  }

  aim(a) {
    // a = { bx, by, vx, vy, k(0..1 power), fx, fy (finger), show }
    const g = this.ctx;
    g.save();
    // dotted ballistic preview (short, no collisions)
    for (let i = 1; i <= 12; i++) {
      const t = i * 0.028;
      const x = a.bx + a.vx * t, y = a.by + a.vy * t + 0.5 * 1150 * t * t;
      const f = 1 - i / 13;
      g.fillStyle = `rgba(255,255,255,${(0.3 + 0.7 * f).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, 1.6 + 2.6 * f, 0, TAU); g.fill();
    }
    // band
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(a.bx, a.by); g.lineTo(a.hx, a.hy); g.stroke();
    // power ring
    g.strokeStyle = '#ffce2c'; g.lineWidth = 3.4;
    g.beginPath(); g.arc(a.bx, a.by, 22, -Math.PI / 2, -Math.PI / 2 + TAU * a.k); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(a.bx, a.by, 22, 0, TAU); g.stroke();
    g.restore();
  }

  touchRing(x, y, pressed, alpha = 1) {
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 2.6;
    g.beginPath(); g.arc(x, y, pressed ? 16 : 20, 0, TAU); g.fill(); g.stroke();
    g.restore();
  }
}
