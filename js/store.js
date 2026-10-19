// Local persistence (localStorage, wrapped so a blocked storage never breaks the game).
const KEY = 'bouncle.v1';

const SCHEMA = 2;   // 2 = calendar days count from launch (EPOCH) + personal starter week

const DEFAULT = () => ({
  schema: SCHEMA,
  profile: { name: '', onboarded: false, created: Date.now(), starter: {} },   // starter: { calendarDay: starterNumber }
  settings: { sound: true, music: true, haptics: true, reduceMotion: false },
  stats: { played: 0, holed: 0, streak: 0, maxStreak: 0, lastHoledDay: 0, dist: {}, hio: 0 },
  days: {},        // day -> { shots: [{qx,qy,t0,o}], done, score, holed }   (Daily Level)
  oneshot: {},     // day -> { shots, done, holed }
  trick: {},       // day -> { shots, done, holed, score }
  adv: {},         // level -> { done, best, stars }
  extra: { onePlayed: 0, oneHits: 0, trickPlayed: 0, trickDone: 0 },
  friends: {},     // day -> [{ name, score, shot:{qx,qy,t0}, at }]
  skin: 'classic',
});

let state = null;

export function load() {
  if (state) return state;
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
  // iOS app: state is mirrored to native storage and injected at launch (survives WebView data resets)
  if (!raw && typeof window !== 'undefined' && window.__nativeState) raw = window.__nativeState;
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
  state = parsed ? { ...DEFAULT(), ...parsed } : DEFAULT();
  for (const k of Object.keys(DEFAULT())) if (state[k] === undefined) state[k] = DEFAULT()[k];
  if (parsed && parsed.schema !== SCHEMA) migrate();
  if (!state.profile.starter) state.profile.starter = {};
  return state;
}

// Saves from builds before launch used a different day numbering: keep name, settings,
// Adventure progress and ball, but start the daily challenges (and their stats) fresh.
function migrate() {
  const d = DEFAULT();
  for (const k of ['stats', 'days', 'oneshot', 'trick', 'extra', 'friends']) state[k] = d[k];
  state.profile = { ...d.profile, ...state.profile, starter: {} };
  state.schema = SCHEMA;
  save();
}

export function save() {
  const json = JSON.stringify(state);
  try { localStorage.setItem(KEY, json); } catch (e) { /* storage unavailable */ }
  try {
    const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
    if (h) h.postMessage({ type: 'save', data: json });
  } catch (e) { /* not in the app */ }
}

export function dayRecord(day) {
  load();
  if (!state.days[day]) state.days[day] = { shots: [], done: false, score: 0, holed: false };
  return state.days[day];
}

export function finishDay(day, holed, score) {
  const rec = dayRecord(day);
  if (rec.done) return rec;
  rec.done = true; rec.holed = holed; rec.score = score;
  const st = state.stats;
  st.played++;
  if (holed) {
    st.holed++;
    st.streak = st.lastHoledDay === day - 1 ? st.streak + 1 : 1;
    st.lastHoledDay = day;
    st.maxStreak = Math.max(st.maxStreak, st.streak);
    st.dist[score] = (st.dist[score] || 0) + 1;
    if (score === 1) st.hio++;
  } else {
    st.streak = 0;
    st.dist.X = (st.dist.X || 0) + 1;
  }
  save();
  return rec;
}

// streak shown today: still alive if you holed yesterday
export function currentStreak(today) {
  const st = load().stats;
  if (st.lastHoledDay === today || st.lastHoledDay === today - 1) return st.streak;
  return 0;
}

export function addFriend(day, f) {
  load();
  const list = state.friends[day] || (state.friends[day] = []);
  if (!list.some(x => x.name === f.name && x.shot.qx === f.shot.qx && x.shot.qy === f.shot.qy && x.shot.t0 === f.shot.t0)) {
    list.push({ ...f, at: Date.now() });
    save();
    return true;
  }
  return false;
}

export function pruneOld(today) {
  load();
  for (const k of Object.keys(state.friends)) if (+k < today - 7) delete state.friends[k];
  save();
}

// ---------------------------------------------------------------- other modes
export function modeRecord(kind, day) {
  load();
  const box = state[kind];
  if (!box[day]) box[day] = { shots: [], done: false, score: 0, holed: false };
  return box[day];
}

export function finishOneShot(day, holed) {
  const rec = modeRecord('oneshot', day);
  if (rec.done) return rec;
  rec.done = true; rec.holed = holed; rec.score = 1;
  state.extra.onePlayed++;
  if (holed) state.extra.oneHits++;
  save();
  return rec;
}

export function finishTrick(day, holed, score) {
  const rec = modeRecord('trick', day);
  if (rec.done) return rec;
  rec.done = true; rec.holed = holed; rec.score = score;
  state.extra.trickPlayed++;
  if (holed) state.extra.trickDone++;
  save();
  return rec;
}

// returns { firstClear, improved, stars }
export function finishAdventure(n, shots, stars) {
  load();
  const prev = state.adv[n] || { done: false, best: 0, stars: 0 };
  const firstClear = !prev.done;
  const improved = !firstClear && stars > prev.stars;
  state.adv[n] = { done: true, best: prev.best ? Math.min(prev.best, shots) : shots, stars: Math.max(prev.stars, stars) };
  save();
  return { firstClear, improved, stars: state.adv[n].stars };
}

export function totalStars() {
  load();
  return Object.values(state.adv).reduce((a, r) => a + (r.stars || 0), 0);
}

export function advUnlocked(n) {
  load();
  return n === 1 || !!(state.adv[n - 1] && state.adv[n - 1].done);
}

// first level not yet cleared (where "Continue" takes you)
export function advCurrent(total) {
  load();
  for (let n = 1; n <= total; n++) if (!(state.adv[n] && state.adv[n].done)) return n;
  return total;
}

// ---------------------------------------------------------------- starter week
export function starters() {
  load();
  return state.profile.starter || (state.profile.starter = {});
}

// called on the first shot of a starter level: that calendar day now owns starter level n
export function claimStarter(day, n) {
  const m = starters();
  if (m[day]) return false;
  m[day] = n;
  save();
  return true;
}
