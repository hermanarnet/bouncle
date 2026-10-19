// Small DOM helpers for the overlay UI.
export const $ = (id) => document.getElementById(id);

export function show(id) { $(id).hidden = false; }
export function hide(id) { $(id).hidden = true; }
export function isShown(id) { return !$(id).hidden; }

let toastTimer = 0;
export function toast(msg) {
  const t = $('toast');
  t.hidden = true;
  void t.offsetWidth;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

export function stamp(key, mode = 'show') {
  const s = $('stamp');
  s.className = 'stamp';
  s.hidden = true;
  s.src = `assets/img/stamp_${key}.png`;
  void s.offsetWidth;
  s.hidden = false;
  s.classList.add(mode);
}
export function clearStamp() { const s = $('stamp'); s.hidden = true; s.className = 'stamp'; }

export function setDots(el, shots, max, current = -1) {
  el.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const d = document.createElement('i');
    const s = shots[i];
    if (s) d.className = s.o === 'hit' ? 'hit' : s.rim ? 'rim' : 'miss';
    if (i === current) d.classList.add('now');
    el.appendChild(d);
  }
}

const AV = ['#ff6ec4', '#50a8ff', '#6fd26b', '#ff9a3c', '#a77cff', '#ff6f6f', '#20c8b0'];
export function colorFor(name) {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}
export function avatar(name) {
  const a = document.createElement('span');
  a.className = 'avatar';
  a.style.background = colorFor(name);
  a.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return a;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function openSheet(id) {
  show(id);
  const el = $(id);
  el.onclick = (e) => { if (e.target === el) hide(id); };
  el.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => hide(id); });
}
