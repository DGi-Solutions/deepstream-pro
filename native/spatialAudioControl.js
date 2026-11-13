(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DeepStreamSpatialAudioControl = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const instances = new WeakMap();
    const copy = {
        de: {title: 'Spatial Audio', experimental: 'Experimentell', scope: 'Appweit. Ein Neustart kann erforderlich sein. Fixed und Head Tracked werden in macOS gewählt.', saving: 'Wird gespeichert …', changed: 'Einstellung geändert. Ein Neustart kann erforderlich sein.', unavailable: 'Einstellung nicht verfügbar.', failed: 'Änderung nicht bestätigt.', incompatible: 'Gerätetyp Basic, Gerät und Kanäle Auto sowie ausgeschalteten Exklusivmodus verwenden. Eine eigene mpv-Audioausgabe hat Vorrang.'},
        en: {title: 'Spatial Audio', experimental: 'Experimental', scope: 'App-wide. A restart may be required. Choose Fixed or Head Tracked in macOS.', saving: 'Saving …', changed: 'Setting changed. A restart may be required.', unavailable: 'Setting unavailable.', failed: 'Change not confirmed.', incompatible: 'Use Basic device type, Auto device and channels, and turn off exclusive mode. A custom mpv audio output takes precedence.'}
    };
    function incompatible(s) {
        return !!((s.devicetype != null && s.devicetype !== 'basic') || (s.device != null && s.device !== 'auto') ||
            (s.channels != null && s.channels !== 'auto') || s.exclusive === true ||
            (typeof s.customAudioOutput === 'string' && s.customAudioOutput.trim()));
    }
    function create(win) {
        if (instances.has(win)) return instances.get(win);
        let view = null;
        let ready;
        function live(v) {
            try { return view === v && v.page.isConnected && v.context.isCurrent() && win.ApiClient === v.context.api && v.context.api.getCurrentUserId() === v.context.userId; }
            catch (_) { return false; }
        }
        function nativeCall(method, ...args) {
            return new Promise((resolve, reject) => {
                const settings = win.api?.settings;
                if (typeof settings?.[method] !== 'function') { reject(new Error('unavailable')); return; }
                let settled = false;
                const timer = win.setTimeout(() => {if (!settled) {settled = true; reject(new Error('timeout'));}}, 1500);
                try {settings[method](...args, result => {if (!settled) {settled = true; win.clearTimeout(timer); resolve(result);}});}
                catch (error) {if (!settled) {settled = true; win.clearTimeout(timer); reject(error);}}
            });
        }
        function show(v, value, message) {
            if (!live(v)) return;
            v.confirmed = value;
            v.input.checked = value === true;
            v.input.disabled = typeof value !== 'boolean';
            v.status.textContent = message || '';
            v.hint.textContent = value === true && incompatible(v.context.settings || {}) ? v.t.incompatible : '';
        }
        function ensureReady() {
            if (!ready) ready = Promise.resolve(win.initCompleted).then(() => {
                if (!Array.isArray(win.jmpInfo?.settingsUpdate)) throw new Error('unavailable');
                win.jmpInfo.settingsUpdate.push((section, values) => {
                    const v = view;
                    if (!v || !live(v) || section !== 'audio' || typeof values?.spatialAudio !== 'boolean' || v.phase === 'write') return;
                    v.revision++;
                    v.phase = '';
                    show(v, values.spatialAudio, '');
                });
            });
            return ready;
        }
        async function load(v) {
            const rev = ++v.revision;
            v.phase = 'read';
            try {
                await ensureReady();
                const value = await nativeCall('value', 'audio', 'spatialAudio');
                if (!live(v) || rev !== v.revision) return;
                v.phase = '';
                if (typeof value !== 'boolean') throw new Error('invalid');
                show(v, value, '');
            } catch (_) { if (live(v) && rev === v.revision) {v.phase = ''; show(v, null, v.t.unavailable);} }
        }
        async function change(v) {
            if (!live(v) || v.phase || v.input.disabled || typeof v.confirmed !== 'boolean') return;
            const requested = v.input.checked;
            v.input.checked = v.confirmed;
            v.input.disabled = true;
            v.phase = 'write';
            const rev = ++v.revision;
            v.status.textContent = v.t.saving;
            try {
                await nativeCall('setValue', 'audio', 'spatialAudio', requested);
                const actual = await nativeCall('value', 'audio', 'spatialAudio');
                if (!live(v) || rev !== v.revision) return;
                v.phase = '';
                if (typeof actual !== 'boolean') {show(v, null, v.t.failed); return;}
                show(v, actual, actual === requested ? v.t.changed : v.t.failed);
            } catch (_) { if (live(v) && rev === v.revision) {v.phase = ''; show(v, null, v.t.failed);} }
        }
        function cancelView() {
            if (!view) return;
            view.revision++;
            view.root.remove();
            view = null;
        }
        function attach(context) {
            if (view && live(view) && view.context.api === context?.api && view.context.userId === context.userId &&
                view.context.itemId === context.itemId && view.context.sourceId === context.sourceId &&
                view.context.page === context.page && view.context.container === context.container &&
                view.context.language === context.language) {
                view.context = context;
                view.hint.textContent = view.confirmed === true && incompatible(context.settings || {}) ? view.t.incompatible : '';
                return;
            }
            cancelView();
            if (!context?.api || !context.userId || !context.itemId || !context.sourceId || !context.page || !context.container || typeof context.isCurrent !== 'function') return;
            const doc = win.document;
            const node = (tag, cls, text) => {const el = doc.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el;};
            const t = copy[context.language === 'de' ? 'de' : 'en'];
            const root = node('section', 'deepstream-spatial-control');
            const label = node('label', 'deepstream-spatial-toggle');
            const input = node('input'); input.type = 'checkbox'; input.disabled = true; input.setAttribute('aria-label', t.title);
            label.append(input, node('strong', '', t.title), node('span', 'deepstream-spatial-experimental', t.experimental));
            const scope = node('small', 'deepstream-spatial-scope', t.scope);
            const hint = node('small', 'deepstream-spatial-hint');
            const status = node('small', 'deepstream-spatial-status'); status.setAttribute('role', 'status');
            root.append(label, scope, hint, status);
            context.container.append(root);
            view = {context, root, input, status, hint, t, page: context.page, revision: 0, phase: '', confirmed: null};
            const current = view;
            input.addEventListener('change', () => change(current));
            load(current);
        }
        const controller = {attach, cancelView};
        instances.set(win, controller);
        return controller;
    }
    return {create, incompatible};
});
