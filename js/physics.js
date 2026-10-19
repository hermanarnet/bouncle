// Bouncle — deterministic 2D physics.
// Only + - * / Math.sqrt Math.floor Math.abs are used inside the simulation, so the same
// shot gives bit-identical results in Safari, Chrome, Node and the iOS app (all IEEE-754 doubles).
// Shared by the game, the level editor and the Node level tools.

export const R = 11;            // ball radius (world units; world is 540 x 960)
export const G = 1150;          // gravity (units / s^2)
export const HZ = 600;          // physics ticks per second
export const DT = 1 / HZ;
export const VQ = 2;            // velocity quantum: shot velocity = (qx, qy) * VQ
export const MIN_SPEED = 300;
export const MAX_SPEED = 1300;
export const SAMPLE = 2;        // record the path every 2 ticks
export const MAX_TICKS = 9 * HZ;

export const WORLD = { w: 540, h: 960, top: 140, floor: 800 };
export const FRAME = [
  [14, 140, 14, 800, 8, 'wall', 0.55],
  [526, 140, 526, 800, 8, 'wall', 0.55],
  [14, 140, 526, 140, 8, 'wall', 0.55],
];

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// deterministic sine / cosine (polynomial, no Math.sin)
export function dsin(x) {
  x = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 +
    x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 * (1 / 355687428096000)))))))));
}
export function dcos(x) { return dsin(x + HALF_PI); }

// ---------------------------------------------------------------- level compile
export function compileLevel(L) {
  const segs = [];
  const add = (x1, y1, x2, y2, w, kind, e) => {
    const dx = x2 - x1, dy = y2 - y1;
    segs.push({ x1, y1, x2, y2, w, kind, e, dx, dy, L2: dx * dx + dy * dy });
  };
  for (const f of FRAME) add(...f);
  add(L.pad[0], L.pad[1], L.pad[2], L.pad[3], 6, 'pad', 0.35);
  for (const r of L.rails) add(r[0], r[1], r[2], r[3], r[4] ?? 7, 'rail', r[5] ?? 0.5);
  const c = L.cup;
  const x0 = c.x - c.w / 2, x1 = c.x + c.w / 2;
  add(x0, c.rim, x0, c.bot, 6, 'cupwall', 0.3);
  add(x0, c.bot, x1, c.bot, 6, 'cup', 0.2);
  add(x1, c.rim, x1, c.bot, 6, 'cupwall', 0.3);
  const pegs = (L.pegs || []).map(p => ({ x: p[0], y: p[1], r: p[2], e: p[3] ?? 0.85, kick: p[4] ?? 160 }));
  const spinners = (L.spinners || []).map(s => ({
    x: s.x, y: s.y, L: s.L ?? 48, w: s.w ?? 7, omega: s.omega ?? 2.4, theta0: s.theta0 ?? 0, e: s.e ?? 0.6,
  }));
  const portals = (L.portals || []).map(p => ({ a: p.a, b: p.b, r: p.r ?? 19 }));
  return {
    src: L, segs, pegs, spinners, portals,
    start: L.start,
    cupBox: [x0 + 6 + R * 0.3, x1 - 6 - R * 0.3, c.rim, c.bot],
    cup: { x0, x1, rim: c.rim, bot: c.bot, x: c.x },
  };
}

export function spinnerEnds(s, tick) {
  const th = s.theta0 + s.omega * tick * DT;
  const c = dcos(th), sn = dsin(th);
  return [s.x - c * s.L, s.y - sn * s.L, s.x + c * s.L, s.y + sn * s.L, th];
}

// ---------------------------------------------------------------- simulation
// shot = { qx, qy, t0 }   (t0 = level tick at release; drives spinner phase)
// returns { outcome: 'hit'|'fall'|'stuck'|'timeout', ticks, outTick, path: Float64Array [x,y,vx,vy]*, events }
export function simulate(C, shot, opts = {}) {
  const extra = opts.extraTicks ?? 0;
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const record = opts.record !== false;
  let x = C.start[0], y = C.start[1];
  let vx = shot.qx * VQ, vy = shot.qy * VQ;
  const t0 = shot.t0 | 0;
  const path = record ? [x, y, vx, vy] : null;
  const events = [];
  const last = new Map();
  let inCup = 0, still = 0, outcome = null, outTick = 0, portalCd = -1;
  let rim = false, usedPortal = false, spinHit = false;
  const [cx0, cx1, rimY, botY] = C.cupBox;
  const segs = C.segs, pegs = C.pegs, spins = C.spinners, ports = C.portals;
  let i = 0;
  const hard = maxTicks + extra;
  for (i = 1; i <= hard; i++) {
    vy += G * DT;
    x += vx * DT;
    y += vy * DT;
    // static capsules
    for (let s = 0; s < segs.length; s++) {
      const S = segs[s];
      let t = S.L2 === 0 ? 0 : ((x - S.x1) * S.dx + (y - S.y1) * S.dy) / S.L2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = S.x1 + t * S.dx, cy = S.y1 + t * S.dy;
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const rr = R + S.w;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, ny = dy / d;
        x += nx * (rr - d); y += ny * (rr - d);
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          const ee = vn < -40 ? S.e : 0;
          vx -= (1 + ee) * vn * nx; vy -= (1 + ee) * vn * ny;
          const tx = -ny, ty = nx;
          const vt = (vx * tx + vy * ty) * (S.kind === 'cup' || S.kind === 'cupwall' ? 0.995 : 0.9993);
          const vnn = vx * nx + vy * ny;
          vx = vt * tx + vnn * nx; vy = vt * ty + vnn * ny;
          if (vn < -70 && i - (last.get(s) ?? -1e9) > 36) {
            let kind = S.kind;
            if (kind === 'cupwall') { kind = cy < rimY + 10 ? 'rim' : 'cup'; if (kind === 'rim') rim = true; }
            events.push({ tick: i, kind, v: -vn, x: cx, y: cy, nx, ny, seg: s });
            last.set(s, i);
          }
        }
      }
    }
    // bumpers
    for (let p = 0; p < pegs.length; p++) {
      const P = pegs[p];
      const dx = x - P.x, dy = y - P.y;
      const d2 = dx * dx + dy * dy;
      const rr = R + P.r;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, ny = dy / d;
        x += nx * (rr - d); y += ny * (rr - d);
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          vx -= (1 + P.e) * vn * nx; vy -= (1 + P.e) * vn * ny;
          vx += nx * P.kick; vy += ny * P.kick;
          if (i - (last.get('p' + p) ?? -1e9) > 36) {
            events.push({ tick: i, kind: 'bumper', v: -vn, x: P.x, y: P.y, nx, ny, idx: p });
            last.set('p' + p, i);
          }
        }
      }
    }
    // spinners (rotating capsules)
    for (let k = 0; k < spins.length; k++) {
      const S = spins[k];
      const [x1, y1, x2, y2] = spinnerEnds(S, t0 + i);
      const sdx = x2 - x1, sdy = y2 - y1;
      const L2 = sdx * sdx + sdy * sdy;
      let t = ((x - x1) * sdx + (y - y1) * sdy) / L2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = x1 + t * sdx, cy = y1 + t * sdy;
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const rr = R + S.w;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, ny = dy / d;
        x += nx * (rr - d); y += ny * (rr - d);
        const rx = cx - S.x, ry = cy - S.y;
        const svx = -S.omega * ry, svy = S.omega * rx;
        const rvx = vx - svx, rvy = vy - svy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          vx -= (1 + S.e) * vn * nx; vy -= (1 + S.e) * vn * ny;
          if (vn < -60 && i - (last.get('s' + k) ?? -1e9) > 48) {
            events.push({ tick: i, kind: 'spinner', v: -vn, x: cx, y: cy, nx, ny, idx: k });
            last.set('s' + k, i);
            spinHit = true;
          }
        }
      }
    }
    // portals: a -> b (one way)
    if (i > portalCd) {
      for (let k = 0; k < ports.length; k++) {
        const P = ports[k];
        const dx = x - P.a[0], dy = y - P.a[1];
        const rr = P.r - 4;
        if (dx * dx + dy * dy < rr * rr) {
          events.push({ tick: i, kind: 'portal_in', v: 0, x: P.a[0], y: P.a[1], idx: k });
          x = P.b[0] + dx * 0.2; y = P.b[1] + dy * 0.2;
          events.push({ tick: i, kind: 'portal_out', v: 0, x: P.b[0], y: P.b[1], idx: k });
          portalCd = i + 210;
          usedPortal = true;
          break;
        }
      }
    }
    if (record && i % SAMPLE === 0) path.push(x, y, vx, vy);
    const sp2 = vx * vx + vy * vy;
    if (outcome === 'hit') {
      if (i >= outTick + extra) break;
      continue;
    }
    if (x > cx0 - 4 && x < cx1 + 4 && y > rimY && y < botY) {
      inCup++;
      if (inCup > 210 && sp2 < 14400) {
        outcome = 'hit'; outTick = i;
        if (extra <= 0) break;
        continue;
      }
    } else inCup = 0;
    if (y > 990) { outcome = 'fall'; outTick = i; break; }
    if (sp2 < 64) {
      still++;
      if (still > 300) { outcome = 'stuck'; outTick = i; break; }
    } else still = 0;
    if (i >= maxTicks) { outcome = 'timeout'; outTick = i; break; }
  }
  return {
    outcome: outcome || 'timeout', ticks: Math.min(i, hard), outTick: outTick || i,
    path: record ? Float64Array.from(path) : null, events, rim, usedPortal, spinHit,
  };
}

// helper: tick at which the ball first drops inside the cup (for slow-mo), or -1
export function cupEntryTick(C, res) {
  if (res.outcome !== 'hit' || !res.path) return -1;
  const p = res.path;
  let ent = -1;
  for (let k = 4; k < p.length; k += 4) {
    const y0 = p[k - 3], y1 = p[k + 1], x1 = p[k];
    if (y0 < C.cup.rim && y1 >= C.cup.rim && x1 > C.cup.x0 && x1 < C.cup.x1) ent = (k / 4) * SAMPLE;
  }
  return ent;
}

// sample the recorded path at a fractional tick
export function sampleAt(res, tick) {
  const p = res.path;
  const n = p.length / 4;
  let f = tick / SAMPLE;
  if (f <= 0) return [p[0], p[1], p[2], p[3]];
  if (f >= n - 1) { const k = (n - 1) * 4; return [p[k], p[k + 1], p[k + 2], p[k + 3]]; }
  const i = Math.floor(f), u = f - i;
  const a = i * 4, b = a + 4;
  if (Math.abs(p[b] - p[a]) + Math.abs(p[b + 1] - p[a + 1]) > 40) return u < 0.5 ? [p[a], p[a + 1], p[a + 2], p[a + 3]] : [p[b], p[b + 1], p[b + 2], p[b + 3]];
  return [p[a] + (p[b] - p[a]) * u, p[a + 1] + (p[b + 1] - p[a + 1]) * u, p[a + 2] + (p[b + 2] - p[a + 2]) * u, p[a + 3] + (p[b + 3] - p[a + 3]) * u];
}

// turn a launch direction + speed into a quantised shot
export function quantize(vx, vy) {
  let sp = Math.sqrt(vx * vx + vy * vy) || 1;
  const s = Math.max(MIN_SPEED, Math.min(MAX_SPEED, sp)) / sp;
  return { qx: Math.round((vx * s) / VQ), qy: Math.round((vy * s) / VQ) };
}
