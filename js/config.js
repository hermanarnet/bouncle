// ---------------------------------------------------------------------------
// Bouncle configuration — change these before launch.
// ---------------------------------------------------------------------------
export const CONFIG = {
  APP_NAME: 'Bouncle',
  TAGLINE: 'Daily trick shots',
  // Launch day = Day 1 of the shared Daily Level (any weekday; Mondays are always the easiest, Sundays the hardest).
  // Each new player first gets their own 7-day starter week, then joins the shared daily.
  // Before this date the game runs in "Preview" (TestFlight). Format YYYY-MM-DD, player's local time zone.
  EPOCH: '2026-10-23',
  // Public web address of the game (GitHub Pages or your own domain). Used in share links.
  SHARE_URL: 'https://hermanarnet.github.io/bouncle/',
  // Filled in once the app exists in App Store Connect (used for the "Get the app" banner).
  APP_STORE_ID: '',
  APP_STORE_URL: '',
  // Game Center recurring daily leaderboard id (create it in App Store Connect).
  LEADERBOARD_ID: 'bouncle.daily.shots',
  SUPPORT_EMAIL: 'herman.arnet@gmail.com',
  MAX_SHOTS: 9,
  ADVENTURE_WORLD_SIZE: 25,
};

// Ball skins: unlocked by daily streak (days in a row you hole the Daily Level) or by Adventure stars.
export const SKINS = [
  { id: 'classic', name: 'Classic' },
  { id: 'chrome', name: 'Chrome', streak: 3 },
  { id: 'candy', name: 'Candy', stars: 30 },
  { id: 'lava', name: 'Lava', streak: 7 },
  { id: 'galaxy', name: 'Galaxy', stars: 120 },
  { id: 'gold', name: 'Gold', streak: 30 },
];

export const GOLF = (score, par) => {
  if (score === 1) return { word: 'HOLE IN ONE!', key: 'hio' };
  const d = score - par;
  if (d <= -2) return { word: 'EAGLE!', key: 'eagle' };
  if (d === -1) return { word: 'BIRDIE!', key: 'birdie' };
  if (d === 0) return { word: 'PAR', key: 'par' };
  if (d === 1) return { word: 'BOGEY', key: 'bogey' };
  return { word: 'IN!', key: 'in' };
};
