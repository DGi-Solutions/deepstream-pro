/* DeepStream Pro: optional, per-title PCM adjustments. */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./audioEngine.js'), require('./locale.js'));
    else root.DeepStreamAudioEnhancements = factory(root.DeepStreamAudio, root.DeepStreamLocale);
})(typeof window === 'object' ? window : null, function(engine, locale) {
    'use strict';
    const instances = new WeakMap();
    let sessionSequence = 0;
    const fields = ['enabled', 'profile', 'bass', 'treble', 'clarity', 'night', 'boost'];
    const zero = () => ({enabled: false, profile: 'speakers', bass: 0, treble: 0, clarity: 0, night: 0, boost: 0});
    const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value ? value : '';
    const english = {
        'Klanganpassung': 'Sound adjustments', 'Aus': 'Off', 'Beim Start anwenden': 'Apply when playback starts',
        'Bass': 'Bass', 'Höhen': 'Treble', 'Sprachpräsenz': 'Speech presence', 'Nachtmodus': 'Night mode',
        'Verstärkung': 'Gain', 'Zurücksetzen': 'Reset', 'Nur für diese Sitzung gespeichert': 'Saved for this session only',
        'Neutral starten, nach Geschmack einstellen.': 'Starts neutral. Adjust to taste.',
        'Nach einem Neustart erneut einschalten.': 'Enable again after restarting.',
        'Aktiv': 'Active', 'Noch nicht bestätigt': 'Not confirmed yet', 'Nicht angewendet': 'Not applied',
        'Änderung fehlgeschlagen': 'Change failed', 'Für diese Ausgabe ausgesetzt': 'Bypassed for this output',
        'Neutral': 'Neutral',
        'Status nicht verfügbar': 'Status unavailable', 'Wird geprüft': 'Checking',
        'Für diese Tonspur ausgesetzt': 'Bypassed for this audio track', 'Nur PCM': 'PCM only',
        'Nicht für den Start vorbereitet': 'Not prepared for playback'
    };
    const words = (value, language) => language === 'de' ? value : english[value] || value;

    function serverKey(api) {
        try {
            const address = typeof api.serverAddress === 'function' ? api.serverAddress() : api.serverAddress;
            if (typeof address !== 'string' || !address.trim()) return null;
            const parsed = new URL(address);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
            return parsed.origin + parsed.pathname.replace(/\/+$/, '');
        } catch (_) {return null;}
    }

    function sameIdentity(a, b) {
        return !!a && !!b && a.api === b.api && a.server === b.server && a.userId === b.userId && a.itemId === b.itemId && a.sourceId === b.sourceId;
    }

    function identityForPlayback(win, options) {
        const api = win.ApiClient;
        if (!api || typeof api.getCurrentUserId !== 'function') return null;
        const itemId = id(options?.item?.Id);
        const alternateId = options?.Item?.Id;
        if (!itemId || (alternateId != null && alternateId !== itemId)) return null;
        const sourceId = id(options?.mediaSource?.Id);
        const server = serverKey(api);
        let userId;
        try {userId = id(api.getCurrentUserId());} catch (_) {return null;}
        return userId && sourceId && server !== null ? {api, server, userId, itemId, sourceId} : null;
    }

    function statusText(status, language, enabled) {
        let label;
        if (!status) label = enabled ? 'Beim Start anwenden' : 'Aus';
        else if (status.accepted === false) label = 'Nicht angewendet';
        else if (status.reason === 'filter_remove_failed') label = 'Änderung fehlgeschlagen';
        else if (status.active === true && status.verified === true && status.accepted === true) label = 'Aktiv';
        else if (status.active === true) label = 'Noch nicht bestätigt';
        else if (['object_source', 'object_protected', 'object_audio', 'object_audio_source', 'object_unconfirmed', 'passthrough', 'passthrough_configured'].includes(status.reason)) label = 'Für diese Tonspur ausgesetzt';
        else if (status.reason === 'spatial_route') label = 'Für diese Ausgabe ausgesetzt';
        else if (status.reason === 'awaiting_audio_selection') label = 'Wird geprüft';
        else if (status.reason === 'neutral_settings') label = 'Neutral';
        else if (status.state === 'unavailable') label = 'Status nicht verfügbar';
        else if (status.state === 'error' || status.state === 'failed') label = 'Nicht angewendet';
        else if (status.state === 'pending' || status.state === 'checking') label = 'Wird geprüft';
        else if (status.enabled === false && status.active === false) label = 'Aus';
        else label = 'Nicht angewendet';
        return words(label, language);
    }

    function create(win, dependencies = {}) {
        if (instances.has(win)) return instances.get(win);
        const enhancement = dependencies.enhancement || engine?.enhancement;
        if (!enhancement || !['defaults', 'validate', 'safe', 'forPlayback', 'store'].every(name => typeof enhancement[name] === 'function')) return null;
        const store = enhancement.store(win);
        const now = dependencies.now || Date.now;
        let view = null, prepared = null, active = null, serial = 0;
        const ephemeral = new WeakMap();

        function valid(value) {
            try {
                const result = enhancement.validate(value);
                if (result?.ok === true && result.value && fields.every(key => Object.hasOwn(result.value, key))) {
                    return Object.fromEntries(fields.map(key => [key, result.value[key]]));
                }
            } catch (_) { /* Invalid storage or bridge data remains neutral. */ }
            return zero();
        }
        function identityCurrent(identity) {
            if (!identity || !identity.server || win.ApiClient !== identity.api) return false;
            try {return identity.api.getCurrentUserId() === identity.userId && serverKey(identity.api) === identity.server;} catch (_) {return false;}
        }
        function viewCurrent(entry) {
            try {return entry && entry === view && identityCurrent(entry.identity) &&
                entry.context.isCurrent() && entry.context.page?.isConnected !== false;} catch (_) {return false;}
        }
        function playbackCurrent(session) {
            try {return session && session === active && identityCurrent(session.identity) && session.isCurrent();} catch (_) {return false;}
        }
        function memoryFor(identity) {
            let entries = ephemeral.get(identity.api);
            if (!entries) {entries = new Map(); ephemeral.set(identity.api, entries);}
            return entries;
        }
        const memoryKey = identity => JSON.stringify([identity.server, identity.userId, identity.itemId, identity.sourceId]);
        const storageScope = identity => ({server: identity.server, sourceId: identity.sourceId});
        function remember(identity, config) {
            const entries = memoryFor(identity), key = memoryKey(identity);
            entries.delete(key); entries.set(key, valid(config));
            if (entries.size > 32) entries.delete(entries.keys().next().value);
        }
        function cancelView() {
            serial++;
            prepared = null;
            try {store.cancel();} catch (_) {}
            view?.root?.remove();
            view = null;
        }
        function prepare(entry) {
            if (!viewCurrent(entry)) return false;
            try {
                // Keep the current UI value separately: persistence may be blocked
                // or an earlier value may remain in browser storage after reset.
                const candidate = store.prepare(entry.identity);
                const result = enhancement.validate(candidate);
                if (result?.ok !== true) throw new Error('preparation unavailable');
                prepared = {identity: entry.identity, config: valid(entry.config), time: now()};
                entry.ready = true;
                return true;
            } catch (_) {
                prepared = null; entry.ready = false;
                try {store.cancel();} catch (_) {}
                return false;
            }
        }
        function nativeCall(method, value, session) {
            const player = win.api?.player;
            if (!playbackCurrent(session) || typeof player?.[method] !== 'function') {
                if (playbackCurrent(session)) session.status = {state: 'unavailable', active: false, verified: false};
                updateStatus();
                return Promise.resolve(null);
            }
            const request = ++session.request;
            return new Promise(resolve => {
                let done = false;
                const finish = result => {
                    if (done) return;
                    done = true; win.clearTimeout(timer);
                    if (!playbackCurrent(session) || request !== session.request) {resolve(null); return;}
                    session.status = result && typeof result === 'object' && !Array.isArray(result) && result.session === session.nativeSession
                        ? result : {state: 'unavailable', active: false, verified: false};
                    updateStatus(); resolve(session.status);
                };
                const timer = win.setTimeout(() => finish({state: 'unavailable', active: false, verified: false}), 1500);
                try {
                    if (value === undefined) player[method](session.nativeSession, finish);
                    else player[method](session.nativeSession, value, finish);
                } catch (_) {finish({state: 'unavailable', active: false, verified: false});}
            });
        }
        function updateStatus() {
            if (!viewCurrent(view) || !view.status) return;
            const status = playbackCurrent(active) && sameIdentity(active.identity, view.identity) ? active.status : null;
            let label = statusText(status, view.context.language, view.config.enabled);
            if (!status && !view.ready) label = words('Nicht für den Start vorbereitet', view.context.language);
            view.status.textContent = label;
            view.status.dataset.active = status?.active === true && status?.verified === true && status?.accepted === true ? 'true' : 'false';
            view.saved.textContent = view.savedLocally ? '' : words('Nur für diese Sitzung gespeichert', view.context.language);
        }
        function applyActive(entry) {
            if (!viewCurrent(entry) || !playbackCurrent(active) || !sameIdentity(active.identity, entry.identity)) return;
            active.config = valid(entry.config);
            const nativeConfig = enhancement.forPlayback(active.config, active.plan);
            active.status = null;
            nativeCall('setAudioEnhancementForSession', nativeConfig, active);
        }
        function change(entry, patch, reset = false) {
            if (!viewCurrent(entry)) {cancelView(); return false;}
            const candidate = reset ? zero() : {...entry.config, ...patch};
            const result = enhancement.validate(candidate);
            if (result?.ok !== true) return false;
            entry.config = valid(result.value);
            remember(entry.identity, entry.config);
            try {
                entry.savedLocally = reset ? store.reset(entry.identity.userId, entry.identity.itemId, storageScope(entry.identity)) === true
                    : store.write(entry.identity.userId, entry.identity.itemId, entry.config, storageScope(entry.identity)) === true;
            } catch (_) {entry.savedLocally = false;}
            prepare(entry);
            syncForm(entry);
            applyActive(entry);
            return true;
        }
        function syncForm(entry) {
            if (entry.master) entry.master.checked = entry.config.enabled;
            if (entry.controls) entry.controls.disabled = !entry.config.enabled;
            if (entry.controls) entry.controls.hidden = !entry.config.enabled;
            for (const [key, control] of Object.entries(entry.inputs || {})) {
                control.input.value = entry.config[key];
                control.output.textContent = `${entry.config[key] > 0 && control.min < 0 ? '+' : ''}${entry.config[key]} ${control.unit}`;
            }
            updateStatus();
        }
        function render(entry) {
            const doc = win.document, t = value => words(value, entry.context.language);
            const make = (tag, text, className) => {
                const node = doc.createElement(tag);
                if (text != null) node.textContent = text;
                if (className) node.className = className;
                return node;
            };
            entry.root?.remove();
            const root = make('section', null, 'deepstream-audio-enhancements');
            root.setAttribute('aria-label', t('Klanganpassung'));
            const heading = make('div', null, 'deepstream-enhancement-heading');
            const toggleLabel = make('label', null, 'deepstream-enhancement-toggle');
            const master = make('input'); master.type = 'checkbox'; master.checked = entry.config.enabled;
            master.setAttribute('aria-label', t('Klanganpassung'));
            master.addEventListener('change', () => change(entry, {enabled: master.checked}));
            toggleLabel.append(master, make('strong', t('Klanganpassung')));
            const status = make('span', null, 'deepstream-enhancement-status'); status.setAttribute('role', 'status');
            heading.append(toggleLabel, status);
            const controls = make('fieldset', null, 'deepstream-enhancement-controls');
            controls.disabled = !entry.config.enabled; controls.hidden = !entry.config.enabled;
            const grid = make('div', null, 'deepstream-enhancement-grid');
            entry.inputs = {};
            for (const [key, label, min, max, unit] of [['bass', 'Bass', -4, 4, 'dB'], ['treble', 'Höhen', -4, 4, 'dB'],
                ['clarity', 'Sprachpräsenz', 0, 100, '%'], ['night', 'Nachtmodus', 0, 100, '%'], ['boost', 'Verstärkung', 0, 3, 'dB']]) {
                const field = make('label', null, 'deepstream-enhancement-control');
                const row = make('span', null, 'deepstream-enhancement-control-label');
                const value = make('output', `${entry.config[key] > 0 && min < 0 ? '+' : ''}${entry.config[key]} ${unit}`);
                row.append(make('span', t(label)), value);
                const input = make('input'); input.type = 'range'; input.min = min; input.max = max; input.step = 1; input.value = entry.config[key];
                input.setAttribute('aria-label', t(label));
                input.addEventListener('input', () => {value.textContent = `${Number(input.value) > 0 && min < 0 ? '+' : ''}${input.value} ${unit}`;});
                input.addEventListener('change', () => change(entry, {[key]: Number(input.value)}));
                entry.inputs[key] = {input, output: value, min, unit};
                field.append(row, input); grid.append(field);
            }
            controls.append(grid);
            const footer = make('div', null, 'deepstream-enhancement-footer');
            const note = make('small', `${t('Neutral starten, nach Geschmack einstellen.')} ${t('Nach einem Neustart erneut einschalten.')}`);
            const reset = make('button', t('Zurücksetzen')); reset.type = 'button';
            reset.addEventListener('click', () => change(entry, {}, true));
            footer.append(note, reset);
            const saved = make('small', null, 'deepstream-enhancement-saved');
            root.append(heading, controls, footer, saved);
            entry.status = status; entry.saved = saved; entry.root = root;
            entry.master = master; entry.controls = controls;
            entry.context.container.append(root);
            updateStatus();
        }

        const controller = {
            attach(context) {
                const identity = {api: context.api, server: context.api ? serverKey(context.api) : null,
                    userId: id(context.userId), itemId: id(context.itemId), sourceId: id(context.sourceId)};
                if (!identity.api || !identity.server || !identity.userId || !identity.itemId || !identity.sourceId ||
                    !identityCurrent(identity) || typeof context.isCurrent !== 'function' || !context.isCurrent() || !context.container) {
                    cancelView(); return false;
                }
                let config, savedLocally = true, oldRoot = null;
                if (view && sameIdentity(view.identity, identity)) {config = view.config; savedLocally = view.savedLocally; oldRoot = view.root;}
                else {
                    const remembered = memoryFor(identity).get(memoryKey(identity));
                    try {config = remembered || store.read(identity.userId, identity.itemId, storageScope(identity));} catch (_) {config = remembered || zero(); savedLocally = false;}
                    cancelView();
                }
                view = {identity, context, config: valid(config), savedLocally, ready: false, serial: ++serial, root: oldRoot};
                prepare(view); render(view); return true;
            },
            cancelView,
            identityForPlayback: options => identityForPlayback(win, options),
            identityCurrent,
            preparePlayback(options, plan) {
                const identity = identityForPlayback(win, options);
                let config = zero();
                const snapshot = prepared;
                prepared = null;
                if (identity) {
                    let result;
                    try {result = store.consume(identity);} catch (_) {}
                    // A successful store consume is necessary. A guessed item or
                    // an arbitrary saved preference never authorizes this load.
                    if (result && result.itemId === identity.itemId && identityCurrent(identity) && snapshot &&
                        sameIdentity(snapshot.identity, identity) && now() - snapshot.time >= 0 && now() - snapshot.time <= 120000) {
                        config = valid(snapshot.config);
                    }
                } else {try {store.cancel();} catch (_) {}}
                return {identity, config, plan, session: `deepstream-pcm-${now()}-${++sessionSequence}`,
                    nativeConfig: enhancement.forPlayback(config, plan)};
            },
            bindPlayback(ticket, isCurrent) {
                if (active) active.request++;
                active = ticket?.identity && identityCurrent(ticket.identity) && typeof isCurrent === 'function' ? {
                    identity: ticket.identity, config: valid(ticket.config), plan: ticket.plan,
                    nativeSession: ticket.session,
                    isCurrent, status: null, request: 0
                } : null;
                updateStatus(); return active;
            },
            refreshStatus(session) {return nativeCall('getAudioEnhancementStatusForSession', undefined, session);},
            updatePlan(session, plan) {
                if (!playbackCurrent(session)) return Promise.resolve(null);
                session.plan = plan;
                session.status = null;
                return nativeCall('setAudioEnhancementForSession', enhancement.forPlayback(session.config, plan), session);
            },
            invalidatePlayback(session) {
                if (!session || session !== active) return;
                if (active) active.request++;
                active = null;
                if (prepared && sameIdentity(prepared.identity, session.identity)) {
                    prepared = null;
                    try {store.cancel();} catch (_) {}
                }
                updateStatus();
            },
            // Read-only state is useful for the app and generated-fixture tests.
            state() {return {viewConfig: view ? valid(view.config) : null, prepared: !!prepared, activeStatus: active?.status ? {...active.status} : null};}
        };
        instances.set(win, controller);
        return controller;
    }

    return Object.freeze({create, sameIdentity, identityForPlayback, statusText});
});
