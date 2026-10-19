// Bridge between the web game and the native iOS shell (WKWebView). Falls back to web APIs.
const H = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
export const isNative = !!H;

const pending = new Map();
let seq = 0;
function post(msg) {
  if (!H) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((res) => {
    pending.set(id, res);
    H.postMessage({ ...msg, id });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(null); } }, 15000);
  });
}
// called by Swift: window.__nativeReply(id, payload)
window.__nativeReply = (id, payload) => {
  const r = pending.get(id);
  if (r) { pending.delete(id); r(payload); }
};

export function haptic(style = 'light') {
  if (H) { H.postMessage({ type: 'haptic', style }); return; }
  if (navigator.vibrate) {
    const ms = { light: 8, medium: 14, heavy: 22, success: [10, 40, 18], warning: [20, 50, 20], selection: 5 }[style] || 8;
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }
}

function blobToBase64(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.readAsDataURL(blob);
  });
}

// share text/url and optionally a file (Blob). Returns 'shared' | 'copied' | 'cancelled'
export async function share({ text, url, file, fileName, mime }) {
  if (H) {
    const payload = { type: 'share', text, url };
    if (file) { payload.fileBase64 = await blobToBase64(file); payload.fileName = fileName; payload.mime = mime || file.type; }
    const r = await post(payload);
    return r && r.ok ? 'shared' : 'cancelled';
  }
  try {
    if (file && navigator.canShare) {
      const f = new File([file], fileName, { type: mime || file.type });
      if (navigator.canShare({ files: [f] })) {
        await navigator.share({ files: [f], text: url ? `${text}\n${url}` : text });
        return 'shared';
      }
    }
    if (navigator.share && !file) {
      await navigator.share({ text, url });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  if (file) {
    // desktop fallback: download the file
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch (e) {
    return 'cancelled';
  }
}

export function gcAuth() { return post({ type: 'gcAuth' }); }
export function gcSubmit(score, day) { return post({ type: 'gcSubmit', score, day }); }
export function gcShow() { return post({ type: 'gcShow' }); }
export function openURL(url) {
  if (H) { H.postMessage({ type: 'open', url }); return; }
  window.open(url, '_blank', 'noopener');
}
export function requestReview() { if (H) H.postMessage({ type: 'review' }); }
