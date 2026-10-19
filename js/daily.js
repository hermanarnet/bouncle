// Day numbering + level lookup. New level at the player's local midnight.
import { CONFIG } from './config.js';

const DAY_MS = 86400000;

function localDayIndex(date) {
  // days since 1970 using the LOCAL calendar date (DST-safe)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export function epochIndex() {
  const [y, m, d] = CONFIG.EPOCH.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

// Calendar day: 1 on launch day (CONFIG.EPOCH), 0 or below before launch (TestFlight preview).
export function dayNumber(now = new Date()) {
  return localDayIndex(now) - epochIndex() + 1;
}

export function dayLabel(day) { return day >= 1 ? `Day ${day}` : 'Preview'; }

export function msToNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next - now;
}

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

export const WEEKDAY_LABEL = ['Easy', 'Easy+', 'Medium', 'Medium+', 'Tricky', 'Hard', 'Expert'];

export const PACKS = { daily: null, oneshot: null, trick: null, adventure: null };

export async function loadLevels(base = 'levels/') {
  await Promise.all(Object.keys(PACKS).map(async (k) => {
    if (PACKS[k]) return;
    const res = await fetch(`${base}${k}.json`, { cache: 'no-cache' });
    PACKS[k] = (await res.json()).levels;
  }));
  return PACKS;
}

function wrap(list, i) {
  const n = list.length;
  return list[((i - 1) % n + n) % n];
}

// One Shot / Trick Shot: one level per calendar day, the same for everyone from day one
export function levelForDay(day, pack = 'daily') {
  const L = wrap(PACKS[pack], day);
  const wd = (((day - 1) % 7) + 7) % 7;
  return { ...L, playDay: day, difficulty: WEEKDAY_LABEL[wd] };
}

// ---------------------------------------------------------------------------
// Daily Level = personal starter week, then the shared daily.
//  * The first STARTER_DAYS days a player plays get daily.json levels 1..7 (easy -> hard ramp).
//    A starter level is only "used up" once you take a shot that day (Store.claimStarter).
//  * After that, everyone plays the same shared level per calendar day: levels 8..N,
//    aligned so Monday is the easiest and Sunday the hardest, whatever weekday launch is.
// ---------------------------------------------------------------------------
export const STARTER_DAYS = 7;

function weekdayOfIndex(D) { return (((D + 3) % 7) + 7) % 7; }   // Monday = 0 (1970-01-01 was a Thursday)

export function dailyByIndex(idx) {
  const L = PACKS.daily[idx - 1];
  const starter = idx <= STARTER_DAYS ? idx : 0;
  return { ...L, idx, starter, shared: !starter, difficulty: WEEKDAY_LABEL[(idx - 1) % 7] };
}

export function sharedIndex(day) {
  const n = PACKS.daily.length;
  const span = Math.max(7, Math.floor((n - STARTER_DAYS) / 7) * 7);
  const off = weekdayOfIndex(epochIndex());
  return STARTER_DAYS + 1 + ((((day - 1 + off) % span) + span) % span);
}

export function sharedLevel(day) { return { ...dailyByIndex(sharedIndex(day)), shared: true, playDay: day }; }

// starters: { [calendarDay]: starterNumber } for days on which a starter level was played
export function dailyLevel(day, starters = {}) {
  if (starters[day]) return { ...dailyByIndex(starters[day]), playDay: day };
  const used = Object.keys(starters).length;
  if (used < STARTER_DAYS) return { ...dailyByIndex(used + 1), playDay: day, tentative: true };
  return sharedLevel(day);
}

export const WORLDS = [
  { name: 'Toybox', theme: 'toybox', intro: 'Rails & ramps' },
  { name: 'Candy Clay', theme: 'clay', intro: 'Bumpers' },
  { name: 'Frost', theme: 'frost', intro: 'Spinners' },
  { name: 'Neon Night', theme: 'neon', intro: 'Portals' },
];

export function adventureCount() { return PACKS.adventure.length; }

export function adventureLevel(n) {
  const L = PACKS.adventure[n - 1];
  const w = Math.floor((n - 1) / 25);
  return { ...L, world: w + 1, index: ((n - 1) % 25) + 1, worldName: (WORLDS[w] || WORLDS[WORLDS.length - 1]).name };
}
