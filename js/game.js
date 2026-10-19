// Bouncle — game controller: daily challenges + Adventure, aiming, shot playback, results, sharing, ghosts.
import * as P from './physics.js';
import { Renderer, loadImages } from './render.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import * as Store from './store.js';
import { CONFIG, GOLF, SKINS } from './config.js';
import * as Daily from './daily.js';
import * as Share from './share.js';
import * as Bridge from './bridge.js';
import * as UI from './ui.js';
import { THEMES, rgba } from './themes.js';
import { trickText, trickProgress, starsFor } from './challenges.js';

export const VERSION = '1.0.0';
const $ = UI.$;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const KIND_COL = { bumper: '#ff6c96', rim: '#ffd23c', cup: '#46ecbe', spinner: '#ffa64d', rail: '#ffffff', pad: '#b9a8ff', wall: '#d8d0ff' };
const DAILY_ORDER = ['daily', 'oneshot', 'trick'];
const MODE_NAME = { daily: 'Daily Level', oneshot: 'One Shot', trick: 'Trick Shot', adventure: 'Adventure', practice: 'Practice', challenge: 'Challenge' };

export class Game {
  constructor() {
    this.cv = $('game');
    this.r = new Renderer(this.cv);
    this.fx = new FX();
    this.st = Store.load();
    this.cam = { z: 1, fx: 270, fy: 480, shx: 0, shy: 0 };
    this.camT = { z: 1, fx: 270, fy: 480 };
    this.shake = 0;
    this.tick = 0;
    this.mode = 'idle';
    this.flight = null;
    this.trail = [];
    this.phi = 0;
    this.pulses = []; this.spinFlash = []; this.portalFlash = 0; this.cupGlow = 0;
    this.ballK = 1;
    this.lastT = performance.now();
    this.flash = 0;
    this.run = null;
  }

  // ------------------------------------------------------------ setup
  async init() {
    await Daily.loadLevels();
    this.today = Daily.dayNumber();
    const dbg = new URLSearchParams(location.search).get('debugday');
    if (dbg !== null && dbg !== '' && Number.isFinite(+dbg)) this.today = Math.round(+dbg);
    Store.pruneOld(this.today);
    const ch = Share.parseLocation();
    if (ch) {
      const mine = this.todayDaily();
      const same = ch.idx ? ch.idx === mine.idx : (ch.day === this.today && mine.shared);
      if (same) {
        // same level as my Daily Level today: they become a friend on today's leaderboard + ghost
        Store.addFriend(this.today, { name: ch.name, score: ch.score, shot: ch.shot, idx: mine.idx });
        this.challenge = { ...ch, same: true };
      } else if (ch.idx >= 1 && ch.idx <= Daily.PACKS.daily.length) {
        // their level is different from mine (starter week, or an older link): offer it as a challenge
        this.challenge = { ...ch, same: false, played: false };
      }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }
    await loadImages([
      ['chrome', 'assets/img/skins/chrome.png'], ['gold', 'assets/img/skins/gold.png'],
      ['lava', 'assets/img/skins/lava.png'], ['galaxy', 'assets/img/skins/galaxy.png'],
    ]);
    ['hio', 'eagle', 'birdie', 'par', 'bogey', 'in', 'close', 'out', 'notrick', 'miss'].forEach(k => { const i = new Image(); i.src = `assets/img/stamp_${k}.png`; });
    this.applySettings();
    this.startRun('daily', this.today);
    this.bindInput();
    this.bindUI();
    window.addEventListener('resize', () => this.r.resize());
    requestAnimationFrame((t) => this.frame(t));
    setInterval(() => this.checkRollover(), 20000);
    $('loading').classList.add('gone');
    setTimeout(() => UI.hide('loading'), 450);
    if (Bridge.isNative) Bridge.gcAuth();
    if (!this.st.profile.onboarded) this.showOnboarding(() => this.showHome());
    else this.showHome();
  }

  applySettings() {
    const s = this.st.settings;
    Sound.setSfx(s.sound);
    Sound.musicOn = s.music;
    if (!s.music) Sound.stopMusic(); else Sound.startMusic();
  }

  // today's Daily Level for this player (starter week first, then the shared daily)
  todayDaily() { return Daily.dailyLevel(this.today, Store.starters()); }

  // ------------------------------------------------------------ runs (one level being played)
  // kind: daily | oneshot | trick | adventure | practice
  startRun(kind, id) {
    let level, rec, maxShots = CONFIG.MAX_SHOTS, title, sub;
    if (kind === 'adventure') {
      level = Daily.adventureLevel(id);
      rec = { shots: [], done: false, score: 0, holed: false };
      maxShots = Infinity;
      title = `LEVEL ${level.world}-${level.index}`;
      const best = this.st.adv[id];
      sub = `${level.worldName}${best && best.stars ? ' · ' + '★'.repeat(best.stars) : ''}`;
    } else if (kind === 'practice') {        // id = Daily Level index
      level = Daily.dailyByIndex(id);
      rec = { shots: [], done: false, score: 0, holed: false };
      title = 'PRACTICE';
      sub = `${THEMES[level.theme].name} · not counted`;
    } else if (kind === 'challenge') {       // id = Daily Level index from a friend's link
      level = Daily.dailyByIndex(id);
      rec = { shots: [], done: false, score: 0, holed: false };
      const ch = this.challenge || { name: 'Friend', score: 0 };
      title = 'CHALLENGE';
      sub = `${ch.name}: ${ch.score} shot${ch.score === 1 ? '' : 's'}`;
    } else if (kind === 'daily') {           // id = calendar day
      level = Daily.dailyLevel(id, Store.starters());
      rec = Store.dayRecord(id);
      title = level.starter ? `STARTER ${level.starter}/7` : Daily.dayLabel(id).toUpperCase();
      sub = `${THEMES[level.theme].name} · ${level.difficulty}`;
    } else {
      level = Daily.levelForDay(id, kind);
      rec = Store.modeRecord(kind, id);
      if (kind === 'oneshot') maxShots = 1;
      title = kind === 'oneshot' ? 'ONE SHOT' : 'TRICK SHOT';
      sub = `${Daily.dayLabel(id)} · ${THEMES[level.theme].name}`;
    }
    this.run = { kind, id, level, rec, maxShots, title, sub, trick: kind === 'trick' ? level.trick : null };
    this.level = level;
    this.rec = rec;
    this.C = P.compileLevel(level);
    this.theme = THEMES[level.theme] || THEMES.toybox;
    this.r.setLevel(this.C, level.theme);
    this.tick = 0;
    this.flight = null;
    this.fx.clear();
    this.trail = [];
    this.pulses = this.C.pegs.map(() => 0);
    this.spinFlash = this.C.spinners.map(() => 0);
    this.ballK = 1;
    this.lastWin = null;
    this.newSkins = [];
    this.camT = { z: 1, fx: 270, fy: 480 };
    this.updateHud();
    this.updateTrickChip(null);
  }

  get isDailyKind() { return DAILY_ORDER.includes(this.run.kind); }

  checkRollover() {
    const d = Daily.dayNumber();
    if (d === this.today || this.mode === 'flight' || this.mode === 'drag') return;
    this.today = d;
    if (['daily', 'oneshot', 'trick'].includes(this.run.kind)) {
      this.startRun('daily', d);
      UI.hide('result');
      this.showHome();
    }
    UI.toast('New daily challenges are ready!');
  }

  // ------------------------------------------------------------ HUD
  updateHud() {
    const run = this.run, L = this.level;
    $('hud-title').textContent = run.title;
    $('hud-sub').textContent = run.sub;
    const n = this.rec.shots.length + (this.mode === 'flight' && this.flight && this.flight.own ? 1 : 0);
    const el = $('hud-shotsn');
    if (el.textContent !== String(n)) { el.textContent = n; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    $('hud-par').textContent = run.kind === 'oneshot' ? '1 TRY' : `PAR ${L.par}`;
    const capped = Number.isFinite(run.maxShots);
    $('shotdots').hidden = !capped;
    if (capped) UI.setDots($('shotdots'), this.rec.shots, run.maxShots, this.rec.done ? -1 : this.rec.shots.length);
    $('startarget').hidden = run.kind !== 'adventure';
    if (run.kind === 'adventure') {
      $('startarget').innerHTML = `<span class="st">★★★</span> ≤ ${L.par} <span class="st">★★</span> ≤ ${L.par + 2}`;
    }
    $('btn-restart').hidden = run.kind !== 'adventure' || !this.rec.shots.length;
    const ghosts = run.kind === 'challenge' ? (this.challenge ? [this.challenge] : []) : run.kind === 'daily' && run.id === this.today ? this.friendsToday() : [];
    $('btn-ghosts').hidden = !ghosts.length;
    $('ghostcount').textContent = ghosts.length;
  }

  updateTrickChip(res, upTo = Infinity) {
    const t = this.run && this.run.trick;
    const chip = $('trickchip');
    if (!t) { chip.hidden = true; return; }
    const pr = trickProgress(t, res ? res.events : [], upTo);
    $('trick-text').textContent = trickText(t);
    $('trick-prog').textContent = t.type === 'norail' ? (pr.broken ? 'touched' : 'clean') : `${pr.count}/${pr.need}`;
    chip.classList.toggle('ok', pr.ok && !!res);
    chip.classList.toggle('broken', pr.broken);
    chip.hidden = $('hud').hidden;
  }

  // friends whose link was for the same level as my Daily Level today
  friendsToday() {
    const idx = this.todayDaily().idx;
    return (this.st.friends[this.today] || []).filter(f => !f.idx || f.idx === idx);
  }

  setPlaying(on) {
    $('hud').hidden = !on;
    $('bottombar').hidden = !on;
    if (!on) $('trickchip').hidden = true;
    else this.updateTrickChip(null);
  }

  // ------------------------------------------------------------ hub
  dailyStatus(kind) {
    const rec = kind === 'daily' ? Store.dayRecord(this.today) : Store.modeRecord(kind, this.today);
    if (!rec.done) return { done: false, txt: rec.shots.length ? 'Continue' : 'Play', cls: '' };
    if (kind === 'oneshot') return { done: true, txt: rec.holed ? '🎯 Holed' : 'Missed', cls: rec.holed ? 'done' : 'miss' };
    return { done: true, txt: rec.holed ? `✓ ${rec.score} shot${rec.score > 1 ? 's' : ''}` : 'X', cls: rec.holed ? 'done' : 'miss' };
  }

  showHome() {
    this.mode = 'idle';
    UI.hide('result'); UI.hide('map');
    this.setPlaying(false);
    if (this.run.kind !== 'daily' || this.run.id !== this.today) this.startRun('daily', this.today);
    UI.show('home');
    const dl = this.todayDaily();
    $('home-day').textContent = dl.starter ? `Your starter week · ${dl.starter}/7` : `${Daily.dayLabel(this.today)} · ${THEMES[dl.theme].name}`;
    $('cd-daily').textContent = dl.starter ? `Starter level ${dl.starter} of 7 · ${dl.difficulty}` : `Same for everyone · ${dl.difficulty}`;
    const tr = Daily.levelForDay(this.today, 'trick');
    $('cd-trick').textContent = trickText(tr.trick);
    for (const k of DAILY_ORDER) {
      const s = this.dailyStatus(k);
      const el = $('cs-' + k);
      el.textContent = s.txt;
      el.className = 'cstat ' + s.cls;
    }
    const total = Daily.adventureCount();
    const cur = Store.advCurrent(total);
    const L = Daily.adventureLevel(cur);
    $('adv-title').textContent = `World ${L.world} · ${L.worldName}`;
    $('adv-sub').textContent = `Level ${L.world}-${L.index} · ★ ${Store.totalStars()} / ${total * 3}`;
    $('adv-go').textContent = Object.keys(this.st.adv).length ? 'Continue' : 'Start';
    const streak = Store.currentStreak(this.today);
    $('home-streak').hidden = streak < 1;
    $('home-streakn').textContent = streak;
    const ch = this.challenge;
    const box = $('challenge');
    if (ch && ch.same && !Store.dayRecord(this.today).done) {
      box.innerHTML = '';
      box.appendChild(UI.avatar(ch.name));
      const t = document.createElement('div');
      t.innerHTML = `<b>${UI.esc(ch.name)}</b> holed today's Daily Level in <b>${ch.score}</b>. Beat it, then race their ghost.`;
      box.appendChild(t);
      box.hidden = false;
    } else if (ch && !ch.same && !ch.played) {
      box.innerHTML = '';
      box.appendChild(UI.avatar(ch.name));
      const t = document.createElement('div');
      t.innerHTML = `<b>${UI.esc(ch.name)}</b> sent you their level. They holed it in <b>${ch.score}</b>. Can you beat that?`;
      box.appendChild(t);
      const b = document.createElement('button');
      b.className = 'btn primary chgo';
      b.textContent = 'Play';
      b.onclick = () => { Sound.unlock(); Sound.play('blip', { gain: 0.35 }); this.playKind('challenge', ch.idx); };
      box.appendChild(b);
      box.hidden = false;
    } else box.hidden = true;
    this.updateCountdown();
  }

  updateCountdown() {
    const txt = `New in ${Daily.fmtCountdown(Daily.msToNextDay())}`;
    const allDone = DAILY_ORDER.every(k => this.dailyStatus(k).done);
    const hc = $('home-count');
    hc.hidden = !allDone;
    hc.textContent = txt;
    const doneStarter = this.run && this.run.kind === 'daily' && this.rec.done && this.level.starter === Daily.STARTER_DAYS;
    $('res-count').textContent = doneStarter ? 'Starter week done! From tomorrow you play the same Daily Level as everyone.'
      : this.run && this.isDailyKind && this.rec.done ? `Next daily challenges in ${Daily.fmtCountdown(Daily.msToNextDay())}` : '';
  }

  playKind(kind, id) {
    UI.hide('home'); UI.hide('map'); UI.hide('result');
    this.startRun(kind, id);
    if (this.rec.done) { this.showResult(); return; }
    this.setPlaying(true);
    this.toAim();
    Sound.unlock();
    if (kind === 'adventure' && this.level.index === 1) {
      const w = Daily.WORLDS[this.level.world - 1];
      if (w) UI.toast(`World ${this.level.world}: ${w.name} · New: ${w.intro}`);
    }
  }

  toAim() {
    this.mode = 'aim';
    this.ballK = 0;
    this.trail = [];
    this.phi = 0;
    this.camT = { z: 1, fx: 270, fy: 480 };
    this.updateHud();
    this.updateTrickChip(null);
    const firstTimer = this.st.stats.played < 2 && this.rec.shots.length < 2 && this.run.kind !== 'adventure';
    const advFirst = this.run.kind === 'adventure' && this.run.id <= 2 && this.rec.shots.length < 2;
    $('hint').hidden = !(firstTimer || advFirst);
  }

  showOnboarding(done) {
    UI.show('onboard');
    let i = 0;
    const slides = $('ob-slides'), dots = [...$('ob-dots').children], next = $('ob-next');
    const go = () => {
      slides.style.transform = `translateX(${-100 * i}%)`;
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      next.textContent = i === 2 ? "Let's play" : 'Next';
    };
    go();
    next.onclick = () => {
      Sound.unlock();
      Sound.play('blip', { gain: 0.5, rate: 1 + i * 0.12 });
      if (i < 2) { i++; go(); return; }
      UI.hide('onboard');
      this.st.profile.onboarded = true;
      Store.save();
      done && done();
    };
  }

  // ------------------------------------------------------------ adventure map
  showMap(scrollTo) {
    this.mode = 'idle';
    UI.hide('home'); UI.hide('result');
    this.setPlaying(false);
    const total = Daily.adventureCount();
    const cur = Store.advCurrent(total);
    $('map-stars').textContent = `★ ${Store.totalStars()} / ${total * 3}`;
    const box = $('mapscroll');
    box.innerHTML = '';
    const nWorlds = Math.ceil(total / CONFIG.ADVENTURE_WORLD_SIZE);
    let curEl = null;
    for (let w = 0; w < nWorlds; w++) {
      const info = Daily.WORLDS[w] || Daily.WORLDS[Daily.WORLDS.length - 1];
      const first = w * 25 + 1, last = Math.min(total, first + 24);
      const unlocked = Store.advUnlocked(first);
      let stars = 0;
      for (let n = first; n <= last; n++) stars += (this.st.adv[n] && this.st.adv[n].stars) || 0;
      const sec = document.createElement('div');
      sec.className = 'world' + (unlocked ? '' : ' locked');
      sec.innerHTML = `<div class="world-head"><div><span class="wn">WORLD ${w + 1}</span><b>${info.name}</b><small>${unlocked ? 'New: ' + info.intro : 'Finish World ' + w + ' to unlock'}</small></div><span class="wstars">★ ${stars}/${(last - first + 1) * 3}</span></div>`;
      const grid = document.createElement('div');
      grid.className = 'lvgrid';
      for (let n = first; n <= last; n++) {
        const b = document.createElement('button');
        const r = this.st.adv[n];
        const open = Store.advUnlocked(n);
        b.className = 'lv' + (!open ? ' locked' : '') + (n === cur && open && !(r && r.done) ? ' cur' : '');
        const s = r && r.stars ? r.stars : 0;
        b.innerHTML = open ? `<b>${n - first + 1}</b><span class="s">${'★'.repeat(s)}<span class="off">${'★'.repeat(3 - s)}</span></span>`
          : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';
        if (open) b.onclick = () => { Sound.play('blip', { gain: 0.4, rate: 1.2 }); this.playKind('adventure', n); };
        if (n === (scrollTo || cur)) curEl = b;
        grid.appendChild(b);
      }
      sec.appendChild(grid);
      box.appendChild(sec);
    }
    UI.show('map');
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'center' }), 30);
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => {
      Sound.unlock();
      if (this.mode !== 'aim' || this.ballK < 0.9) return;
      this.drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId, lastK: 0 };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.mode = 'drag';
      $('hint').hidden = true;
      Bridge.haptic('selection');
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.mode !== 'drag' || !this.drag || e.pointerId !== this.drag.id) return;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      const a = this.aimVec();
      const step = Math.floor(a.k * 4);
      if (step !== this.drag.lastK) { this.drag.lastK = step; if (a.k > 0) { Bridge.haptic('selection'); Sound.play('blip', { gain: 0.12, rate: 0.8 + a.k * 0.6 }); } }
    });
    const up = (e) => {
      if (this.mode !== 'drag' || !this.drag || e.pointerId !== this.drag.id) return;
      const a = this.aimVec();
      this.drag = null;
      if (a.len < 14) { this.mode = 'aim'; return; }
      this.shoot(a.vx, a.vy);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { if (this.mode === 'drag') { this.drag = null; this.mode = 'aim'; } });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode === 'drag') { this.drag = null; this.mode = 'aim'; }
    });
  }

  aimVec() {
    const d = this.drag;
    const dx = (d.x0 - d.x) / this.r.s, dy = (d.y0 - d.y) / this.r.s;
    const len = Math.hypot(dx, dy);
    const k = clamp((len - 12) / 125, 0, 1);
    const sp = P.MIN_SPEED + (P.MAX_SPEED - P.MIN_SPEED) * k;
    const ux = len ? dx / len : 0, uy = len ? dy / len : -1;
    return { vx: ux * sp, vy: uy * sp, k, len, ux, uy };
  }

  // ------------------------------------------------------------ shooting
  shoot(vx, vy) {
    const q = P.quantize(vx, vy);
    const shot = { qx: q.qx, qy: q.qy, t0: Math.floor(this.tick) };
    const res = P.simulate(this.C, shot, { extraTicks: 420 });
    Sound.play('thwip', { gain: 0.8 });
    Bridge.haptic('medium');
    this.startFlight(res, shot, { own: true });
  }

  // test hook: fire an exact shot (used by automated tests / screenshots)
  debugShoot(shot) {
    if (this.mode !== 'aim') return false;
    const res = P.simulate(this.C, shot, { extraTicks: 420 });
    this.tick = shot.t0;
    this.startFlight(res, shot, { own: true });
    return res.outcome;
  }

  startFlight(res, shot, o = {}) {
    const entry = P.cupEntryTick(this.C, res);
    const rimEv = res.events.find(e => e.kind === 'rim');
    const trick = o.own && this.run.trick ? this.run.trick : null;
    const trickOk = trick ? trickProgress(trick, res.events, entry > 0 ? entry : res.outTick).ok : true;
    this.flight = {
      res, shot, p: o.from || 0, entry, rim: rimEv ? rimEv.tick : -1, ev: 0, own: !!o.own, ghost: o.ghost || null,
      replay: !!o.replay, clip: !!o.clip, end: res.outcome === 'hit' ? res.outTick + 300 : res.outTick + 30,
      done: o.done || null, entered: false, lastXY: null, trickOk,
    };
    if (o.from) {
      while (this.flight.ev < res.events.length && res.events[this.flight.ev].tick <= o.from) this.flight.ev++;
    }
    this.prevMode = this.mode;
    this.mode = 'flight';
    this.trail = [];
    this.ballK = 1;
    this.updateHud();
  }

  slowRate(f) {
    const ramp = (p, a, b, r) => {
      const w = 60;
      if (p < a - w || p > b + w) return 1;
      if (p < a) return 1 + (r - 1) * ((p - (a - w)) / w);
      if (p > b) return r + (1 - r) * ((p - b) / w);
      return r;
    };
    if (f.entry > 0 && f.trickOk) return ramp(f.p, f.entry - 250, f.entry + 170, 0.28);
    if (f.rim > 0 && f.own) return ramp(f.p, f.rim - 120, f.rim + 90, 0.5);
    return 1;
  }

  updateFlight(dt) {
    const f = this.flight, res = f.res;
    const rate = this.slowRate(f);
    f.rate = rate;
    f.p += dt * P.HZ * rate;
    this.tick = f.shot.t0 + f.p;
    const quiet = !!f.ghost;
    let evFired = false;
    while (f.ev < res.events.length && res.events[f.ev].tick <= f.p) {
      this.onEvent(res.events[f.ev], quiet, rate, f);
      f.ev++;
      evFired = true;
    }
    if (evFired && f.own && this.run.trick) this.updateTrickChip(res, f.p);
    if (f.entry > 0 && !f.entered && f.p >= f.entry) {
      f.entered = true;
      if (!f.ghost) this.onHole(f);
      else { Sound.play('ding', { gain: 0.5 }); this.fx.ring(this.C.cup.x, (this.C.cup.rim + this.C.cup.bot) / 2, '#46ecbe', 50, 0.5); }
    }
    const [x, y, vx, vy] = P.sampleAt(res, f.p);
    if (f.lastXY) {
      const d = Math.hypot(x - f.lastXY[0], y - f.lastXY[1]);
      if (d < 40) this.phi += (vx >= 0 ? 1 : -1) * d / P.R;
      else this.trail = [];
    }
    f.lastXY = [x, y];
    this.trail.push([x, y]);
    if (this.trail.length > (f.ghost ? 22 : 15)) this.trail.shift();
    this.ball = { x, y, vx, vy };
    const cupC = { fx: this.C.cup.x, fy: (this.C.cup.rim + this.C.cup.bot) / 2 };
    if (f.entry > 0 && f.trickOk && f.p > f.entry - 330 && !this.st.settings.reduceMotion) this.camT = { z: f.clip ? 1.5 : 1.32, ...cupC };
    else if (f.clip) this.camT = { z: 1.5, ...cupC };
    else if (f.rim > 0 && f.own && Math.abs(f.p - f.rim) < 160 && !this.st.settings.reduceMotion) this.camT = { z: 1.12, fx: this.C.cup.x, fy: this.C.cup.rim };
    else this.camT = { z: 1, fx: 270, fy: 480 };
    if (f.p >= f.end) this.endFlight();
  }

  onEvent(e, quiet, rate) {
    const pitch = 0.62 + 0.38 * rate;
    const g = quiet ? 0.35 : 1;
    const pan = (e.x - 270) / 270 * 0.6;
    const st = clamp(e.v / 1000, 0.15, 1);
    const hap = !quiet && this.st.settings.haptics;
    switch (e.kind) {
      case 'bumper':
        Sound.play('boing', { gain: 0.7 * g, rate: pitch * (0.95 + 0.1 * (e.idx || 0)), pan });
        this.pulses[e.idx] = 1;
        if (!quiet) { this.fx.sparks(e.x + e.nx * 16, e.y + e.ny * 16, KIND_COL.bumper, 9, 260); this.fx.ring(e.x, e.y, KIND_COL.bumper, 32); this.shake = Math.max(this.shake, 1.6); }
        if (hap) Bridge.haptic('medium');
        break;
      case 'spinner':
        Sound.play('thwack', { gain: 0.8 * g, rate: pitch, pan });
        this.spinFlash[e.idx] = 1;
        if (!quiet) { this.fx.sparks(e.x, e.y, KIND_COL.spinner, 9, 280); this.fx.ring(e.x, e.y, KIND_COL.spinner, 30); this.shake = Math.max(this.shake, 2); }
        if (hap) Bridge.haptic('medium');
        break;
      case 'rim':
        Sound.play('clank', { gain: 0.9 * g, rate: pitch, pan });
        if (!quiet) { this.fx.sparks(e.x, e.y, KIND_COL.rim, 14, 320); this.fx.ring(e.x, e.y, KIND_COL.rim, 40); this.shake = Math.max(this.shake, 2.6); }
        if (hap) Bridge.haptic('heavy');
        break;
      case 'cup':
        Sound.play('plunk', { gain: 0.7 * g * (0.4 + 0.6 * st), rate: pitch, pan });
        if (hap) Bridge.haptic('light');
        break;
      case 'portal_in':
        Sound.play('warp_in', { gain: 0.6 * g, rate: pitch, pan });
        this.portalFlash = 1;
        this.fx.ring(e.x, e.y, this.theme.pa, 46, 0.45);
        if (hap) Bridge.haptic('light');
        break;
      case 'portal_out':
        Sound.play('warp_out', { gain: 0.6 * g, rate: pitch, pan });
        this.fx.ring(e.x, e.y, this.theme.pb, 46, 0.45);
        break;
      default:
        Sound.play(e.kind === 'wall' ? 'tok_lo' : 'tok', { gain: (0.35 + 0.5 * st) * g, rate: pitch * (0.9 + 0.25 * st), pan });
        if (!quiet && e.v > 200) this.fx.sparks(e.x, e.y, '#ffffff', 6, 200);
        if (hap && e.v > 260) Bridge.haptic('light');
    }
  }

  onHole(f) {
    const C = this.C;
    if (f.own && !f.trickOk) {   // holed, but the trick wasn't done
      Sound.play('ding', { gain: 0.4, rate: 0.8 });
      UI.stamp('notrick', 'show');
      if (this.st.settings.haptics) Bridge.haptic('warning');
      return;
    }
    this.cupGlow = 1;
    this.flash = f.clip ? 0 : 0.35;
    this.shake = Math.max(this.shake, 3);
    Sound.play('fanfare', { gain: 0.9 });
    Sound.play('sparkle', { gain: 0.6, delay: 0.05 });
    if (this.st.settings.haptics) Bridge.haptic('success');
    if (!this.st.settings.reduceMotion) this.fx.confetti(C.cup.x, C.cup.rim, f.clip ? 90 : 120);
    if (f.own) {
      const score = this.rec.shots.length + 1;
      UI.stamp(GOLF(score, this.level.par).key, 'show');
    }
  }

  endFlight() {
    const f = this.flight, res = f.res;
    this.flight = null;
    if (f.ghost || f.replay || f.clip) {
      this.mode = this.prevMode === 'flight' ? 'aim' : this.prevMode;
      $('ghostbanner').hidden = true;
      this.camT = { z: 1, fx: 270, fy: 480 };
      if (f.done) f.done();
      else if (this.mode === 'aim') this.toAim();
      return;
    }
    const run = this.run, rec = this.rec;
    const holed = res.outcome === 'hit' && f.trickOk;
    rec.shots.push({ qx: f.shot.qx, qy: f.shot.qy, t0: f.shot.t0, o: holed ? 'hit' : 'miss', rim: !!res.rim || (res.outcome === 'hit' && !f.trickOk) });
    if (run.kind === 'daily' && this.level.tentative) { Store.claimStarter(run.id, this.level.starter); this.level.tentative = false; }
    if (run.kind === 'daily' || run.kind === 'oneshot' || run.kind === 'trick') Store.save();
    if (holed) {
      const score = rec.shots.length;
      this.lastWin = { res, shot: f.shot };
      const beforeSkins = this.unlockedSkins();
      if (run.kind === 'daily') {
        Store.finishDay(run.id, true, score);
        if (Bridge.isNative && this.level.shared) Bridge.gcSubmit(score, run.id);
        if (this.st.stats.holed === 3 && Bridge.isNative) setTimeout(() => Bridge.requestReview(), 2500);
      } else if (run.kind === 'oneshot') Store.finishOneShot(run.id, true);
      else if (run.kind === 'trick') Store.finishTrick(run.id, true, score);
      else if (run.kind === 'adventure') {
        rec.stars = starsFor(score, this.level.par);
        rec.adv = Store.finishAdventure(run.id, score, rec.stars);
      }
      if (run.kind !== 'practice') { rec.done = true; rec.holed = true; rec.score = score; }
      else { rec.done = true; rec.holed = true; rec.score = score; }
      this.newSkins = this.unlockedSkins().filter(s => !beforeSkins.includes(s));
      if (run.kind === 'challenge' && this.challenge) this.challenge.played = true;
      this.mode = 'done';
      this.updateHud();
      setTimeout(() => { this.camT = { z: 1, fx: 270, fy: 480 }; this.showResult(); }, 1250);
      return;
    }
    this.updateHud();
    if (rec.shots.length >= run.maxShots) {
      if (run.kind === 'daily') Store.finishDay(run.id, false, CONFIG.MAX_SHOTS + 1);
      else if (run.kind === 'oneshot') Store.finishOneShot(run.id, false);
      else if (run.kind === 'trick') Store.finishTrick(run.id, false, CONFIG.MAX_SHOTS + 1);
      else { rec.done = true; rec.holed = false; if (run.kind === 'challenge' && this.challenge) this.challenge.played = true; }
      this.mode = 'done';
      if (run.kind !== 'oneshot' || !res.rim) UI.stamp(run.kind === 'oneshot' ? 'miss' : 'out', 'show');
      else UI.stamp('close', 'show');
      Sound.play('womp', { gain: 0.6 });
      setTimeout(() => this.showResult(), 1400);
      return;
    }
    if (res.rim && !(res.outcome === 'hit')) { UI.stamp('close', 'show'); Sound.play('womp', { gain: 0.45 }); }
    this.mode = 'after';
    setTimeout(() => { this.toAim(); Sound.play('blip', { gain: 0.4, rate: 1.2 }); }, res.rim || res.outcome === 'hit' ? 800 : 350);
  }

  unlockedSkins() {
    const best = this.st.stats.maxStreak, stars = Store.totalStars();
    return SKINS.filter(s => (s.streak ? best >= s.streak : true) && (s.stars ? stars >= s.stars : true)).map(s => s.id);
  }

  restartLevel() {
    if (this.run.kind !== 'adventure' || this.mode !== 'aim') return;
    this.rec.shots = [];
    this.updateHud();
    Sound.play('whoosh', { gain: 0.4 });
    this.toAim();
  }

  // ------------------------------------------------------------ ghosts & replays
  watchGhost(fr) {
    if (this.run.kind !== 'challenge' && (this.run.kind !== 'daily' || this.run.id !== this.today)) this.startRun('daily', this.today);
    if (!this.rec.shots.length && !this.rec.done) { UI.toast('Take your first shot to unlock ghosts'); return; }
    if (this.mode === 'flight' || this.mode === 'drag') return;
    UI.hide('result');
    this.setPlaying(true);
    $('hint').hidden = true;
    const res = P.simulate(this.C, fr.shot, { extraTicks: 300 });
    const b = $('ghostbanner');
    b.innerHTML = '';
    b.appendChild(UI.avatar(fr.name));
    b.appendChild(document.createTextNode(`${fr.name}'s ghost · ${fr.score} shot${fr.score > 1 ? 's' : ''}`));
    b.hidden = false;
    const back = this.rec.done ? () => this.showResult() : null;
    this.ghostColor = UI.colorFor(fr.name);
    this.startFlight(res, fr.shot, { ghost: fr, done: back });
  }

  watchReplay() {
    const w = this.lastWin || this.reconstructWin();
    if (!w) return;
    UI.hide('result');
    this.startFlight(w.res, w.shot, { replay: true, done: () => this.showResult() });
  }

  reconstructWin() {
    const s = this.rec.shots.find(x => x.o === 'hit');
    if (!s) return null;
    const shot = { qx: s.qx, qy: s.qy, t0: s.t0 };
    const res = P.simulate(this.C, shot, { extraTicks: 420 });
    this.lastWin = { res, shot };
    return this.lastWin;
  }

  // ------------------------------------------------------------ results
  nextDaily() {
    for (const k of DAILY_ORDER) if (!this.dailyStatus(k).done) return k;
    return null;
  }

  showResult() {
    this.mode = this.mode === 'flight' ? 'flight' : 'done';
    this.setPlaying(false);
    UI.clearStamp();
    UI.hide('home'); UI.hide('map');
    const run = this.run, rec = this.rec, L = this.level;
    const kind = run.kind;
    // stamp + headline
    let key = 'out', title = 'Out of shots';
    if (rec.holed) { key = GOLF(rec.score, L.par).key; title = `Holed in ${rec.score}`; }
    if (kind === 'oneshot') { key = rec.holed ? 'hio' : 'miss'; title = rec.holed ? 'Nailed it in one!' : 'Missed it'; }
    if (kind === 'trick' && !rec.holed) title = 'No trick today';
    $('res-stamp').src = `assets/img/stamp_${key}.png`;
    $('res-stamp').hidden = kind === 'adventure' && rec.holed;
    const starsEl = $('res-stars');
    starsEl.hidden = kind !== 'adventure' || !rec.holed;
    if (!starsEl.hidden) [...starsEl.children].forEach((s, i) => { s.className = ''; void s.offsetWidth; if (i < rec.stars) s.className = 'on'; });
    $('res-title').textContent = title;
    const subs = {
      daily: `Daily Level · ${L.starter ? `Starter ${L.starter}/7` : Daily.dayLabel(run.id)} · Par ${L.par}`,
      oneshot: `One Shot · ${Daily.dayLabel(run.id)}`,
      trick: `Trick Shot · ${Daily.dayLabel(run.id)} · Par ${L.par}`,
      challenge: `${this.challenge ? this.challenge.name : 'Friend'}'s level · Par ${L.par}`,
      adventure: `Level ${L.world}-${L.index} · ${L.worldName} · Par ${L.par}`,
      practice: `Practice · not counted · Par ${L.par}`,
    };
    $('res-sub').textContent = subs[kind];
    $('res-trick').hidden = kind !== 'trick';
    if (kind === 'trick') $('res-trick').textContent = `✨ ${trickText(run.trick)}`;
    UI.setDots($('res-shots'), rec.shots, Math.max(rec.shots.length, 1));
    $('res-shots').hidden = kind === 'adventure' && rec.shots.length > 12;
    // streak / adventure progress line
    const sl = $('res-streak');
    sl.hidden = false;
    if (kind === 'daily') {
      const streak = Store.currentStreak(this.today);
      sl.innerHTML = rec.holed ? `<span class="flame"></span><b>${streak}</b><span>day streak</span>` : '<span>Streak reset. New daily challenges at midnight.</span>';
    } else if (kind === 'adventure') {
      const a = rec.adv || {};
      const tot = `★ ${Store.totalStars()} / ${Daily.adventureCount() * 3}`;
      sl.innerHTML = a.improved ? `<span>New best! · ${tot}</span>` : a.firstClear ? `<span>Level cleared · ${tot}</span>` : `<span>${tot}</span>`;
    } else if (kind === 'practice') sl.innerHTML = '<span>Practice round — not counted</span>';
    else if (kind === 'challenge' && this.challenge) {
      const c = this.challenge, me = rec.holed ? rec.score : 99;
      const verdict = me < c.score ? 'You win!' : me === c.score ? "It's a tie" : `${UI.esc(c.name)} wins this one`;
      sl.innerHTML = `<span>You <b>${rec.holed ? rec.score : 'X'}</b> · ${UI.esc(c.name)} <b>${c.score}</b> · ${verdict}</span>`;
    }
    else sl.hidden = true;
    // unlocks
    const un = $('res-unlock');
    if (this.newSkins && this.newSkins.length) {
      const sk = SKINS.find(s => s.id === this.newSkins[this.newSkins.length - 1]);
      un.innerHTML = '';
      un.appendChild(this.skinCanvas(sk.id, 40));
      const t = document.createElement('span'); t.textContent = `New ball unlocked: ${sk.name}!`; un.appendChild(t);
      const b = document.createElement('button');
      b.className = 'btn secondary'; b.style.height = '34px'; b.style.fontSize = '13px'; b.textContent = 'Use it';
      b.onclick = () => { this.st.skin = sk.id; Store.save(); un.hidden = true; Sound.play('unlock', { gain: 0.7 }); };
      un.appendChild(b);
      un.hidden = false;
      Sound.play('unlock', { gain: 0.6, delay: 0.4 });
      this.newSkins = [];
    } else un.hidden = true;
    // buttons
    const r1 = $('res-row1'), r2 = $('res-row2'), links = $('res-links');
    r1.innerHTML = ''; r2.innerHTML = ''; links.innerHTML = '';
    const btn = (row, label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls; b.textContent = label;
      b.onclick = () => { Sound.unlock(); Sound.play('blip', { gain: 0.35 }); fn(); };
      row.appendChild(b);
      return b;
    };
    const link = (label, fn) => {
      const b = document.createElement('button'); b.className = 'link'; b.textContent = label;
      b.onclick = () => { Sound.play('blip', { gain: 0.3 }); fn(); };
      links.appendChild(b);
    };
    if (kind === 'adventure') {
      const total = Daily.adventureCount();
      if (rec.holed && run.id < total) btn(r1, 'Next level →', 'primary next', () => this.playKind('adventure', run.id + 1));
      btn(r1, rec.holed ? 'Retry' : 'Try again', rec.holed && run.id < total ? 'secondary' : 'primary', () => this.playKind('adventure', run.id));
      if (rec.holed) {
        btn(r2, 'Share', 'secondary', () => this.shareResult());
        btn(r2, 'Watch replay', 'secondary', () => this.watchReplay());
      }
      link('Level map', () => this.showMap(run.id));
      link('Home', () => this.showHome());
    } else if (kind === 'challenge') {
      const c = this.challenge;
      if (c) btn(r1, `Watch ${c.name}'s ghost`, 'primary', () => this.watchGhost(c));
      btn(r1, 'Try again', 'secondary', () => this.playKind('challenge', run.id));
      if (rec.holed) btn(r2, 'Watch replay', 'secondary', () => this.watchReplay());
      link('Home', () => this.showHome());
    } else if (kind === 'practice') {
      btn(r1, "Back to today", 'primary', () => this.showHome());
      if (rec.holed) btn(r1, 'Watch replay', 'secondary', () => this.watchReplay());
    } else {
      btn(r1, 'Share result', 'primary', () => this.shareResult());
      if (rec.holed && kind !== 'oneshot') btn(r1, 'Share clip', 'secondary', () => this.shareClip());
      const nk = this.nextDaily();
      if (nk) btn(r2, `Next: ${MODE_NAME[nk]} →`, 'secondary next', () => this.playKind(nk, this.today));
      else btn(r2, 'Play Adventure →', 'secondary next', () => this.playKind('adventure', Store.advCurrent(Daily.adventureCount())));
      if (rec.holed) btn(r2, 'Replay', 'secondary', () => this.watchReplay());
      if (kind === 'daily' && L.shared && Bridge.isNative) link('Leaderboard', () => Bridge.gcShow());
      if (kind === 'daily') {
        if (L.starter > 1) link(`Replay starter level ${L.starter - 1}`, () => this.playKind('practice', L.starter - 1));
        else if (L.starter === 1) link('Practice this level', () => this.playKind('practice', 1));
        else link("Practice yesterday's level", () => this.playKind('practice', Daily.sharedIndex(this.today - 1)));
      }
      link('Stats', () => this.showStats());
      link('Home', () => this.showHome());
    }
    this.renderFriends();
    this.updateCountdown();
    UI.show('result');
  }

  renderFriends() {
    const box = $('res-friends');
    box.innerHTML = '';
    if (this.run.kind !== 'daily') return;
    const fr = this.friendsToday();
    const rows = fr.map(f => ({ ...f, me: false }));
    if (this.rec.done) rows.push({ name: this.st.profile.name || 'You', score: this.rec.holed ? this.rec.score : CONFIG.MAX_SHOTS + 1, me: true });
    rows.sort((a, b) => a.score - b.score);
    if (!fr.length) {
      const d = document.createElement('div');
      d.className = 'invite';
      d.textContent = 'Share your result: friends who open your link get your level and can race your ghost.';
      box.appendChild(d);
      return;
    }
    const h = document.createElement('h3'); h.textContent = 'Friends today'; h.style.margin = '4px 0 0'; h.style.textAlign = 'center';
    box.appendChild(h);
    rows.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'friend' + (r.me ? ' me' : '');
      const rk = document.createElement('b'); rk.textContent = i + 1; rk.style.width = '16px';
      el.appendChild(rk);
      el.appendChild(UI.avatar(r.name));
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.me ? 'You' : r.name;
      el.appendChild(nm);
      const sc = document.createElement('span'); sc.className = 'sc';
      sc.textContent = r.score > CONFIG.MAX_SHOTS ? 'X' : `${r.score} shot${r.score > 1 ? 's' : ''}`;
      el.appendChild(sc);
      if (!r.me) {
        const b = document.createElement('button'); b.textContent = '▶ Ghost';
        b.onclick = () => this.watchGhost(r);
        el.appendChild(b);
      }
      box.appendChild(el);
    });
  }

  skinCanvas(id, size) {
    const c = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    this.r.paintSphere(g, c.width / 2 - 1, 0.6, id);
    return c;
  }

  // ------------------------------------------------------------ sharing
  async ensureName() {
    if (this.st.profile.name) return true;
    return new Promise((res) => {
      UI.openSheet('nameprompt');
      const inp = $('name-input');
      inp.value = '';
      setTimeout(() => inp.focus(), 300);
      $('name-save').onclick = () => {
        const v = inp.value.trim().slice(0, 14);
        if (!v) { inp.focus(); return; }
        this.st.profile.name = v; Store.save();
        UI.hide('nameprompt');
        res(true);
      };
    });
  }

  shareLink() {
    const run = this.run, rec = this.rec;
    if (run.kind === 'daily') {
      const win = rec.shots.find(s => s.o === 'hit');
      const payload = rec.holed && win ? Share.encodeChallenge({ day: run.id, name: this.st.profile.name, score: rec.score, shot: win, idx: this.level.idx }) : null;
      return Share.challengeLink(run.id, payload);
    }
    return CONFIG.SHARE_URL;
  }

  shareText() {
    const run = this.run, rec = this.rec;
    if (run.kind === 'daily') return Share.resultText({ day: run.id, rec, par: this.level.par, streak: Store.currentStreak(this.today), starter: this.level.starter });
    return Share.modeText({ kind: run.kind, id: run.id, rec, level: this.level, trick: run.trick ? trickText(run.trick) : '' });
  }

  async shareResult() {
    if (this.run.kind === 'daily') await this.ensureName();
    const r = await Bridge.share({ text: this.shareText(), url: this.shareLink() });
    if (r === 'copied') UI.toast('Result copied — paste it in your group chat');
  }

  async shareClip() {
    await this.ensureName();
    const w = this.lastWin || this.reconstructWin();
    if (!w) return;
    UI.hide('result');
    UI.toast('Cutting your clip…');
    const blob = await this.recordClip(w);
    const text = this.shareText();
    this.showResult();
    if (!blob) { UI.toast('Clips are not supported here — sharing your result instead'); return this.shareResult(); }
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'png';
    const r = await Bridge.share({ text, url: this.shareLink(), file: blob, fileName: `${CONFIG.APP_NAME.toLowerCase()}-${this.run.kind}-${this.run.id}.${ext}`, mime: blob.type });
    if (r === 'downloaded') UI.toast('Clip saved');
  }

  // spoiler-safe clip: only the last ~2.6 s, camera locked on the cup
  recordClip(w) {
    return new Promise((resolve) => {
      const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
      const mime = window.MediaRecorder && this.cv.captureStream ? types.find(t => MediaRecorder.isTypeSupported(t)) : null;
      const entry = P.cupEntryTick(this.C, w.res);
      const from = Math.max(0, entry - 0.75 * P.HZ);
      this.cam = { z: 1.5, fx: this.C.cup.x, fy: (this.C.cup.rim + this.C.cup.bot) / 2, shx: 0, shy: 0 };
      this.fx.clear();
      this.flash = 0;
      this.cupGlow = 0;
      this.clipLabel = true;
      if (!mime) {
        this.startFlight(w.res, w.shot, { clip: true, from, done: () => { this.clipLabel = false; this.cv.toBlob((b) => resolve(b), 'image/png'); } });
        return;
      }
      const stream = this.cv.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => { this.clipLabel = false; resolve(new Blob(chunks, { type: mime.split(';')[0] })); };
      rec.start();
      this.startFlight(w.res, w.shot, { clip: true, from, done: () => setTimeout(() => { try { rec.stop(); } catch (e) { resolve(null); } }, 700) });
    });
  }

  // ------------------------------------------------------------ UI wiring
  bindUI() {
    const tap = (id, fn) => { $(id).addEventListener('click', (e) => { Sound.unlock(); Sound.play('blip', { gain: 0.35 }); fn(e); }); };
    tap('card-daily', () => this.playKind('daily', this.today));
    tap('card-oneshot', () => this.playKind('oneshot', this.today));
    tap('card-trick', () => this.playKind('trick', this.today));
    tap('card-adv', () => this.showMap());
    tap('map-back', () => this.showHome());
    tap('btn-how', () => { UI.hide('home'); this.showOnboarding(() => this.showHome()); });
    tap('btn-stats', () => this.showStats());
    tap('btn-skins', () => this.showSkins());
    tap('btn-settings', () => this.showSettings());
    tap('btn-menu', () => {
      if (this.mode !== 'aim' && this.mode !== 'idle') return;
      if (this.run.kind === 'adventure') this.showMap(this.run.id); else this.showHome();
    });
    tap('btn-restart', () => this.restartLevel());
    tap('btn-ghosts', () => {
      if (this.mode !== 'aim') return;
      if (this.run.kind === 'challenge') { if (this.challenge) this.watchGhost(this.challenge); return; }
      const fr = this.friendsToday();
      if (!fr.length) return;
      fr.sort((a, b) => a.score - b.score);
      this.watchGhost(fr[0]);
    });
    tap('set-how', () => { UI.hide('settings'); UI.hide('home'); this.showOnboarding(() => this.showHome()); });
    setInterval(() => this.updateCountdown(), 1000);
  }

  showStats() {
    const s = this.st.stats, x = this.st.extra;
    const tiles = [
      [s.played, 'Daily played'], [s.played ? Math.round((s.holed / s.played) * 100) + '%' : '–', 'Daily holed'],
      [Store.currentStreak(this.today), 'Streak'], [s.maxStreak, 'Best streak'], [s.hio, 'Holes in one'],
      [this.avgShots(), 'Avg shots'],
      [x.onePlayed ? `${x.oneHits}/${x.onePlayed}` : '–', 'One Shots holed'], [x.trickDone, 'Tricks done'],
      [`${Store.totalStars()}`, 'Adventure ★'],
    ];
    $('stat-tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'X'];
    const max = Math.max(1, ...keys.map(k => s.dist[k] || 0));
    const dr = Store.dayRecord(this.today);
    const mine = dr.done ? (dr.holed ? dr.score : 'X') : null;
    $('stat-bars').innerHTML = keys.map(k => {
      const v = s.dist[k] || 0;
      return `<div class="bar"><span>${k}</span><i class="${String(k) === String(mine) ? 'me' : ''}" style="width:${8 + 82 * v / max}%">${v}</i></div>`;
    }).join('');
    UI.openSheet('stats');
  }

  avgShots() {
    const d = this.st.stats.dist;
    let n = 0, t = 0;
    for (let k = 1; k <= 9; k++) { n += d[k] || 0; t += (d[k] || 0) * k; }
    return n ? (t / n).toFixed(1) : '–';
  }

  showSkins() {
    const grid = $('skingrid');
    grid.innerHTML = '';
    const unlocked = this.unlockedSkins();
    for (const sk of SKINS) {
      const el = document.createElement('div');
      const locked = !unlocked.includes(sk.id);
      el.className = 'skin' + (locked ? ' locked' : '') + (this.st.skin === sk.id ? ' sel' : '');
      el.appendChild(this.skinCanvas(sk.id, 64));
      const b = document.createElement('b'); b.textContent = sk.name; el.appendChild(b);
      const need = sk.streak ? `${sk.streak}-day streak` : sk.stars ? `${sk.stars} Adventure ★` : '';
      const sp = document.createElement('span'); sp.textContent = locked ? need : (this.st.skin === sk.id ? 'Selected' : 'Tap to use'); el.appendChild(sp);
      el.onclick = () => {
        if (locked) { UI.toast(sk.streak ? `Hole the Daily Level ${sk.streak} days in a row` : `Collect ${sk.stars} stars in Adventure`); return; }
        this.st.skin = sk.id; Store.save(); Sound.play('blip', { gain: 0.5, rate: 1.3 }); this.showSkins();
      };
      grid.appendChild(el);
    }
    UI.openSheet('skins');
  }

  showSettings() {
    const s = this.st.settings;
    const bind = (id, key, fn) => { const el = $(id); el.checked = s[key]; el.onchange = () => { s[key] = el.checked; Store.save(); fn && fn(el.checked); }; };
    bind('set-sound', 'sound', (v) => Sound.setSfx(v));
    bind('set-music', 'music', (v) => Sound.setMusic(v));
    bind('set-haptics', 'haptics');
    bind('set-motion', 'reduceMotion');
    const nm = $('set-name');
    nm.value = this.st.profile.name || '';
    nm.onchange = () => { this.st.profile.name = nm.value.trim().slice(0, 14); Store.save(); };
    $('set-version').textContent = `${CONFIG.APP_NAME} ${VERSION} · ${Bridge.isNative ? 'iOS' : 'web'}`;
    UI.openSheet('settings');
  }

  // ------------------------------------------------------------ main loop
  frame(now) {
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    let rate = 1;
    if (this.mode === 'flight' && this.flight) {
      this.updateFlight(dt);
      rate = this.flight ? this.flight.rate || 1 : 1;
    } else this.tick += dt * P.HZ;
    const k = Math.exp(-dt * 10 * rate);
    this.pulses = this.pulses.map(v => v * k);
    this.spinFlash = this.spinFlash.map(v => v * k);
    this.portalFlash *= Math.exp(-dt * 5 * rate);
    this.cupGlow *= Math.exp(-dt * 1.5);
    this.flash *= Math.exp(-dt * 9);
    this.fx.update(dt * rate);
    if (this.mode === 'aim' && this.ballK < 1) this.ballK = Math.min(1, this.ballK + dt * 4);
    const ck = 1 - Math.exp(-dt * 5);
    this.cam.z += (this.camT.z - this.cam.z) * ck;
    this.cam.fx += (this.camT.fx - this.cam.fx) * ck;
    this.cam.fy += (this.camT.fy - this.cam.fy) * ck;
    this.shake *= Math.exp(-dt * 14);
    const sh = this.st.settings.reduceMotion ? 0 : this.shake;
    this.cam.shx = sh * Math.sin(now * 0.097);
    this.cam.shy = sh * Math.cos(now * 0.071);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  draw() {
    const r = this.r, T = this.theme;
    r.begin(this.cam);
    r.portals(this.tick / P.HZ, this.portalFlash);
    r.bumpers(this.pulses);
    r.spinners(this.tick, this.spinFlash);
    const f = this.flight;
    const skin = this.st.skin;
    if (f) {
      const b = this.ball;
      const ghost = f.ghost;
      let k = 1;
      for (const e of f.res.events) {
        if (e.kind !== 'portal_in') continue;
        const d = e.tick - f.p;
        if (d >= 0 && d < 42) k = Math.min(k, d / 42);
        if (-d >= 0 && -d < 60) k = Math.min(k, -d / 60);
      }
      r.trail(this.trail, ghost ? rgba(this.ghostColor, 1).replace(/[\d.]+\)$/, '') : T.trail, ghost ? 4 : 6, ghost ? 1 : 1.15);
      let squash = null;
      for (const e of f.res.events) {
        if (e.kind === 'portal_in' || e.kind === 'portal_out') continue;
        const age = (f.p - e.tick) / P.HZ;
        if (age >= 0 && age < 0.14) squash = { ax: e.nx, ay: e.ny, s: 1 - 0.3 * clamp(e.v / 900, 0.2, 1) * Math.exp(-age / 0.035) };
      }
      if (!squash && b) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 200) squash = { ax: b.vx / sp, ay: b.vy / sp, s: 1 + Math.min(sp / 5000, 0.16) };
      }
      if (b && k > 0.02) r.drawBall(b.x, b.y, this.phi, { skin, k, squash, tint: ghost ? this.ghostColor : null, alpha: ghost ? 0.78 : 1, noShadow: !!ghost });
    } else {
      const [sx, sy] = this.C.start;
      const showBall = !(this.mode === 'done' && this.rec.holed);
      if (showBall) r.drawBall(sx, sy, 0, { skin, k: this.mode === 'aim' || this.mode === 'drag' ? easeBack(this.ballK) : 1 });
      else if (this.lastWin) {
        const p = this.lastWin.res.path;
        const n = p.length - 4;
        r.drawBall(p[n], p[n + 1], this.phi, { skin });
      }
    }
    r.cupGlass(this.cupGlow);
    this.fx.draw(r.ctx, T.dark);
    if (this.mode === 'drag' && this.drag) {
      const a = this.aimVec();
      const [sx, sy] = this.C.start;
      const pull = Math.min(a.len, 140) * 0.42;
      r.aim({ bx: sx, by: sy, vx: a.vx, vy: a.vy, k: a.k, hx: sx - a.ux * pull, hy: sy - a.uy * pull });
      const rect = this.cv.getBoundingClientRect();
      const [wx, wy] = this.r.toWorld(this.drag.x - rect.left, this.drag.y - rect.top);
      r.touchRing(wx, wy, true, 0.9);
    }
    const g = r.ctx;
    if (this.flash > 0.01) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = `rgba(220,255,240,${(this.flash * 0.5).toFixed(3)})`;
      g.fillRect(0, 0, this.cv.width, this.cv.height);
    }
    if (this.clipLabel) this.drawClipLabel();
  }

  drawClipLabel() {
    const g = this.r.ctx, W = this.cv.width, H = this.cv.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const s = W / 390;
    const grd = g.createLinearGradient(0, H - 190 * s, 0, H);
    grd.addColorStop(0, 'rgba(20,10,60,0)'); grd.addColorStop(1, 'rgba(20,10,60,0.75)');
    g.fillStyle = grd; g.fillRect(0, H - 190 * s, W, 190 * s);
    const rec = this.rec, run = this.run;
    const gw = rec.holed ? GOLF(rec.score, this.level.par).word : '';
    g.textAlign = 'left';
    g.fillStyle = '#46ecbe';
    g.font = `900 ${34 * s}px InterDisplay, Poppins, sans-serif`;
    g.fillText(gw, 22 * s, H - 92 * s);
    g.fillStyle = '#ffffff';
    g.font = `700 ${17 * s}px Poppins, sans-serif`;
    const label = run.kind === 'adventure' ? `${CONFIG.APP_NAME} level ${this.level.world}-${this.level.index}`
      : run.kind === 'daily' && this.level.starter ? `${CONFIG.APP_NAME} starter ${this.level.starter}/7`
      : `${CONFIG.APP_NAME} ${run.kind === 'trick' ? 'Trick Shot ' : ''}#${run.id}`;
    g.fillText(`${label} · ${rec.score} shot${rec.score > 1 ? 's' : ''} · can you beat it?`, 22 * s, H - 58 * s);
    g.font = `500 ${13 * s}px Poppins, sans-serif`;
    g.globalAlpha = 0.85;
    g.fillText(CONFIG.SHARE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), 22 * s, H - 34 * s);
    g.globalAlpha = 1;
  }
}

function easeBack(k) {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const s = 1.9;
  k -= 1;
  return k * k * ((s + 1) * k + s) + 1;
}
