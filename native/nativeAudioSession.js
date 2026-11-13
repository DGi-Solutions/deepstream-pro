/* Session-bound Apple audio playback. Authorization headers stay out of load options and storage.
 * Existing query parameters stay on the original ephemeral source URL; native code redacts URLs. */
(function (root, factory) {
    const adapter = factory();
    if (typeof module === 'object' && module.exports) module.exports = adapter;
    if (root) root.DeepStreamNativeAudio = adapter;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const instances = new WeakMap();
    const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : '';
    function baseUrl(value) {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
            return {base: url.origin + url.pathname.replace(/\/+$/, ''), origin: url.origin};
        } catch (_) { return null; }
    }
    function session(win) {
        try {
            const api = win.ApiClient;
            const server = baseUrl(typeof api?.serverAddress === 'function' ? api.serverAddress() : api?.serverAddress);
            const sdkServer = baseUrl(api?._sdk?.basePath);
            const authorization = api?._sdk?.authorizationHeader;
            const userId = id(api?.getCurrentUserId()), serverId = id(api?.serverId());
            if (!server || !sdkServer || server.base !== sdkServer.base || !userId || !serverId ||
                typeof authorization !== 'string' || !/^MediaBrowser\s+\S/.test(authorization) ||
                authorization.length > 16384 || /[\r\n\0]/.test(authorization)) return null;
            return {api, serverId, userId, serverBaseUrl: server.base, authorization};
        } catch (_) { return null; }
    }
    function sameSession(a, b) {
        return !!a && !!b && a.api === b.api && a.serverId === b.serverId && a.userId === b.userId &&
            a.serverBaseUrl === b.serverBaseUrl && a.authorization === b.authorization;
    }
    function sameVideoPath(a,b) {
        if(a.toLowerCase()===b.toLowerCase())return true;
        const x=a.split('/'),y=b.split('/');
        if(x.length!==y.length||x.length<4)return false;
        const pos=x.length-2, uuid=/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
        if(!uuid.test(x[pos])||!uuid.test(y[pos])||x[pos].replace(/-/g,'').toLowerCase()!==y[pos].replace(/-/g,'').toLowerCase())return false;
        return x.every((part,i)=>i===pos||part.toLowerCase()===y[i].toLowerCase());
    }
    const videoHlsV2 = 'deepstream-video-hls-v2';
    const v2ChannelLimits = Object.freeze({aac:2, ac3:6, eac3:8, flac:8, alac:8});
    function v2Capability(capabilities, codec) {
        const route = capabilities?.nativeDolbyVisionAudioHlsV2;
        return capabilities?.nativeDolbyVisionHlsAvailable === true && route !== null && typeof route === 'object' &&
            !Array.isArray(route) && route.available === true && Array.isArray(route.codecs) && route.codecs.includes(codec);
    }
    function v2AudioCodec(track) {
        if (!track || track.IsExternal !== false || typeof track.Codec !== 'string' ||
            !Number.isInteger(track.Channels) || track.Channels < 1) return '';
        const codec = track.Codec.toLowerCase();
        if (!Object.hasOwn(v2ChannelLimits, codec) || track.Channels > v2ChannelLimits[codec] ||
            (codec === 'aac' && String(track.Profile).toLowerCase() !== 'lc')) return '';
        return codec;
    }
    function v2Video(source) {
        const videos = (source.MediaStreams || []).filter(stream => stream.Type === 'Video');
        if (videos.length !== 1) return null;
        const video = videos[0], range = video.VideoRangeType;
        if (video.IsExternal !== false || video.IsInterlaced !== false || String(video.Codec).toLowerCase() !== 'hevc' ||
            video.BitDepth !== 10 || !Number.isInteger(video.DvLevel) || video.DvLevel < 1 || video.DvLevel > 13 ||
            video.RpuPresentFlag !== 1 || video.BlPresentFlag !== 1 || video.ElPresentFlag !== 0) return null;
        const supported = (range === 'DOVI' && video.DvProfile === 5) ||
            (range === 'DOVIWithHDR10' && video.DvProfile === 8) || (range === 'DOVIWithHLG' && video.DvProfile === 8);
        return supported ? video : null;
    }

    function hlsSelection(options, current, contract = 'deepstream-audio-hls-v1') {
        try {
            if (!current || !options || !['Transcode', 'DirectStream'].includes(options.playMethod) ||
                !id(options.item?.Id) || options.item?.ServerId !== current.serverId ||
                !id(options.mediaSource?.Id) || !id(options.playSessionId) ||
                (options.mediaSource.DefaultSubtitleStreamIndex ?? -1) !== -1) return null;
            const videoRoute = contract === 'deepstream-video-hls-v1';
            const videoRouteV2 = contract === videoHlsV2;
            if (!videoRoute && !videoRouteV2 && contract !== 'deepstream-audio-hls-v1') return null;
            const index = options.mediaSource.DefaultAudioStreamIndex;
            if (!Number.isInteger(index) || index < 0) return null;
            const tracks = (options.mediaSource.MediaStreams || []).filter(s => s.Type === 'Audio' && s.Index === index);
            if (tracks.length !== 1) return null;
            const track = tracks[0];
            const selectedCodec = String(track.Codec).toLowerCase();
            if (videoRouteV2) {
                if (!v2AudioCodec(track)) return null;
            } else {
                if (videoRoute ? track.IsExternal !== false : !!track.IsExternal) return null;
                if (videoRoute) {
                    if (!Number.isInteger(track.Channels) || track.Channels < 1 ||
                        (selectedCodec === 'aac' ? track.Channels > 2 || String(track.Profile).toLowerCase() !== 'lc' :
                         selectedCodec !== 'eac3' || track.Channels > 8)) return null;
                } else if (selectedCodec !== 'eac3') return null;
            }
            const video = videoRouteV2 ? v2Video(options.mediaSource) : null;
            if (videoRouteV2 && !video) return null;
            const url = new URL(options.url), params = new Map();
            const expected = new URL(current.serverBaseUrl + '/Videos/' + encodeURIComponent(options.item.Id) + '/master.m3u8');
            if (url.origin !== expected.origin || url.username || url.password || url.hash ||
                !sameVideoPath(url.pathname, expected.pathname)) return null;
            for (const [key, value] of url.searchParams) {
                const normalized = key.toLowerCase();
                if (params.has(normalized)) return null;
                params.set(normalized, value);
            }
            if (params.get('mediasourceid') !== options.mediaSource.Id ||
                params.get('playsessionid') !== options.playSessionId ||
                params.get('audiostreamindex') !== String(index)) return null;
            const audioCodec = (params.get('audiocodec') || '').toLowerCase();
            if (audioCodec !== selectedCodec || params.get('allowaudiostreamcopy')?.toLowerCase() !== 'true') return null;
            if (videoRouteV2 && (params.get('allowvideostreamcopy')?.toLowerCase() !== 'true' ||
                (params.get('videocodec') || '').toLowerCase() !== String(video.Codec).toLowerCase())) return null;
            // Copy intent is not JOC-output evidence. Reject constraints that force a re-encode.
            for (const [key, field] of [['maxaudiochannels', 'Channels'], ['audiochannels', 'Channels'], ['audiobitrate', 'BitRate']]) {
                if (params.has(key) && (!Number.isFinite(Number(params.get(key))) || !Number.isFinite(track[field]) ||
                    Number(params.get(key)) < track[field])) return null;
            }
            if (params.has('audiosamplerate') && Number(params.get('audiosamplerate')) !== track.SampleRate) return null;
            const spatial = [track.Profile, track.CodecProfile, track.AudioSpatialFormat]
                .some(value => typeof value === 'string' && /\bjoc\b|\batmos\b|dolbyatmos/i.test(value)) ? 'joc' : 'unknown';
            return Object.freeze({mediaSourceId: options.mediaSource.Id, audioStreamIndex: index, codec: audioCodec, ...(videoRoute || videoRouteV2 ? {channels:track.Channels} : {}), spatial});
        } catch (_) { return null; }
    }
    function create(win) {
        if (instances.has(win)) return instances.get(win);
        const native = win.api?.player;
        if (!native || typeof native.bindNativeAudioSession !== 'function' ||
            typeof native.clearNativeAudioSession !== 'function' || typeof native.nativeAudioSessionBindingResult?.connect !== 'function') return null;
        let binding = null, pending = null, generation = 0, disposed = false;
        const cancel = new Set();
        function clear() {
            generation++;
            binding = null;
            pending = null;
            for (const finish of [...cancel]) finish(null);
            try { native.clearNativeAudioSession(); } catch (_) { /* No session remains usable in JS. */ }
        }
        function nativeBinding(snapshot, contract) {
            if (sameSession(binding?.snapshot, snapshot) && binding?.contract === contract) return Promise.resolve(binding.id);
            if (sameSession(pending?.snapshot, snapshot) && pending?.contract === contract) return pending.promise;
            clear();
            const requestGeneration = generation;
            const promise = new Promise(resolve => {
                let requestedId = null, settled = false;
                const early = new Map();
                const finish = value => {
                    if (settled) return;
                    settled = true;
                    win.clearTimeout(timer);
                    cancel.delete(finish);
                    try { native.nativeAudioSessionBindingResult.disconnect(onResult); } catch (_) { /* Already disconnected. */ }
                    if (value && requestGeneration === generation && sameSession(snapshot, session(win))) {
                        binding = {id: value, snapshot, contract};
                        resolve(value);
                    } else resolve(null);
                };
                const onResult = (bindingId, accepted) => {
                    if (typeof bindingId !== 'string' || bindingId.length > 256 || typeof accepted !== 'boolean') return;
                    if (requestedId === null) {
                        if (early.size < 8) early.set(bindingId, accepted);
                    } else if (bindingId === requestedId) finish(accepted ? bindingId : null);
                };
                const timer = win.setTimeout(() => {
                    if (requestGeneration === generation) clear();
                    else finish(null);
                }, 12000);
                cancel.add(finish);
                try {
                    native.nativeAudioSessionBindingResult.connect(onResult);
                    native.bindNativeAudioSession({serverId: snapshot.serverId, userId: snapshot.userId,
                        serverBaseUrl: snapshot.serverBaseUrl, authorization: snapshot.authorization, contract}, bindingId => {
                        if (typeof bindingId !== 'string' || !bindingId || bindingId.length > 256) { finish(null); return; }
                        requestedId = bindingId;
                        if (early.has(bindingId)) finish(early.get(bindingId) ? bindingId : null);
                    });
                } catch (_) { finish(null); }
            });
            pending = {snapshot, promise, contract};
            promise.then(() => { if (pending?.promise === promise) pending = null; });
            return promise;
        }
        const poll = win.setInterval(() => {
            if ((binding && !sameSession(binding.snapshot, session(win))) ||
                (pending && !sameSession(pending.snapshot, session(win)))) clear();
        }, 500);
        poll?.unref?.();
        const pagehide = () => clear();
        win.addEventListener?.('pagehide', pagehide);
        const controller = Object.freeze({
            async requestForPlayback(options, capabilities) {
                const contract = options?.mediaSource?.DeepStreamNativeAudioRequest?.contract || 'deepstream-audio-hls-v1';
                const videoRoute = contract === 'deepstream-video-hls-v1';
                const videoRouteV2 = contract === videoHlsV2;
                const selectedV2Codec = () => {
                    try {
                        const index = options?.mediaSource?.DefaultAudioStreamIndex;
                        const tracks = (options?.mediaSource?.MediaStreams || [])
                            .filter(s => s.Type === 'Audio' && s.Index === index);
                        return tracks.length === 1 ? String(tracks[0].Codec).toLowerCase() : '';
                    } catch (_) { return ''; }
                };
                const markerValid = () => {
                    const marker = options?.mediaSource?.DeepStreamNativeAudioRequest;
                    return marker?.contract === videoHlsV2 &&
                        marker.itemId === options?.item?.Id &&
                        marker.sourceId === options?.mediaSource?.Id &&
                        marker.audioIndex === options?.mediaSource?.DefaultAudioStreamIndex &&
                        marker.playSessionId === options?.playSessionId;
                };
                const permitted = () => {
                    if (videoRouteV2) return markerValid() && v2Capability(capabilities, selectedV2Codec());
                    return videoRoute ? capabilities?.nativeDolbyVisionHlsAvailable === true :
                        capabilities?.nativeAudioHlsAvailable === true && win.jmpInfo?.settings?.audio?.spatialAudio === true;
                };
                if (disposed || !permitted()) return null;
                const snapshot = session(win), selection = hlsSelection(options, snapshot, contract);
                const sourceUrl = options?.url, playSessionId = options?.playSessionId;
                if (!selection) return null;
                const bindingId = await nativeBinding(snapshot, contract);
                if (!bindingId || disposed || !sameSession(snapshot, session(win)) ||
                    !permitted()) return null;
                // Re-check mutable playback options after asynchronous native validation.
                const actual = hlsSelection(options, snapshot, contract);
                if (!actual || options.url !== sourceUrl || options.playSessionId !== playSessionId ||
                    JSON.stringify(actual) !== JSON.stringify(selection)) return null;
                return Object.freeze({enabled: true, contract, bindingId,
                    sourceUrl: options.url, selection, playSessionId: options.playSessionId});
            },
            clear,
            dispose() {
                disposed = true;
                clear();
                win.clearInterval(poll);
                win.removeEventListener?.('pagehide', pagehide);
                instances.delete(win);
            }
        });
        instances.set(win, controller);
        return controller;
    }
    return Object.freeze({create, hlsSelection, sessionChanged(win) { instances.get(win)?.clear(); }});
});
