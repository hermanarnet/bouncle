// Visual themes (one per weekday rotation). Colours tuned to match the soft-3D trailer look.
export const THEMES = {
  toybox: {
    name: 'Toybox', dark: false,
    tray: '#7461e2', trayHi: '#8b7af0', trayLo: '#5a47c8',
    wallTop: '#bcb4f6', wallBot: '#9184e8', pit: '#3a2c86', dimple: true,
    rail: '#fbfaff', pad: '#8a74ff', bumper: '#ff5c86', bumperBase: '#f7f3ff',
    spinner: '#ff9a3c', hub: '#f0f0fa', pa: '#b462ff', pb: '#22d4ff', cup: '#46ecbe',
    shadow: 'rgba(46,24,120,0.36)', trail: 'rgba(255,196,90,', ui: '#2a2162', accent: '#ffce2c',
  },
  clay: {
    name: 'Candy Clay', dark: false,
    tray: '#ff8592', trayHi: '#ff9ea8', trayLo: '#e8667a',
    wallTop: '#ffe0d0', wallBot: '#f9b9ad', pit: '#86394f', dimple: false,
    rail: '#fff7e8', pad: '#ff7a68', bumper: '#4fcfa6', bumperBase: '#fff8f0',
    spinner: '#7d8cff', hub: '#fffaf2', pa: '#ff74c6', pb: '#6cbcff', cup: '#7cc8ff',
    shadow: 'rgba(150,60,70,0.30)', trail: 'rgba(255,170,90,', ui: '#5a2335', accent: '#ffce2c',
  },
  frost: {
    name: 'Frost', dark: false,
    tray: '#4c86d6', trayHi: '#6a9ee2', trayLo: '#3468b8',
    wallTop: '#e0f0fc', wallBot: '#aed0ef', pit: '#173a72', dimple: true,
    rail: '#f2faff', pad: '#58aaff', bumper: '#8a7cff', bumperBase: '#f4f8ff',
    spinner: '#36dbe6', hub: '#fbfdff', pa: '#9a7cff', pb: '#4ef0ff', cup: '#98e8ff',
    shadow: 'rgba(30,70,140,0.30)', trail: 'rgba(255,200,90,', ui: '#16335f', accent: '#ffce2c',
  },
  neon: {
    name: 'Neon Night', dark: true,
    tray: '#211c4c', trayHi: '#2c2660', trayLo: '#15113a',
    wallTop: '#2c2858', wallBot: '#17133c', pit: '#07051a', dimple: false,
    rail: '#4a4c78', pad: '#ff3cb4', bumper: '#ff36a6', bumperBase: '#3a3466',
    spinner: '#2ce6ff', hub: '#c8c8e6', pa: '#ff48ca', pb: '#3effde', cup: '#3effc6',
    glow: '#3ee8ff', shadow: 'rgba(0,0,0,0.5)', trail: 'rgba(255,90,200,', ui: '#ffffff', accent: '#ffce2c',
  },
};

// small colour helpers
const _cc = new Map();
export function hexToRgb(h) {
  if (_cc.has(h)) return _cc.get(h);
  let out;
  const m = /^rgba?\(([^)]+)\)/.exec(h);
  if (m) out = m[1].split(',').slice(0, 3).map(v => Math.round(parseFloat(v)));
  else {
    const x = h.replace('#', '');
    out = [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  if (_cc.size < 2000) _cc.set(h, out);
  return out;
}
export function mix(a, b, k) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export function rgba(h, a) {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
export const lighten = (h, k) => mix(h, '#ffffff', k);
export const darken = (h, k) => mix(h, '#140a32', k);
