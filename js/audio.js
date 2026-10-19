// Sound effects + music (Web Audio). Unlocked on the first tap (browser autoplay rules).
const NAMES = ['tok', 'tok_lo', 'boing', 'clank', 'plunk', 'thwack', 'warp_in', 'warp_out', 'thwip', 'stretch',
  'whoosh', 'ding', 'womp', 'fanfare', 'blip', 'unlock', 'sparkle', 'music'];

export const Sound = {
  ctx: null, buf: {}, sfxOn: true, musicOn: true, music: null, musicGain: null, master: null, ready: false,

  async init(base = 'assets/audio/') {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    const probe = document.createElement('audio');
    const ext = probe.canPlayType && probe.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? '.m4a' : '.mp3';
    await Promise.all(NAMES.map(async (n) => {
      try {
        const r = await fetch(base + n + ext);
        const ab = await r.arrayBuffer();
        this.buf[n] = await this.decode(ab);
      } catch (e) { /* missing sound is fine */ }
    }));
    this.ready = true;
    if (this.musicOn) this.startMusic();
  },

  decode(ab) {
    return new Promise((res) => {
      let done = false;
      const ok = (b) => { if (!done) { done = true; res(b); } };
      const fail = () => { if (!done) { done = true; res(null); } };
      try {
        const p = this.ctx.decodeAudioData(ab, ok, fail);
        if (p && p.then) p.then(ok, fail);
      } catch (e) { fail(); }
    });
  },

  unlock() {
    if (!this.ctx) this.init();
    else if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  play(name, o = {}) {
    if (!this.sfxOn || !this.ctx || !this.buf[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf[name];
    src.playbackRate.value = o.rate ?? 1;
    const g = this.ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let node = g;
    if (this.ctx.createStereoPanner && o.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p); node = p;
    }
    src.connect(g);
    node.connect(this.master);
    src.start(this.ctx.currentTime + (o.delay || 0));
    return src;
  },

  startMusic() {
    if (!this.musicOn || !this.ctx || !this.buf.music || this.music) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf.music;
    src.loop = true;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.gain.linearRampToValueAtTime(0.32, this.ctx.currentTime + 2);
    src.connect(this.musicGain);
    this.musicGain.connect(this.master);
    src.start();
    this.music = src;
  },

  stopMusic() {
    if (!this.music) return;
    try { this.music.stop(); } catch (e) { /* already stopped */ }
    this.music = null;
  },

  duck(amount = 0.25, time = 0.2) {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.linearRampToValueAtTime(0.32 * amount, t + time);
  },
  unduck(time = 0.5) {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.linearRampToValueAtTime(0.32, t + time);
  },

  setSfx(on) { this.sfxOn = on; },
  setMusic(on) { this.musicOn = on; if (on) this.startMusic(); else this.stopMusic(); },
};

// pause audio when the app goes to the background
document.addEventListener('visibilitychange', () => {
  if (!Sound.ctx) return;
  if (document.hidden) Sound.ctx.suspend(); else Sound.ctx.resume();
});
