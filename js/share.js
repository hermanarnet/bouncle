// Share text, challenge links (your winning shot travels inside the link — no server needed).
import { CONFIG, GOLF } from './config.js';

const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

// v2 adds the Daily Level index (idx), so a friend on a different level can still play yours
export function encodeChallenge({ day, name, score, shot, idx }) {
  return b64u(['2', day, (name || 'A friend').replace(/\|/g, '').slice(0, 16), score, shot.qx, shot.qy, shot.t0, idx].join('|'));
}

export function decodeChallenge(str) {
  try {
    const p = unb64u(str).split('|');
    if ((p[0] !== '1' && p[0] !== '2') || p.length < 7) return null;
    const c = { day: +p[1], name: p[2].slice(0, 16), score: +p[3], shot: { qx: +p[4], qy: +p[5], t0: +p[6] }, idx: p[0] === '2' ? +p[7] : 0 };
    if (![c.day, c.score, c.shot.qx, c.shot.qy, c.shot.t0, c.idx].every(Number.isFinite)) return null;
    if (c.idx < 0 || c.idx > 9999) return null;
    if (Math.abs(c.shot.qx) > 700 || Math.abs(c.shot.qy) > 700 || c.score < 1 || c.score > 99) return null;
    return c;
  } catch (e) {
    return null;
  }
}

export function parseLocation(loc = window.location) {
  const h = (loc.hash || '').replace(/^#/, '');
  const m = /(?:^|&)c=([^&]+)/.exec(h);
  return m ? decodeChallenge(m[1]) : null;
}

export function challengeLink(day, payload) {
  return payload ? `${CONFIG.SHARE_URL}?d=${day}#c=${payload}` : `${CONFIG.SHARE_URL}?d=${day}`;
}

const NICE = { hio: 'Hole in one!', eagle: 'Eagle', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', in: 'Holed' };

export function shotIcons(shots) {
  return shots.map(s => (s.o === 'hit' ? '🟢' : s.rim ? '🟡' : '⚪')).join('');
}

export function resultText({ day, rec, par, streak, starter = 0 }) {
  const max = CONFIG.MAX_SHOTS;
  const tag = starter ? `${CONFIG.APP_NAME} starter ${starter}/7` : `${CONFIG.APP_NAME} #${day}`;
  const head = rec.holed
    ? `${tag} ⛳ ${rec.score}/${max} · ${NICE[GOLF(rec.score, par).key]}`
    : `${tag} ⛳ X/${max}`;
  const lines = [head, shotIcons(rec.shots)];
  if (streak > 1) lines.push(`🔥 ${streak}-day streak`);
  return lines.join('\n');
}

// One Shot / Trick Shot / Adventure results
export function modeText({ kind, id, rec, level, trick }) {
  const A = CONFIG.APP_NAME;
  if (kind === 'oneshot') {
    return [`${A} One Shot #${id} 🎯 ${rec.holed ? 'Holed it' : 'Missed'}`, rec.holed ? '🟢' : (rec.shots[0] && rec.shots[0].rim ? '🟡' : '⚪')].join('\n');
  }
  if (kind === 'trick') {
    const head = rec.holed ? `${A} Trick Shot #${id} 🪄 ${rec.score}/${CONFIG.MAX_SHOTS}` : `${A} Trick Shot #${id} 🪄 X/${CONFIG.MAX_SHOTS}`;
    return [head, trick ? `“${trick}”` : '', shotIcons(rec.shots)].filter(Boolean).join('\n');
  }
  if (kind === 'adventure') {
    const stars = '⭐'.repeat(rec.stars || 0) + '☆'.repeat(3 - (rec.stars || 0));
    const where = level && level.world ? `${level.world}-${level.index}` : `#${id}`;
    return `${A} Adventure ${where} ${stars} in ${rec.score} shot${rec.score === 1 ? '' : 's'}`;
  }
  return A;
}
