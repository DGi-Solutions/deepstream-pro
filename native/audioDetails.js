/* DeepStream Pro: source information on the film page, before playback. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./audioEngine.js'), require('./locale.js'), require('./videoDetails.js'), require('./artwork.js'));
    else {
        root.DeepStreamAudioDetails = factory(root.DeepStreamAudio, root.DeepStreamLocale, root.DeepStreamVideoDetails, root.DeepStreamArtwork);
        root.DeepStreamAudioDetails.install(root);
    }
})(typeof window === 'object' ? window : null, function (engine, locale, videoDetails, artworkModule) {
    'use strict';
    const text = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
    const unknown = 'Nicht angegeben';
    const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const decimal = (value, language = 'de') => value.toLocaleString(language === 'de' ? 'de-DE' : 'en-US', {maximumFractionDigits: 2});
    const rate = (value, language = 'de') => number(value) ? decimal(number(value) / 1000, language) + ' kHz' : locale.text(unknown, language);
    const bitrate = (value, language = 'de') => number(value) ? decimal(number(value) / (number(value) >= 1000000 ? 1000000 : 1000), language) + (number(value) >= 1000000 ? ' Mbit/s' : ' kbit/s') : locale.text(unknown, language);
    const languages = {deu: 'Deutsch', eng: 'Englisch', fra: 'Französisch', spa: 'Spanisch', ita: 'Italienisch', jpn: 'Japanisch'};
    const isMediaPage = item => item.MediaType === 'Video' || ['Movie', 'Episode', 'Video', 'Series', 'Season', 'BoxSet'].includes(item.Type);

    function artworkCandidates(api, item) {
        const images = [];
        if (item.Id) item.BackdropImageTags?.forEach((tag, index) => images.push([item.Id, {type: 'Backdrop', index, tag}]));
        if (item.ParentBackdropItemId) item.ParentBackdropImageTags?.forEach((tag, index) => images.push([item.ParentBackdropItemId, {type: 'Backdrop', index, tag}]));
        if (item.Id && item.ImageTags?.Primary) images.push([item.Id, {type: 'Primary', tag: item.ImageTags.Primary}]);
        const candidates = [], seen = new Set();
        for (const [id, image] of images) {
            if (seen.has(image.tag)) continue;
            seen.add(image.tag);
            for (const name of ['getScaledImageUrl', 'getImageUrl']) {
                if (typeof api[name] !== 'function') continue;
                try {
                    // ApiClient consumes type/index in the supplied options object.
                    const url = api[name](id, {...image, maxWidth: 1920, quality: 90});
                    if (typeof url === 'string' && url) {candidates.push({...image, url}); break;}
                } catch (_) { /* Older clients may only expose the unscaled helper. */ }
            }
        }
        return candidates;
    }
    const artworkSources = (api, item) => artworkCandidates(api, item).map(image => image.url);

    function trackLabel(stream, selectedLanguage = 'de') {
        const t = value => locale.text(value, selectedLanguage);
        const info = engine.describe(stream);
        const language = Object.hasOwn(languages, info.language) ? languages[info.language] : info.language || unknown;
        const fields = [language, info.label, text(stream.ChannelLayout) || (info.channels ? info.channels + ' ' + t('Kanäle') : '')];
        if (info.sampleRate) fields.push(rate(info.sampleRate, selectedLanguage));
        if (info.bitDepth) fields.push(info.bitDepth + ' Bit');
        if (info.bitRate) fields.push(bitrate(info.bitRate, selectedLanguage));
        if (stream.IsCommentary) fields.push('Kommentar');
        if (stream.IsAudioDescription) fields.push('Audiodeskription');
        if (stream.IsHearingImpaired) fields.push('Hörgeschädigtenfassung');
        return fields.filter(Boolean).map(t).join(' · ');
    }

    function readSettings(audio = {}, other = {}) {
        const settings = {};
        // NativeShell exposes getters that are deliberately not enumerable.
        for (const key of ['streamSelection', 'spatialAudio', 'devicetype', 'device', 'channels', 'exclusive']) settings[key] = audio[key];
        settings.customAudioOutput = text(other.ao);
        return settings;
    }

    function model({source = {}, selectedIndex, settings = {}, capabilities = {}, uiLanguage = 'de'} = {}) {
        const t = value => locale.text(value, uiLanguage);
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
        const output = text(settings.customAudioOutput) ? t('Benutzerdefinierter Audioausgang') :
            spatialOutput ? 'Spatial Audio · ' + t(plan.source?.channels === 2 ? 'Stereo-PCM' : 'Mehrkanal-PCM') : settings.channels === '2.0' ? t('Stereo-PCM') :
            settings.devicetype === 'hdmi' ? t('HDMI nach Ausgabeeinstellung') : settings.devicetype === 'spdif' ? t('S/PDIF nach Ausgabeeinstellung') : t('PCM über die gewählte Audioausgabe');
        return {
            audioPlan: plan,
            title: info.label,
            rows: [
                ['Codec', info.label], ['Sprache', language],
                ['Kanäle', (info.channels ? String(info.channels) : unknown) + (layout ? ' · ' + layout : '')],
                ['Bitrate', bitrate(info.bitRate, uiLanguage)], ['Abtastrate', rate(info.sampleRate, uiLanguage)],
                ['Bittiefe', info.bitDepth ? info.bitDepth + ' Bit' : unknown],
                ['Kompression', loss], ['Räumliche Metadaten der Quelle', spatial]
            ].map(([label, value]) => [t(label), t(value)]),
            selection: t(plan.reason === 'manual' ? 'Manuell' : 'Automatisch'),
            plannedTrack: plan.source?.label || info.label,
            output,
            decoder: capabilities.decoderEnumerationAvailable !== true ? t('Noch nicht geprüft') :
                capabilities.decoders?.includes(plan.source?.codec || info.codec) ? t('Verfügbar') : t('Kein lokaler Decoder gemeldet'),
            tracks: audio.map(stream => ({index: stream.Index, text: trackLabel(stream, uiLanguage)}))
        };
    }

    function createLoader({fetchItem, fetchCapabilities, render, unavailable, initialRender = false}) {
        let generation = 0;
        const validSession = context => !context.api?.getCurrentUserId || context.api.getCurrentUserId() === context.userId;
        return {
            cancel() {generation++;},
            async update(context) {
                const current = ++generation;
                try {
                    const capabilitiesPending = Promise.resolve().then(fetchCapabilities).catch(() => ({}));
                    const item = await fetchItem(context);
                    if (current !== generation || !context.isCurrent() || !validSession(context)) return false;
                    const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
                    const source = sources.find(s => s.Id === context.sourceId) || sources[0] || {MediaStreams: item.MediaStreams};
                    const draw = capabilities => render(model({source, selectedIndex: context.selectedIndex, settings: context.settings, capabilities, uiLanguage: context.language}), context, item, source);
                    if (initialRender) draw({});
                    const capabilities = await capabilitiesPending;
                    if (current !== generation || !context.isCurrent() || !validSession(context)) return false;
                    draw(capabilities);
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
        const artwork = artworkModule.create(win, {candidates: artworkCandidates});
        const enhancements = win.DeepStreamAudioEnhancements?.create(win);
        const spatial = win.DeepStreamSpatialAudioControl?.create(win);
        let timeout, lastPage, lastApi, lastSignature = '';
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
        function columnsFor(page, enabled) {
            const section = page.querySelector('.detailSection');
            if (!section) return null;
            if (!enabled) {
                for (const wrapper of section.querySelectorAll('.deepstream-technical-column, .deepstream-description-column')) wrapper.replaceWith(...wrapper.childNodes);
                return section;
            }
            let technical = section.querySelector('.deepstream-technical-column');
            let description = section.querySelector('.deepstream-description-column');
            if (!technical) {technical = make('div', null, 'deepstream-technical-column'); section.prepend(technical);}
            if (!description) {description = make('div', null, 'deepstream-description-column'); section.append(description);}
            for (const selector of ['.trackSelections', '.deepstream-audio-details', '.deepstream-video-details']) {
                const node = section.querySelector(selector);
                if (node && node.parentElement !== technical) technical.append(node);
            }
            for (const selector of ['.detailSectionContent', '.itemDetailsGroup']) {
                const node = section.querySelector(selector);
                if (node && node.parentElement !== description) description.append(node);
            }
            return technical;
        }
        const panelFor = (page, kind = 'audio') => {
            let panel = page.querySelector('.deepstream-' + kind + '-details');
            if (!panel) {
                const column = columnsFor(page, true);
                if (!column) return null;
                panel = make('section', null, 'deepstream-' + kind + '-details deepstream-media-details');
                panel.setAttribute('aria-label', locale.text(kind === 'audio' ? 'Audiodetails' : 'Videodetails', locale.language(win)));
                const video = column.querySelector('.deepstream-video-details');
                if (kind === 'audio' && video) column.insertBefore(panel, video); else column.append(panel);
            }
            return panel;
        };
        function renderVideo(context, source) {
            const value = videoDetails.model(source, context.videoIndex, context.language);
            if (!value) {context.page.querySelector('.deepstream-video-details')?.remove(); return;}
            const panel = panelFor(context.page, 'video');
            if (!panel) return;
            const t = value => locale.text(value, context.language);
            panel.replaceChildren();
            const header = make('div', null, 'deepstream-audio-heading');
            header.append(make('h3', 'Video'), make('span', value.rows.find(row => row.label === 'Codec')?.value || 'Video', 'deepstream-audio-badge'));
            const grid = make('dl', null, 'deepstream-audio-grid');
            for (const row of value.rows) {
                const field = make('div'); field.append(make('dt', t(row.label)), make('dd', row.value || t(unknown))); grid.append(field);
            }
            panel.append(header, grid);
        }
        const loader = createLoader({
            initialRender: true,
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
            render(value, context, item, source) {
                const t = value => locale.text(value, context.language);
                context.page.querySelector('.trackSelections')?.setAttribute('data-deepstream-playback-label', t('Wiedergabe'));
                const mediaPage = isMediaPage(item);
                context.page.classList.toggle('deepstream-media-page', mediaPage);
                context.page.classList.toggle('deepstream-person-page', !mediaPage);
                context.page.classList.toggle('deepstream-film-page', item.Type === 'Movie');
                columnsFor(context.page, mediaPage);
                try {if (mediaPage) artwork.update(context, item); else artwork.clear(context.page);}
                catch (_) { /* Keep source details available when artwork fails. */ }
                if (mediaPage) renderVideo(context, source);
                else context.page.querySelector('.deepstream-video-details')?.remove();
                if (!value) {context.page.querySelector('.deepstream-audio-details')?.remove(); enhancements?.cancelView(); spatial?.cancelView(); return;}
                const panel = panelFor(context.page);
                if (value) {
                    const select = context.page.querySelector('.selectAudio');
                    if (select) for (const option of select.options) {
                        const track = value.tracks.find(track => String(track.index) === option.value);
                        if (track && option.textContent !== track.text) option.textContent = track.text;
                    }
                }
                if (!panel) return;
                const spatialNode = panel.querySelector('.deepstream-spatial-control');
                for (const child of Array.from(panel.children)) if (child !== spatialNode) child.remove();
                const header = make('div', null, 'deepstream-audio-heading');
                header.append(make('h3', 'Audio'), make('span', value.title, 'deepstream-audio-badge'));
                panel.insertBefore(header, spatialNode);
                const grid = make('dl', null, 'deepstream-audio-grid');
                for (const [label, content] of value.rows) {
                    const field = make('div'); field.append(make('dt', label), make('dd', content)); grid.append(field);
                }
                panel.insertBefore(grid, spatialNode);
                const planned = make('div', null, 'deepstream-audio-route');
                const routeHeading = make('div', null, 'deepstream-audio-route-heading');
                routeHeading.append(make('strong', t('Wiedergabeweg')));
                const routeGrid = make('div', null, 'deepstream-audio-route-grid');
                for (const [label, content] of [[t('Tonspur'), value.selection + ' · ' + value.plannedTrack], [t('Verarbeitung'), t('Decodierung zu PCM')], [t('Ausgabe'), value.output]]) {
                    const field = make('div');
                    field.append(make('span', label, 'deepstream-audio-route-label'), make('p', content));
                    routeGrid.append(field);
                }
                planned.append(routeHeading, routeGrid,
                    make('small', t('Geplant vor dem Start. Die laufende Ausgabe steht in der Wiedergabeinfo.')));
                const decoder = make('details', null, 'deepstream-decoder-info');
                decoder.append(make('summary', t('Decoder') + ': ' + value.decoder), make('p', t('PCM ist der decodierte Ton, den macOS an das Ausgabegerät weitergibt.')));
                planned.append(decoder);
                if (['Movie', 'Episode'].includes(item.Type) && item.Id === context.id && source.Id) {
                    spatial?.attach({api: context.api, userId: context.userId, itemId: item.Id, sourceId: source.Id,
                        page: context.page, container: panel, language: context.language,
                        settings: context.settings, isCurrent: context.isCurrent});
                } else spatial?.cancelView();
                panel.append(planned);
                if (value.tracks.length > 1) {
                    const tracks = make('details'); tracks.append(make('summary', t('Alle Tonspuren') + ' (' + value.tracks.length + ')'));
                    const list = make('ul'); for (const track of value.tracks) list.append(make('li', track.text));
                    tracks.append(list); panel.append(tracks);
                }
                if (['Movie', 'Episode'].includes(item.Type) && item.Id === context.id && source.Id) {
                    enhancements?.attach({api: context.api, userId: context.userId, itemId: item.Id, sourceId: source.Id,
                        page: context.page, container: panel, language: context.language,
                        audioPlan: value.audioPlan, isCurrent: context.isCurrent});
                } else enhancements?.cancelView();
            },
            unavailable(context) {
                enhancements?.cancelView(); spatial?.cancelView();
                if (!context.page.querySelector('.selectAudio')?.options.length) {context.page.querySelector('.deepstream-audio-details')?.remove(); return;}
                const panel = panelFor(context.page);
                if (panel) panel.replaceChildren(make('p', locale.text('Audiodaten konnten nicht geladen werden.', context.language)));
            }
        });
        function refresh() {
            const id = routeId();
            const page = doc.querySelector('#itemDetailPage:not(.hide)');
            const api = win.ApiClient;
            if (!id || !page || !api?.getItem || !api.getCurrentUserId) {lastSignature = ''; loader.cancel(); enhancements?.cancelView(); spatial?.cancelView(); return;}
            const select = page.querySelector('.selectAudio');
            const sourceId = page.querySelector('.selectSource')?.value || '';
            const videoValue = page.querySelector('.selectVideo')?.value;
            const videoIndex = videoValue == null || videoValue === '' ? undefined : Number(videoValue);
            const selectedIndex = !select || select.value === '' ? undefined : Number(select.value);
            const settings = readSettings(win.jmpInfo?.settings?.audio, win.jmpInfo?.settings?.other);
            const userId = api.getCurrentUserId();
            const language = locale.language(win);
            const signature = [id, sourceId, selectedIndex, videoIndex, userId, language, JSON.stringify(settings)].join('|');
            if (signature === lastSignature && page === lastPage && api === lastApi) return;
            enhancements?.cancelView();
            lastSignature = signature; lastPage = page; lastApi = api;
            loader.update({id, page, api, userId, sourceId, selectedIndex, videoIndex, settings, language,
                isCurrent: () => page.isConnected && !page.classList.contains('hide') && routeId() === id && win.ApiClient === api && api.getCurrentUserId() === userId});
        }
        function schedule() {clearTimeout(timeout); timeout = setTimeout(refresh, 60);}
        function start() {
            doc.addEventListener('viewshow', schedule, true);
            doc.addEventListener('change', event => {
                if (event.target.matches?.('.selectAudio, .selectVideo, .selectSource')) {lastSignature = ''; loader.cancel(); enhancements?.cancelView(); spatial?.cancelView(); schedule();}
            }, true);
            win.addEventListener('hashchange', () => {
                lastSignature = ''; loader.cancel(); enhancements?.cancelView(); spatial?.cancelView();
                doc.querySelector('#itemDetailPage')?.classList.remove('deepstream-person-page');
                schedule();
            });
            new MutationObserver(records => {
                const languageChanged = records.some(r => r.target === doc.documentElement && r.attributeName === 'lang');
                const imageChanged = records.some(r => r.type === 'attributes' && r.target.matches?.('#itemBackdrop, .detailImageContainer .cardImageContainer, .backdropContainer .backdropImage'));
                if (languageChanged) lastSignature = '';
                if (routeId() && (imageChanged || languageChanged || records.some(r => r.type === 'childList' && !r.target.closest?.('.deepstream-media-details')))) schedule();
            }).observe(doc.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-src', 'lang']});
            win.jmpInfo?.settingsUpdate?.push(() => {lastSignature = ''; schedule();});
            schedule();
        }
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once: true});
        else start();
    }

    return Object.freeze({model, createLoader, install, rate, bitrate, readSettings, trackLabel, artworkSources, isMediaPage});
});
