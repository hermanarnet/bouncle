// Bouncle level editor — runs in the browser next to the game (open /editor/).
import * as P from '../js/physics.js';
import { Renderer } from '../js/render.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const PACK_NAMES = { daily: 'Daily', oneshot: 'One Shot', trick: 'Trick Shot', adventure: 'Adventure' };
let PACK = new URLSearchParams(location.search).get('pack') || 'daily';
if (!PACK_NAMES[PACK]) PACK = 'daily';
let LEVELS = await loadPack(PACK);
let L = clone(LEVELS[0]);
async function loadPack(k) { return (await (await fetch(`../levels/${k}.json`, { cache: 'no-cache' })).json()).levels; }
let C = null;
let sel = null;          // {type, i, part}
let drag = null;
let test = null;         // { res, p }
let tick = 0;
let lastStats = null;

const cv = $('cv');
const r = new Renderer(cv);
const cam = { z: 1, fx: 270, fy: 480, shx: 0, shy: 0 };

// ------------------------------------------------------------- level list
const ds = $('daysel');
const ps = $('packsel');
Object.entries(PACK_NAMES).forEach(([k, n]) => { const o = document.createElement('option'); o.value = k; o.textContent = n; ps.appendChild(o); });
ps.value = PACK;
function levelLabel(l) {
  if (PACK === 'adventure') return `${l.world}-${l.index} · ${l.theme} · par ${l.par}`;
  const t = l.trick ? ` · ${l.trick.type}${l.trick.n ? ' ' + l.trick.n : ''}` : '';
  return `Day ${l.day} · ${l.theme} · par ${l.par}${t}`;
}
function fillDays() {
  ds.innerHTML = '';
  LEVELS.forEach((l) => { const o = document.createElement('option'); o.value = l.day; o.textContent = levelLabel(l); ds.appendChild(o); });
}
fillDays();
$('dl').textContent = `Download ${PACK}.json with this level replaced`;
ds.onchange = () => { L = clone(LEVELS.find(l => l.day === +ds.value)); sel = null; test = null; rebuild(); };
ps.onchange = async () => { PACK = ps.value; LEVELS = await loadPack(PACK); fillDays(); L = clone(LEVELS[0]); sel = null; test = null; rebuild(); $('dl').textContent = `Download ${PACK}.json with this level replaced`; };
$('theme').onchange = () => { L.theme = $('theme').value; rebuild(); };
$('new').onclick = () => {
  L = { v: 1, day: L.day, theme: L.theme, start: [88, 313], pad: [48, 330, 128, 330], rails: [[160, 520, 330, 560, 7, 0.5]], pegs: [], spinners: [], portals: [], cup: { x: 380, w: 74, rim: 690, bot: 756 }, par: 3 };
  sel = null; test = null; rebuild();
};

function rebuild() {
  C = P.compileLevel(L);
  r.setLevel(C, L.theme || 'toybox');
  $('theme').value = L.theme || 'toybox';
  $('json').value = JSON.stringify(stripMeta(L));
  renderProps();
}
function stripMeta(l) { const o = clone(l); return o; }

// ------------------------------------------------------------- handles
function handles() {
  const h = [{ type: 'start', x: L.start[0], y: L.start[1], rad: 16 }];
  L.rails.forEach((q, i) => {
    h.push({ type: 'rail', i, part: 'a', x: q[0], y: q[1], rad: 10 });
    h.push({ type: 'rail', i, part: 'b', x: q[2], y: q[3], rad: 10 });
    h.push({ type: 'rail', i, part: 'm', x: (q[0] + q[2]) / 2, y: (q[1] + q[3]) / 2, rad: 12 });
  });
  L.pegs.forEach((q, i) => h.push({ type: 'peg', i, x: q[0], y: q[1], rad: q[2] + 4 }));
  L.spinners.forEach((q, i) => h.push({ type: 'spin', i, x: q.x, y: q.y, rad: 16 }));
  L.portals.forEach((q, i) => { h.push({ type: 'portal', i, part: 'a', x: q.a[0], y: q.a[1], rad: 22 }); h.push({ type: 'portal', i, part: 'b', x: q.b[0], y: q.b[1], rad: 22 }); });
  h.push({ type: 'cup', x: L.cup.x, y: (L.cup.rim + L.cup.bot) / 2, rad: 34 });
  return h;
}

function toWorld(e) {
  const b = cv.getBoundingClientRect();
  return r.toWorld(e.clientX - b.left, e.clientY - b.top);
}

cv.addEventListener('pointerdown', (e) => {
  const [x, y] = toWorld(e);
  cv.setPointerCapture(e.pointerId);
  if (e.shiftKey) { drag = { kind: 'shot', x0: x, y0: y, x, y }; return; }
  let best = null, bd = 1e9;
  for (const h of handles()) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < h.rad + 6 && d < bd) { bd = d; best = h; }
  }
  sel = best;
  drag = best ? { kind: 'move', h: best, x0: x, y0: y } : null;
  renderProps();
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const [x, y] = toWorld(e);
  if (drag.kind === 'shot') { drag.x = x; drag.y = y; return; }
  const dx = Math.round(x - drag.x0), dy = Math.round(y - drag.y0);
  if (!dx && !dy) return;
  drag.x0 += dx; drag.y0 += dy;
  move(drag.h, dx, dy);
  rebuild();
});
cv.addEventListener('pointerup', () => {
  if (drag && drag.kind === 'shot') {
    const dx = drag.x0 - drag.x, dy = drag.y0 - drag.y;
    const len = Math.hypot(dx, dy);
    if (len > 10) {
      const k = Math.max(0, Math.min(1, (len - 12) / 125));
      const sp = P.MIN_SPEED + (P.MAX_SPEED - P.MIN_SPEED) * k;
      const q = P.quantize(dx / len * sp, dy / len * sp);
      const shot = { ...q, t0: Math.floor(tick) };
      test = { res: P.simulate(C, shot, { extraTicks: 300 }), shot, p: 0 };
      $('stats').textContent = `Test shot: ${test.res.outcome} after ${(test.res.outTick / 600).toFixed(2)}s · shot ${JSON.stringify(shot)}`;
    }
  }
  drag = null;
});
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { del(); e.preventDefault(); }
});

function move(h, dx, dy) {
  if (h.type === 'start') { L.start[0] += dx; L.start[1] += dy; L.pad = L.pad.map((v, i) => v + (i % 2 ? dy : dx)); }
  if (h.type === 'rail') {
    const q = L.rails[h.i];
    if (h.part === 'a' || h.part === 'm') { q[0] += dx; q[1] += dy; }
    if (h.part === 'b' || h.part === 'm') { q[2] += dx; q[3] += dy; }
  }
  if (h.type === 'peg') { L.pegs[h.i][0] += dx; L.pegs[h.i][1] += dy; }
  if (h.type === 'spin') { L.spinners[h.i].x += dx; L.spinners[h.i].y += dy; }
  if (h.type === 'portal') { const p = L.portals[h.i][h.part]; p[0] += dx; p[1] += dy; }
  if (h.type === 'cup') { L.cup.x += dx; L.cup.rim += dy; L.cup.bot += dy; }
  h.x += dx; h.y += dy;
}

function del() {
  if (!sel) return;
  if (sel.type === 'rail') L.rails.splice(sel.i, 1);
  if (sel.type === 'peg') L.pegs.splice(sel.i, 1);
  if (sel.type === 'spin') L.spinners.splice(sel.i, 1);
  if (sel.type === 'portal') L.portals.splice(sel.i, 1);
  sel = null; rebuild();
}

$('add-rail').onclick = () => { L.rails.push([200, 450, 340, 480, 7, 0.5]); rebuild(); };
$('add-peg').onclick = () => { L.pegs.push([270, 420, 16]); rebuild(); };
$('add-spin').onclick = () => { L.spinners.push({ x: 300, y: 500, L: 48, w: 7, omega: 2.4, theta0: 0 }); rebuild(); };
$('add-portal').onclick = () => { L.portals.push({ a: [440, 260], b: [110, 470], r: 19 }); rebuild(); };
$('del').onclick = del;
$('flip').onclick = () => {
  const fx = (x) => 540 - x;
  L.start[0] = fx(L.start[0]);
  L.pad = [fx(L.pad[2]), L.pad[3], fx(L.pad[0]), L.pad[1]];
  L.rails = L.rails.map(q => [fx(q[0]), q[1], fx(q[2]), q[3], q[4], q[5]]);
  L.pegs = L.pegs.map(q => [fx(q[0]), q[1], q[2]]);
  L.spinners.forEach(s => { s.x = fx(s.x); s.omega = -s.omega; s.theta0 = Math.PI - s.theta0; });
  L.portals.forEach(p => { p.a[0] = fx(p.a[0]); p.b[0] = fx(p.b[0]); });
  L.cup.x = fx(L.cup.x);
  rebuild();
};

// ------------------------------------------------------------- properties
function field(label, get, set, step = 1) {
  const w = document.createElement('label'); w.className = 'f';
  w.textContent = label;
  const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = get();
  i.onchange = () => { set(+i.value); rebuild(); };
  w.appendChild(i);
  return w;
}
function renderProps() {
  const box = $('props');
  box.innerHTML = '';
  const add = (...f) => f.forEach(x => box.appendChild(x));
  add(field('Par', () => L.par || 3, v => { L.par = v; }));
  if (!sel) return;
  if (sel.type === 'rail') {
    const q = L.rails[sel.i];
    add(field('x1', () => q[0], v => q[0] = v), field('y1', () => q[1], v => q[1] = v), field('x2', () => q[2], v => q[2] = v), field('y2', () => q[3], v => q[3] = v),
      field('thickness', () => q[4] ?? 7, v => q[4] = v), field('bounce', () => q[5] ?? 0.5, v => q[5] = v, 0.05));
  }
  if (sel.type === 'peg') { const q = L.pegs[sel.i]; add(field('x', () => q[0], v => q[0] = v), field('y', () => q[1], v => q[1] = v), field('radius', () => q[2], v => q[2] = v)); }
  if (sel.type === 'spin') {
    const s = L.spinners[sel.i];
    add(field('x', () => s.x, v => s.x = v), field('y', () => s.y, v => s.y = v), field('half length', () => s.L, v => s.L = v),
      field('speed (rad/s)', () => s.omega, v => s.omega = v, 0.1), field('start angle', () => s.theta0, v => s.theta0 = v, 0.1));
  }
  if (sel.type === 'portal') { const p = L.portals[sel.i]; add(field('in x', () => p.a[0], v => p.a[0] = v), field('in y', () => p.a[1], v => p.a[1] = v), field('out x', () => p.b[0], v => p.b[0] = v), field('out y', () => p.b[1], v => p.b[1] = v)); }
  if (sel.type === 'cup') { add(field('x', () => L.cup.x, v => L.cup.x = v), field('rim y', () => L.cup.rim, v => { L.cup.bot += v - L.cup.rim; L.cup.rim = v; }), field('width', () => L.cup.w, v => L.cup.w = v)); }
}

// ------------------------------------------------------------- analysis
$('analyze').onclick = () => {
  const N = 2000;
  let i = 0, hits = 0, stuck = 0, best = null;
  const t0 = performance.now();
  const step = () => {
    const end = Math.min(N, i + 150);
    for (; i < end; i++) {
      const a = (-178 + Math.random() * 186) * Math.PI / 180;
      const sp = 300 + Math.random() * 1000;
      const shot = { qx: Math.round(sp * Math.cos(a) / 2), qy: Math.round(sp * Math.sin(a) / 2), t0: Math.floor(Math.random() * 12000) };
      const res = P.simulate(C, shot, { record: false });
      if (res.outcome === 'hit') { hits++; if (!best || res.events.length > best.n) best = { shot, n: res.events.length }; }
      else if (res.outcome !== 'fall') stuck++;
    }
    $('stats').textContent = `Simulating… ${i}/${N}`;
    if (i < N) { setTimeout(step, 0); return; }
    const h = hits / N;
    const par = h >= 0.12 ? 2 : h >= 0.06 ? 3 : h >= 0.035 ? 4 : 5;
    lastStats = { hitRate: +h.toFixed(4), stuck: +(stuck / N).toFixed(4), solution: best ? best.shot : null, par };
    L.par = par;
    L.stats = { hitRate: lastStats.hitRate, stuck: lastStats.stuck, routes: 0, attempts: 0 };
    L.solution = lastStats.solution;
    $('stats').innerHTML = `Random-shot hit rate: <b>${(h * 100).toFixed(1)}%</b> (target: Mon 10–18%, Sun 2.5–4.5%)<br>
      Ball got stuck / timed out: <b>${(stuck / N * 100).toFixed(1)}%</b> (keep under 9%)<br>
      Suggested par: <b>${par}</b> ${hits ? '' : '<br><b style="color:#ff8aa8">No winning shot found — this level may be impossible.</b>'}<br>
      <span>${N} shots in ${((performance.now() - t0) / 1000).toFixed(1)}s</span>`;
    rebuild();
  };
  step();
};
$('showsol').onclick = () => {
  const s = L.solution || (lastStats && lastStats.solution);
  if (!s) { $('stats').textContent = 'Run the difficulty check first.'; return; }
  test = { res: P.simulate(C, s, { extraTicks: 300 }), shot: s, p: 0 };
};

// ------------------------------------------------------------- export
$('copy').onclick = async () => { await navigator.clipboard.writeText(JSON.stringify(L)); $('copy').textContent = 'Copied!'; setTimeout(() => { $('copy').textContent = 'Copy level JSON'; }, 1500); };
$('apply').onclick = () => { try { L = JSON.parse($('json').value); sel = null; rebuild(); } catch (e) { alert('Invalid JSON: ' + e.message); } };
$('dl').onclick = () => {
  const out = LEVELS.map(l => (l.day === L.day ? L : l));
  if (!out.some(l => l.day === L.day)) out.push(L);
  out.sort((a, b) => a.day - b.day);
  LEVELS = out;
  const blob = new Blob([JSON.stringify({ version: 1, generated: new Date().toISOString(), levels: out })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${PACK}.json`; a.click();
};

// ------------------------------------------------------------- draw loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (test) test.p += dt * P.HZ; else tick += dt * P.HZ;
  const tk = test ? test.shot.t0 + test.p : tick;
  r.begin(cam);
  r.portals(tk / P.HZ, 0);
  r.bumpers([]);
  r.spinners(tk, []);
  const g = r.ctx;
  if (test) {
    const p = test.res.path;
    g.save(); g.strokeStyle = 'rgba(255,206,44,0.8)'; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath();
    for (let k = 0; k < p.length; k += 4) { if (k && Math.abs(p[k] - p[k - 4]) + Math.abs(p[k + 1] - p[k - 3]) > 40) g.moveTo(p[k], p[k + 1]); else g.lineTo(p[k], p[k + 1]); }
    g.stroke(); g.restore();
    const [x, y] = P.sampleAt(test.res, Math.min(test.p, test.res.ticks));
    r.drawBall(x, y, test.p / 40, {});
    if (test.p > test.res.ticks + 600) test = null;
  } else r.drawBall(L.start[0], L.start[1], 0, {});
  r.cupGlass(0);
  // handles
  g.save();
  for (const h of handles()) {
    const on = sel && sel.type === h.type && sel.i === h.i && sel.part === h.part;
    g.strokeStyle = on ? '#ffce2c' : 'rgba(255,255,255,0.55)';
    g.lineWidth = on ? 2.5 : 1.2;
    g.setLineDash(on ? [] : [3, 3]);
    g.beginPath(); g.arc(h.x, h.y, h.rad, 0, Math.PI * 2); g.stroke();
  }
  if (drag && drag.kind === 'shot') {
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([]);
    g.beginPath(); g.moveTo(drag.x0, drag.y0); g.lineTo(drag.x, drag.y); g.stroke();
  }
  g.restore();
  requestAnimationFrame(frame);
}
rebuild();
requestAnimationFrame(frame);
