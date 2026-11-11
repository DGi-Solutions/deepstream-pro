/* DeepStream Pro: source selection and explicit playback capabilities. */
(function (root, factory) {
    const engine = factory();
    if (typeof module === 'object' && module.exports) module.exports = engine;
    if (root) root.DeepStreamAudio = engine;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';

    const aliases = Object.freeze({
        'e-ac-3': 'eac3', 'ec-3': 'eac3', 'ddp': 'eac3',
        'ac-3': 'ac3', 'dca': 'dts', 'dts-hd': 'dts',
        'dts-hd ma': 'dts', 'dts-hd hra': 'dts'
    });
    const languageAliases = Object.freeze({de: 'deu', ger: 'deu', en: 'eng', fr: 'fra', fre: 'fra', es: 'spa'});
    const text = value => typeof value === 'string' ? value.trim() : '';
    const number = (value, maximum) => {
        const n = typeof value === 'number' || /^\d+$/.test(text(value)) ? Number(value) : 0;
        return Number.isFinite(n) && n >= 0 && n <= maximum ? n : 0;
    };
    const codec = value => {
        const name = text(value).toLowerCase();
        return Object.hasOwn(aliases, name) ? aliases[name] : name;
    };
    const language = value => {
        const name = text(value).toLowerCase().split(/[-_]/)[0];
        return Object.hasOwn(languageAliases, name) ? languageAliases[name] : (name === 'und' ? '' : name);
    };

    function describe(stream) {
        stream = stream && typeof stream === 'object' ? stream : {};
        const c = codec(stream.Codec);
        const profile = [stream.Profile, stream.CodecProfile].map(text).join(' ').toLowerCase();
        const spatial = text(stream.AudioSpatialFormat).toLowerCase().replace(/[^a-z0-9]/g, '');
        // Titles and DisplayTitles are user text, not codec detection results.
        const atmos = (c === 'truehd' || c === 'eac3') &&
            (spatial === 'dolbyatmos' || spatial === 'atmos' || /\batmos\b|\bjoc\b/.test(profile));
        const dtsx = c === 'dts' && (spatial === 'dtsx' || /\bdts[\s:_-]*x\b/.test(profile));
        const dtsMA = c === 'dts' && /\bma\b|master audio/.test(profile);
        const dtsHRA = c === 'dts' && /\bhra\b|high resolution/.test(profile);
        const lossless = ['truehd', 'mlp', 'flac', 'alac'].includes(c) || c.startsWith('pcm_') || c === 'pcm' || dtsMA;
        const baseNames = {truehd: 'Dolby TrueHD', mlp: 'MLP', eac3: 'Dolby Digital Plus', ac3: 'Dolby Digital', dts: 'DTS', flac: 'FLAC', alac: 'ALAC', aac: 'AAC', opus: 'Opus'};
        const label = atmos ? (c === 'truehd' ? 'TrueHD / Atmos' : 'Dolby Digital Plus / Atmos')
            : dtsx ? 'DTS:X' : dtsMA ? 'DTS-HD MA' : dtsHRA ? 'DTS-HD HRA'
            : (Object.hasOwn(baseNames, c) ? baseNames[c] : c.startsWith('pcm') ? 'PCM' : c.toUpperCase() || 'Unbekannt');
        return Object.freeze({
            codec: c, label, objectFormat: atmos ? 'atmos' : dtsx ? 'dtsx' : null,
            lossless, channels: number(stream.Channels, 64),
            bitDepth: number(stream.BitDepth, 64), sampleRate: number(stream.SampleRate, 768000),
            bitRate: number(stream.BitRate, 1000000000), language: language(stream.Language)
        });
    }

    function trackRole(stream) {
        const title = text(stream.Title);
        if (stream.IsAudioDescription === true || /audio description|audiodeskription|hörfilm/i.test(title)) return 'description';
        if (/\bcommentary\b|regiekommentar|audiokommentar|kommentarspur/i.test(title)) return 'commentary';
        return stream.IsHearingImpaired === true ? 'hearing-impaired' : 'main';
    }

    function canDecode(info, capabilities) {
        const decoders = capabilities && Array.isArray(capabilities.decoders) ? capabilities.decoders : [];
        return objectRoute(info, capabilities) || decoders.includes(info.codec) ||
            (info.codec === 'pcm' && decoders.some(x => text(x).startsWith('pcm_')));
    }

    function objectRoute(info, capabilities) {
        if (!info.objectFormat) return false;
        const routes = capabilities && Array.isArray(capabilities.objectAudioRoutes) ? capabilities.objectAudioRoutes : [];
        return routes.some(route => route && route.codec === info.codec && route.format === info.objectFormat &&
            route.available === true && route.preservesSpatialMetadata === true &&
            (!Array.isArray(route.sampleRates) || route.sampleRates.includes(info.sampleRate)));
    }

    function quality(info, capabilities) {
        const nativeObject = objectRoute(info, capabilities);
        const family = info.lossless ? 2 : 1;
        const preference = {truehd: 8, flac: 7, alac: 7, dts: 6, eac3: 5, ac3: 4, aac: 3, opus: 3};
        return [nativeObject ? 1 : 0, info.channels, family,
            info.lossless ? info.bitDepth : 0,
            info.lossless ? info.sampleRate : 0,
            Object.hasOwn(preference, info.codec) ? preference[info.codec] : 0,
            info.bitRate];
    }

    function compare(a, b) {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
        return 0;
    }

    function plan({streams, selectedIndex, mode = 'auto', playMethod = 'DirectPlay', capabilities = {}, failedIndices = []} = {}) {
        capabilities = capabilities && typeof capabilities === 'object' ? capabilities : {};
        const audio = (Array.isArray(streams) ? streams : []).filter(s => s && s.Type === 'Audio' &&
            !s.IsExternal && Number.isInteger(s.Index) && s.Index >= 0);
        const selected = audio.find(s => s.Index === selectedIndex) || audio.find(s => s.IsDefault === true) || audio[0];
        if (!selected || selectedIndex === -1) return Object.freeze({selectedIndex: -1, rankedIndices: [], reason: 'no_audio', source: null, nativeObjectRoute: false});
        const source = describe(selected);
        const original = reason => Object.freeze({selectedIndex: selected.Index, rankedIndices: [selected.Index], reason,
            source, nativeObjectRoute: objectRoute(source, capabilities)});
        if (mode !== 'auto') return original('manual');
        // A remux/transcode can contain only the server-selected stream.
        if (playMethod !== 'DirectPlay') return original('server_selected');
        if (capabilities.decoderEnumerationAvailable !== true) return original('capabilities_unknown');
        const pool = audio.filter(s => !failedIndices.includes(s.Index) &&
            language(s.Language) === source.language &&
            trackRole(s) === trackRole(selected) && canDecode(describe(s), capabilities));
        if (pool.length === 0) return original('no_supported_alternative');
        pool.sort((a, b) => compare(quality(describe(a), capabilities), quality(describe(b), capabilities)) ||
            (a.Index === selected.Index ? -1 : b.Index === selected.Index ? 1 : a.Index - b.Index));
        const chosen = pool[0];
        const info = describe(chosen);
        const nativeObjectRoute = objectRoute(info, capabilities);
        return Object.freeze({selectedIndex: chosen.Index, rankedIndices: pool.map(s => s.Index),
            reason: nativeObjectRoute ? 'native_object_audio' : info.lossless ? 'lossless_decode' : 'compatible_decode',
            source: info, nativeObjectRoute});
    }

    return Object.freeze({describe, plan, codec, language});
});
