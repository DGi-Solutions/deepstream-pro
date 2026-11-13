(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DeepStreamFormatActivationToast = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    // Only validated native activation signals may be passed to observe().
    // Titles, stream metadata and codec availability do not confirm output.
    const CSS = `
.deepstream-format-toast{position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top, 0px) + 22px);right:calc(env(safe-area-inset-right, 0px) + 22px);max-width:calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 44px);box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:11px 15px;border:1px solid rgba(234,196,129,.26);border-radius:15px;background:rgba(20,19,18,.90);box-shadow:0 8px 32px rgba(0,0,0,.36);backdrop-filter:blur(20px);color:#f5efe4;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.01em;pointer-events:none;opacity:1;transition:opacity 350ms ease,transform 350ms ease;transform:translateY(0);animation:deepstream-format-enter 350ms ease}
@keyframes deepstream-format-enter{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
.deepstream-format-toast.is-fading{opacity:0;transform:translateY(-5px)}
.deepstream-format-toast-mark{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%;background:#e9bd78;box-shadow:0 0 12px rgba(233,189,120,.65)}
.deepstream-format-toast-formats{display:flex;align-items:center;flex-wrap:wrap;gap:5px 12px}
.deepstream-format-toast-format{white-space:nowrap}
@media(max-width:480px){.deepstream-format-toast{top:calc(env(safe-area-inset-top, 0px) + 12px);right:calc(env(safe-area-inset-right, 0px) + 12px);max-width:calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 24px);font-size:12px;padding:9px 12px}}
@media(prefers-reduced-motion:reduce){.deepstream-format-toast{transition:none;animation:none;transform:none}.deepstream-format-toast.is-fading{transform:none}}
`;
    const HOLD_MS = 4500;
    const FADE_MS = 350;
    const supported = {audio: 'dolby-atmos', video: 'dolby-vision'};
    const names = {'dolby-atmos': 'Dolby Atmos', 'dolby-vision': 'Dolby Vision'};
    function create(win, options) {
        const opts = options || {};
        const doc = win.document;
        const container = opts.container || doc.body;
        const language = String(opts.language || doc.documentElement.lang || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
        let session = null, destroyed = false, toast = null, hold = null, fade = null;
        let seen = new Set(), active = new Set();
        const retired = new Set();
        const style = doc.createElement('style');
        style.textContent = CSS;
        doc.head.append(style);
        function clearTimers() {
            if (hold !== null) win.clearTimeout(hold);
            if (fade !== null) win.clearTimeout(fade);
            hold = fade = null;
        }
        function remove() {
            clearTimers();
            if (toast) toast.remove();
            toast = null;
        }
        function render(formats) {
            remove();
            toast = doc.createElement('div');
            toast.className = 'deepstream-format-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            toast.setAttribute('aria-atomic', 'true');
            toast.setAttribute('aria-label', formats.map(f => names[f]).join(' · ') + (language === 'de' ? ' aktiviert' : ' active'));
            const mark = doc.createElement('span');
            mark.className = 'deepstream-format-toast-mark';
            mark.setAttribute('aria-hidden', 'true');
            const list = doc.createElement('span');
            list.className = 'deepstream-format-toast-formats';
            for (const f of formats) {
                const item = doc.createElement('span');
                item.className = 'deepstream-format-toast-format';
                item.textContent = names[f];
                list.append(item);
            }
            toast.append(mark, list);
            container.append(toast);
            hold = win.setTimeout(() => {
                hold = null;
                if (!toast) return;
                toast.classList.add('is-fading');
                const reduced = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (reduced) { remove(); return; }
                fade = win.setTimeout(() => { fade = null; remove(); }, FADE_MS);
            }, HOLD_MS);
        }
        // IDs must be unique per playback. A late observation cannot promote
        // an old session to the current one: begin is an explicit operation.
        function startSession(id) {
            if (destroyed || (typeof id !== 'string' && typeof id !== 'number') || id === '') return false;
            if (session === id) return true;
            if (retired.has(id)) return false;
            if (session !== null) retired.add(session);
            remove(); session = id; seen = new Set(); active = new Set(); return true;
        }
        function observe(id, signal) {
            if (destroyed || session === null || id !== session || !signal || typeof signal !== 'object') return false;
            let changed = false, invalidated = false;
            for (const key of ['audio', 'video']) {
                const value = signal[key], format = supported[key];
                if (!value || value.format !== format) continue;
                if (value.active === false || value.confirmed === false) {
                    if (active.delete(format)) invalidated = true;
                } else if (value.active === true && value.confirmed === true) {
                    active.add(format);
                    if (!seen.has(format)) { seen.add(format); changed = true; }
                }
            }
            if (invalidated) remove();
            if (!changed) return false;
            render([...active]);
            return true;
        }
        function stop(id) {
            if (destroyed || session === null || id !== session) return false;
            remove(); retired.add(session); session = null; seen = new Set(); active = new Set(); return true;
        }
        function destroy() {
            if (destroyed) return;
            remove(); style.remove(); session = null; seen.clear(); active.clear(); retired.clear(); destroyed = true;
        }
        return {startSession, observe, stop, destroy};
    }
    return {create, HOLD_MS, FADE_MS};
});
