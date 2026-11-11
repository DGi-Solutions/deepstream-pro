/* DeepStream Pro: source information on the film page, before playback. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./audioEngine.js'));
    else {
        root.DeepStreamAudioDetails = factory(root.DeepStreamAudio);
        root.DeepStreamAudioDetails.install(root);
    }
})(typeof window === 'object' ? window : null, function (engine) {
    'use strict';
    const text = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
    const unknown = 'Nicht angegeben';
    const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const decimal = value => value.toLocaleString('de-DE', {maximumFractionDigits: 2});
    const rate = value => number(value) ? decimal(number(value) / 1000) + ' kHz' : unknown;
    const bitrate = value => number(value) ? decimal(number(value) / (number(value) >= 1000000 ? 1000000 : 1000)) + (number(value) >= 1000000 ? ' Mbit/s' : ' kbit/s') : unknown;
    const languages = {deu: 'Deutsch', eng: 'Englisch', fra: 'Französisch', spa: 'Spanisch', ita: 'Italienisch', jpn: 'Japanisch'};

    function readSettings(audio = {}, other = {}) {
        const settings = {};
        // NativeShell exposes getters that are deliberately not enumerable.
        for (const key of ['streamSelection', 'spatialAudio', 'devicetype', 'device', 'channels', 'exclusive']) settings[key] = audio[key];
        settings.customAudioOutput = text(other.ao);
        return settings;
    }

    function model({source = {}, selectedIndex, settings = {}, capabilities = {}} = {}) {
        const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
        const audio = streams.filter(s => s && s.Type === 'Audio');
        const selected = audio.find(s => s.Index === selectedIndex) || audio.find(s => s.Index === source.DefaultAudioStreamIndex) || audio[0];
        if (!selected) return null;
        const info = engine.describe(selected);
        const plan = engine.plan({streams, selectedIndex: selected.Index, mode: settings.streamSelection || 'auto', capabilities});
        const layout = text(selected.ChannelLayout);
        const loss = info.lossless ? 'Verlustfrei' : ['ac3', 'eac3', 'aac', 'mp3', 'mp2', 'opus', 'vorbis'].includes(info.codec) ? 'Verlustbehaftet' : unknown;
        const language = Object.hasOwn(languages, info.language) ? languages[info.language] : info.language || unknown;
        const spatial = info.objectFormat === 'atmos' ? 'Dolby Atmos' : info.objectFormat === 'dtsx' ? 'DTS:X' : unknown;
        const spatialOutput = settings.spatialAudio === true && settings.devicetype === 'basic' &&
            settings.device === 'auto' && settings.channels === 'auto' && settings.exclusive === false;
        const output = text(settings.customAudioOutput) ? 'Benutzerdefinierter Audioausgang' :
            spatialOutput ? 'Spatial Audio · ' + (plan.source?.channels === 2 ? 'Stereo-PCM' : 'Mehrkanal-PCM') : settings.channels === '2.0' ? 'Stereo-PCM' :
            settings.devicetype === 'hdmi' ? 'HDMI nach Ausgabeeinstellung' : settings.devicetype === 'spdif' ? 'S/PDIF nach Ausgabeeinstellung' : 'PCM über die gewählte Audioausgabe';
        return {
            title: info.label,
            rows: [
                ['Codec', info.label], ['Sprache', language],
                ['Kanäle', (info.channels ? String(info.channels) : unknown) + (layout ? ' · ' + layout : '')],
                ['Bitrate', bitrate(info.bitRate)], ['Abtastrate', rate(info.sampleRate)],
                ['Bittiefe', info.bitDepth ? info.bitDepth + ' Bit' : unknown],
                ['Kompression', loss], ['Räumliche Metadaten der Quelle', spatial]
            ],
            selection: plan.reason === 'manual' ? 'Manuell' : 'Automatisch',
            plannedTrack: plan.source?.label || info.label,
            output,
            decoder: capabilities.decoderEnumerationAvailable !== true ? 'Noch nicht geprüft' :
                capabilities.decoders?.includes(plan.source?.codec || info.codec) ? 'Verfügbar' : 'Kein lokaler Decoder gemeldet',
            tracks: audio.map(stream => {
                const description = engine.describe(stream);
                const lang = Object.hasOwn(languages, description.language) ? languages[description.language] : description.language || unknown;
                return {index: stream.Index, text: description.label + ' · ' + lang + ' · ' +
                    (description.channels ? description.channels + ' Kanäle' : unknown) + ' · ' + bitrate(description.bitRate)};
            })
        };
    }

    function createLoader({fetchItem, fetchCapabilities, render, unavailable}) {
        let generation = 0;
        const validSession = context => !context.api?.getCurrentUserId || context.api.getCurrentUserId() === context.userId;
        return {
            cancel() {generation++;},
            async update(context) {
                const current = ++generation;
                try {
                    const [item, capabilities] = await Promise.all([fetchItem(context), fetchCapabilities()]);
                    if (current !== generation || !context.isCurrent() || !validSession(context)) return false;
                    const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
                    const source = sources.find(s => s.Id === context.sourceId) || sources[0] || {MediaStreams: item.MediaStreams};
                    render(model({source, selectedIndex: context.selectedIndex, settings: context.settings, capabilities}), context);
                    return true;
                } catch (_) {
                    if (current === generation && context.isCurrent() && validSession(context)) unavailable(context);
                    return false;
                }
            }
        };
    }

    function install(win) {
        const doc = win.document;
        const cache = new WeakMap();
        let timeout, lastSignature = '';
        const make = (tag, value, className) => {
            const node = doc.createElement(tag);
            if (value != null) node.textContent = value;
            if (className) node.className = className;
            return node;
        };
        const routeId = () => {
            const hash = String(win.location.hash || '');
            if (!/\bdetails\b/i.test(hash.split('?')[0])) return '';
            return new URLSearchParams(hash.split('?')[1] || '').get('id') || '';
        };
        const panelFor = page => {
            let panel = page.querySelector('.deepstream-audio-details');
            if (!panel) {
                panel = make('section', null, 'deepstream-audio-details');
                panel.setAttribute('aria-label', 'Audiodetails');
                const tracks = page.querySelector('.trackSelections');
                if (!tracks) return null;
                tracks.insertAdjacentElement('afterend', panel);
            }
            return panel;
        };
        const loader = createLoader({
            async fetchItem(context) {
                let items = cache.get(context.api);
                if (!items) {items = new Map(); cache.set(context.api, items);}
                const key = context.userId + ':' + context.id;
                let entry = items.get(key);
                if (!entry || Date.now() - entry.time > 60000) {
                    entry = {time: Date.now(), promise: Promise.resolve(context.api.getItem(context.userId, context.id))};
                    items.set(key, entry);
                    if (items.size > 16) items.delete(items.keys().next().value);
                    entry.promise.catch(() => items.delete(key));
                }
                return entry.promise;
            },
            async fetchCapabilities() {
                await win.initCompleted;
                if (!win._mpvVideoPlayer) return {};
                return win._mpvVideoPlayer.prototype.readAudioPlayerInfo('getAudioCapabilities');
            },
            render(value, context) {
                const panel = panelFor(context.page);
                if (!panel) return;
                panel.replaceChildren();
                if (!value) {panel.append(make('p', 'Keine Audiodaten verfügbar.')); return;}
                const header = make('div', null, 'deepstream-audio-heading');
                header.append(make('h3', 'Audio'), make('span', value.title, 'deepstream-audio-badge'));
                panel.append(header);
                const grid = make('dl', null, 'deepstream-audio-grid');
                for (const [label, content] of value.rows) {
                    const field = make('div'); field.append(make('dt', label), make('dd', content)); grid.append(field);
                }
                panel.append(grid);
                const planned = make('div', null, 'deepstream-audio-route');
                planned.append(make('strong', 'Wiedergabevorschau'),
                    make('p', value.selection + ' · ' + value.plannedTrack), make('p', value.output),
                    make('p', 'Decoder: ' + value.decoder),
                    make('small', 'Die tatsächliche Ausgabe steht nach dem Start in der Wiedergabeinfo.'));
                panel.append(planned);
                if (value.tracks.length > 1) {
                    const tracks = make('details'); tracks.append(make('summary', 'Alle Tonspuren (' + value.tracks.length + ')'));
                    const list = make('ul'); for (const track of value.tracks) list.append(make('li', track.text));
                    tracks.append(list); panel.append(tracks);
                }
            },
            unavailable(context) {
                const panel = panelFor(context.page);
                if (panel) panel.replaceChildren(make('p', 'Audiodaten konnten nicht geladen werden.'));
            }
        });
        function refresh() {
            const id = routeId();
            const page = doc.querySelector('#itemDetailPage:not(.hide)');
            const api = win.ApiClient;
            if (!id || !page || !api?.getItem || !api.getCurrentUserId) {lastSignature = ''; loader.cancel(); return;}
            const select = page.querySelector('.selectAudio');
            if (!select || !select.options.length) return;
            const sourceId = page.querySelector('.selectSource')?.value || '';
            const selectedIndex = select.value === '' ? undefined : Number(select.value);
            const settings = readSettings(win.jmpInfo?.settings?.audio, win.jmpInfo?.settings?.other);
            const userId = api.getCurrentUserId();
            const signature = [id, sourceId, selectedIndex, userId, JSON.stringify(settings)].join('|');
            if (signature === lastSignature && page.querySelector('.deepstream-audio-details')) return;
            lastSignature = signature;
            loader.update({id, page, api, userId, sourceId, selectedIndex, settings,
                isCurrent: () => page.isConnected && !page.classList.contains('hide') && routeId() === id && win.ApiClient === api});
        }
        function schedule() {clearTimeout(timeout); timeout = setTimeout(refresh, 60);}
        function start() {
            doc.addEventListener('viewshow', schedule, true);
            doc.addEventListener('change', event => {
                if (event.target.matches?.('.selectAudio, .selectSource')) {lastSignature = ''; schedule();}
            }, true);
            win.addEventListener('hashchange', () => {lastSignature = ''; loader.cancel(); schedule();});
            new MutationObserver(records => {
                if (routeId() && records.some(r => !r.target.closest?.('.deepstream-audio-details'))) schedule();
            }).observe(doc.body, {childList: true, subtree: true});
            win.jmpInfo?.settingsUpdate?.push(() => {lastSignature = ''; schedule();});
            schedule();
        }
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once: true});
        else start();
    }

    return Object.freeze({model, createLoader, install, rate, bitrate, readSettings});
});
