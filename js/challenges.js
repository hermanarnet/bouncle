// Trick Shot conditions — shared by the game and the level generator.
// A trick counts only if the condition is met before the ball drops into the cup.

export const TRICKS = {
  bumpers: { text: (n) => `Hit ${n} bumper${n === 1 ? '' : 's'}, then the cup`, short: (n) => `Bumpers`, need: (n) => n },
  rails: { text: (n) => `Touch ${n} different rails`, short: () => 'Rails', need: (n) => n },
  wall: { text: () => 'Bank it off a wall', short: () => 'Wall bank', need: () => 1 },
  portal: { text: () => 'Go through the portal', short: () => 'Portal', need: () => 1 },
  spinner: { text: () => 'Bounce off the spinner', short: () => 'Spinner', need: () => 1 },
  norail: { text: () => "Don't touch a single rail", short: () => 'No rails', need: () => 0 },
};

export function trickText(t) { return TRICKS[t.type].text(t.n || 1); }

// progress of a trick given the events that happened so far (up to tick `upTo`)
export function trickProgress(t, events, upTo = Infinity) {
  let count = 0;
  const rails = new Set();
  let railTouched = false;
  for (const e of events) {
    if (e.tick > upTo) break;
    if (t.type === 'bumpers' && e.kind === 'bumper') count++;
    if (t.type === 'rails' && e.kind === 'rail') rails.add(e.seg);
    if (t.type === 'wall' && e.kind === 'wall') count = 1;
    if (t.type === 'portal' && e.kind === 'portal_in') count = 1;
    if (t.type === 'spinner' && e.kind === 'spinner') count = 1;
    if (e.kind === 'rail') railTouched = true;
  }
  if (t.type === 'rails') count = rails.size;
  const need = TRICKS[t.type].need(t.n || 1);
  if (t.type === 'norail') return { count: railTouched ? 1 : 0, need: 0, ok: !railTouched, broken: railTouched };
  return { count: Math.min(count, need), need, ok: count >= need, broken: false };
}

// did a finished shot satisfy the trick? (only events before the cup entry count)
export function trickMet(t, res, entryTick) {
  if (res.outcome !== 'hit') return false;
  const upTo = entryTick > 0 ? entryTick : res.outTick;
  return trickProgress(t, res.events, upTo).ok;
}

// Adventure stars from shots vs par
export function starsFor(shots, par) {
  if (shots <= par) return 3;
  if (shots <= par + 2) return 2;
  return 1;
}
