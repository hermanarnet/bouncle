import { Game } from './game.js';

const game = new Game();
window.__bouncle = game; // handy for debugging / automated tests
game.init().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.innerHTML = '<p style="color:#fff;font:600 15px Poppins,sans-serif;text-align:center;padding:24px">Could not start the game. Please reload.</p>';
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
