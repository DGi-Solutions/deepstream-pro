const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const engine = require('../native/audioEngine.js');
const locale = require('../native/locale.js');

const caps = {decoderEnumerationAvailable: true, decoders: ['truehd', 'eac3', 'ac3'], objectAudioRoutes: []};
const streams = [
    {Index: 0, Type: 'Video'},
    {Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'deu', Channels: 6},
    {Index: 7, Type: 'Subtitle'},
    {Index: 9, Type: 'Audio', Codec: 'truehd', Language: 'deu', Channels: 8},
    {Index: 11, Type: 'Audio', Codec: 'truehd', Language: 'eng', Channels: 8},
    {Index: 15, Type: 'Subtitle', IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: '/synthetic-subtitle.srt'}
];

function setup(nativeOverrides = {}, mode = 'auto', language = 'de') {
    const calls = [];
    const events = [];
    const signal = () => {
        const listeners = new Set();
        return {connect: fn => listeners.add(fn), disconnect: fn => listeners.delete(fn),
            emit: (...args) => [...listeners].forEach(fn => fn(...args))};
    };
    const native = {
        getAudioCapabilities: callback => callback(caps),
        getAudioSignalPath: callback => callback({outputDriver: 'avfoundation', output: {'channel-count': 8, samplerate: 48000}, objectRenderingConfirmed: false}),
        load: (...args) => {calls.push(['load', ...args.slice(0, -1)]); args.at(-1)();},
        setAudioStream: index => calls.push(['audio', index]),
        setSubtitleStream: index => calls.push(['subtitle', index]),
        setVolume: value => calls.push(['volume', value]),
        setMuted: value => calls.push(['muted', value]),
        setVideoRectangle() {},
        nativeWindowStopped: signal(), nativeAudioStateChanged: signal(),
        playing: signal(), positionUpdate: signal(), finished: signal(), updateDuration: signal(),
        error: signal(), paused: signal(), bufferedRangesUpdated: signal(),
        stop: () => calls.push(['stop']),
        ...nativeOverrides
    };
    const context = vm.createContext({
        window: {api: {player: native}, crypto: webcrypto, DeepStreamAudio: engine, DeepStreamLocale: locale,
            document: {documentElement: {lang: language}}, jmpInfo: {settings: {audio: {streamSelection: mode}}}},
        jmpInfo: {userAgent: 'DeepStream test'},
        setTimeout, clearTimeout,
        URL,
        console: {log() {}, debug() {}, error() {}},
        document: {body: {classList: {remove() {}}}, createElement: () => ({setAttribute() {}, protocol: 'http:'})}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/mpvVideoPlayer.js'), 'utf8'), context);
    const player = Object.create(context.window._mpvVideoPlayer.prototype);
    player.events = {trigger: (...args) => events.push(args)};
    player.globalize = {translate: x => x};
    return {player, native, calls, events, win: context.window};
}

const options = (overrides = {}) => ({
    url: 'http://test.invalid/synthetic.mkv', playMethod: 'DirectPlay', item: {},
    playerStartPositionTicks: 125000000,
    mediaSource: {MediaStreams: streams, DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: 7},
    ...overrides
});

(async () => {
    let {player, calls} = setup();
    const item = options();
    await player.setCurrentSrc(null, item);
    assert.equal(calls[0][4], 2, 'Jellyfin index 9 must map to mpv audio track 2');
    assert.equal(calls[0][5], 1, 'subtitle selection must survive audio selection');
    assert.equal(calls[0][2].startMilliseconds, 12500, 'resume position must survive audio selection');
    assert.equal(item.mediaSource.DefaultAudioStreamIndex, 9);
    player.setAudioStreamIndex(2);
    assert.deepEqual(calls.at(-1), ['audio', 1]);
    assert.equal(player._audioPlan.reason, 'manual');
    assert.equal(player._audioPlan.selectedIndex, 2);
    const stats = await player.getStats();
    const audioStats = stats.categories.find(c => c.type === 'audio').stats;
    assert.equal(audioStats.find(s => s.label === 'Ausgabekanäle').value, '8');
    assert.equal(audioStats.find(s => s.label === 'Objektwiedergabe').value, 'Nicht bestätigt');

    const avPath = {
        backend: 'avplayer', engine: 'AVPlayer', outputDriver: 'AVFoundation',
        sourceEvidence: {status: 'manifest-single-joc-selected'}, objectRenderingConfirmed: false,
        // Defensive case: these fields from an old backend must never appear.
        decoder: 'old-mpv-decoder', decoded: {'channel-count': 8},
        output: {'channel-count': 2, samplerate: 48000, format: 'old-mpv-pcm'}
    };
    for (const language of ['de', 'en']) {
        ({player} = setup({getAudioSignalPath: callback => callback(avPath)}, 'auto', language));
        await player.setCurrentSrc(null, options());
        const appleStats = await player.getStats();
        const all = appleStats.categories.flatMap(c => c.stats);
        const values = all.map(s => s.value);
        assert.ok(values.includes('Apple AVPlayer'));
        assert.ok(values.includes('AVFoundation'));
        assert.ok(values.some(v => v.startsWith('E-AC-3 / JOC')));
        assert.ok(values.includes(language === 'de' ? 'Nicht bestätigt' : 'Not confirmed'), 'JOC source evidence is not object-renderer evidence');
        for (const value of ['old-mpv-decoder', 'old-mpv-pcm', '8', '2', '48000 Hz']) assert.ok(!values.includes(value));
        assert.ok(!all.some(s => s.label === 'Gewählte Tonspur' || s.label === 'Selected audio track'), 'mpv selection plan is not AV selection');
        assert.ok(all.some(s => s.label === (language === 'de' ? 'Audioquelle im Stream' : 'Audio source in the stream')));
    }
    ({player} = setup({getAudioSignalPath: callback => callback({...avPath, sourceEvidence: {status: 'unknown'}, objectRenderingConfirmed: 'true'})}));
    await player.setCurrentSrc(null, options());
    const unknownStats = (await player.getStats()).categories.flatMap(c => c.stats);
    assert.equal(unknownStats.find(s => s.label === 'Audioquelle im Stream').value, 'Noch nicht geprüft');
    assert.equal(unknownStats.find(s => s.label === 'Objektwiedergabe').value, 'Nicht bestätigt');

    ({player} = setup({getAudioSignalPath: callback => callback({...avPath,
        sourceEvidence: {status: 'fixture_joc_declared', availableAudioOptions: 1, selectedAudioOptions: 1}})}));
    await player.setCurrentSrc(null, options());
    const declared = (await player.getStats()).categories.flatMap(c => c.stats);
    assert.equal(declared.find(s => s.label === 'Audioquelle im Stream').value, 'E-AC-3 / JOC · Testquelle');
    assert.equal(declared.find(s => s.label === 'Ausgewählte Tonspuren').value, '1 / 1');
    assert.equal(declared.find(s => s.label === 'Objektwiedergabe').value, 'Nicht bestätigt');
    ({player} = setup({getAudioSignalPath: callback => callback({})}));
    await player.setCurrentSrc(null, options());
    assert.ok(!(await player.getStats()).categories.flatMap(c => c.stats).some(s => s.label === 'Wiedergabe-Engine'), 'missing native reply is not mpv evidence');

    for (const language of ['de', 'en']) {
        ({player} = setup({getAudioSignalPath: callback => callback(avPath),
            getVideoSignalPath: callback => callback({backend:'avplayer',status:'dv-track-record',outputConfirmed:false})}, 'auto', language));
        await player.setCurrentSrc(null, options());
        const video = (await player.getStats()).categories.find(c => c.type === 'video').stats;
        const label = language === 'de' ? 'Dolby-Vision-Ausgabe' : 'Dolby Vision output';
        assert.equal(video.find(s => s.label === label).value, language === 'de' ? 'Nicht bestätigt' : 'Not confirmed');
        assert.ok(video.some(s => s.label === (language === 'de' ? 'Videospur' : 'Video track')));
    }
    let pendingVideo;
    ({player} = setup({getAudioSignalPath: callback => callback(avPath), getVideoSignalPath: callback => {pendingVideo=callback;}}));
    await player.setCurrentSrc(null, options());
    const priorVideoStats=player.getStats();
    await new Promise(resolve => setTimeout(resolve, 0));
    await player.setCurrentSrc(null, options({url:'http://test.invalid/new-synthetic.mkv'}));
    pendingVideo({backend:'avplayer',status:'dv-track-record'});
    assert.equal((await priorVideoStats).categories.length,0,'late video evidence cannot describe a new source');

    let staleVideo;
    ({player} = setup({getAudioSignalPath: callback => callback(avPath),
        getVideoSignalPath: callback => {staleVideo=callback;}}));
    await player.setCurrentSrc(null, options());
    const priorSubtitleStats=player.getStats();
    await new Promise(resolve => setTimeout(resolve, 0));
    player.setSubtitleStreamIndex(-1);
    staleVideo({backend:'avplayer',status:'unknown'});
    assert.equal((await priorSubtitleStats).categories.length,0,'late video evidence must be discarded when subtitles change even without source evidence');

    let signalCallback;
    ({player} = setup({getAudioSignalPath: callback => {signalCallback = callback;}}));
    await player.setCurrentSrc(null, options());
    const oldStats = player.getStats();
    await player.setCurrentSrc(null, options({url: 'http://test.invalid/next-synthetic.mkv'}));
    signalCallback(avPath);
    assert.equal((await oldStats).categories.length, 0, 'late statistics must not describe the next source');

    ({player} = setup({getAudioSignalPath: callback => {signalCallback = callback;}}));
    await player.setCurrentSrc(null, options());
    const stoppedStats = player.getStats();
    await player.stop(false);
    signalCallback(avPath);
    assert.equal((await stoppedStats).categories.length, 0, 'stop cancels pending statistics');

    ({player} = setup({getAudioSignalPath: callback => {signalCallback = callback;}}));
    await player.setCurrentSrc(null, options());
    const switchedStats = player.getStats();
    player.setAudioStreamIndex(2);
    signalCallback(avPath);
    assert.equal((await switchedStats).categories.length, 0, 'manual track change cancels pending statistics');

    // The experimental v2 path must never change the existing TrueHD direct-play route.
    const v2Caps = () => ({...caps, nativeDolbyVisionHlsAvailable:true,
        nativeDolbyVisionAudioHlsV2:{available:true, codecs:['flac']}});
    const directTrueHd = setup({getAudioCapabilities: callback => callback(v2Caps())});
    await directTrueHd.player.setCurrentSrc(null, options());
    assert.equal(directTrueHd.calls[0][2].nativeAudioHls, undefined, 'TrueHD Direct Play must stay on its existing route');
    assert.equal(directTrueHd.calls[0][4], 2, 'the chosen TrueHD track must remain selected');
    const v2Options = () => options({url:'https://server.invalid/Videos/item/master.m3u8', playMethod:'Transcode',
        item:{Id:'item'}, playSessionId:'play', mediaSource:{Id:'source', DefaultAudioStreamIndex:2,
        DefaultSubtitleStreamIndex:-1, MediaStreams:[
            {Index:1,Type:'Video',Codec:'hevc',DvProfile:8,DvBlSignalCompatibilityId:1,VideoRangeType:'DOVIWithHDR10'},
            {Index:2,Type:'Audio',Codec:'flac',Channels:8,Language:'deu'}],
        DeepStreamNativeAudioRequest:{contract:'deepstream-video-hls-v2',itemId:'item',sourceId:'source',audioIndex:2,playSessionId:'play'}}});
    const v2Request = (input, contract='deepstream-video-hls-v2') => ({enabled:true,contract,bindingId:'binding',
        sourceUrl:input.url,playSessionId:input.playSessionId,
        selection:{mediaSourceId:'source',audioStreamIndex:2,codec:'flac',channels:8,spatial:'unknown'}});
    const v2Player = setup({getAudioCapabilities: callback => callback(v2Caps())});
    v2Player.win.DeepStreamNativeAudio = {create:()=>({clear(){}, requestForPlayback:async input=>v2Request(input)})};
    await v2Player.player.setCurrentSrc(null,v2Options());
    assert.equal(v2Player.calls[0][2].nativeAudioHls.contract,'deepstream-video-hls-v2');
    assert.equal(v2Player.calls[0][2].nativeAudioHls.selection.codec,'flac');
    const missingV2 = setup({getAudioCapabilities: callback => callback({...caps,nativeDolbyVisionHlsAvailable:true})});
    await assert.rejects(missingV2.player.setCurrentSrc(null,v2Options()), /Requested audio output is unavailable/);
    assert.ok(!missingV2.calls.some(c=>c[0]==='load'),'unadvertised v2 capability must not start');
    let finishV2;
    const changingV2Caps = v2Caps();
    const changingV2 = setup({getAudioCapabilities: callback => callback(changingV2Caps)});
    changingV2.win.DeepStreamNativeAudio={create:()=>({clear(){},requestForPlayback:input=>new Promise(resolve=>{finishV2=()=>resolve(v2Request(input));})})};
    const pendingV2=changingV2.player.setCurrentSrc(null,v2Options());
    await new Promise(resolve=>setImmediate(resolve));
    changingV2Caps.nativeDolbyVisionAudioHlsV2.codecs=[];finishV2();
    await assert.rejects(pendingV2,/Requested audio output is unavailable/);
    assert.ok(!changingV2.calls.some(c=>c[0]==='load'),'revoked v2 capability must stop the load');
    const wrongContract = setup({getAudioCapabilities:callback=>callback(v2Caps())});
    wrongContract.win.DeepStreamNativeAudio={create:()=>({clear(){},requestForPlayback:async input=>v2Request(input,'deepstream-audio-hls-v1')})};
    await assert.rejects(wrongContract.player.setCurrentSrc(null,v2Options()),/Requested audio output is unavailable/);
    assert.ok(!wrongContract.calls.some(c=>c[0]==='load'),'a v2 marker cannot admit a different session contract');

    const nativeHlsCaps = {getAudioCapabilities: callback => callback({...caps, nativeAudioHlsAvailable: true})};
    let prepared, finishBinding, nativeClears = 0;
    const nativeSetup = setup(nativeHlsCaps);
    nativeSetup.win.DeepStreamDolbyVisionSession = require('../native/dolbyVisionSessionBridge.js');
    nativeSetup.native.getVideoSignalPath = callback => callback({backend:'avplayer', status:'unknown', outputConfirmed:false,
        hlsOffered:{status:'offered-manifest-only', variantCount:2, dv5Count:0, dv81Count:1, dv84Count:0, selected:'unknown', outputConfirmed:false},
        hlsLastObserved:{status:'last-access-log-declaration',mode:'8.1',outputConfirmed:false}});
    nativeSetup.win.DeepStreamNativeAudio = {create: () => ({clear() {nativeClears++;}, requestForPlayback: async input => {
        prepared = input;
        return {enabled: true, contract: 'deepstream-audio-hls-v1', bindingId: 'synthetic-binding',
            sourceUrl: input.url, playSessionId: input.playSessionId,
            selection: {mediaSourceId: input.mediaSource.Id, audioStreamIndex: input.mediaSource.DefaultAudioStreamIndex, codec: 'eac3', spatial: 'unknown'}};
    }})};
    const deliveredHls = options({url: 'https://server.invalid/Videos/item/master.m3u8', playMethod: 'Transcode', playSessionId: 'synthetic-play',
        mediaSource: {Id: 'synthetic-source', MediaStreams: [
            {Index: 1, Type: 'Video', Codec:'hevc', DvProfile:8, DvBlSignalCompatibilityId:1, VideoRangeType:'DOVIWithHDR10'},
            {Index: 2, Type: 'Audio', Codec: 'eac3', Language: 'deu'}],
            DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: -1}});
    const beforeHls = JSON.stringify(deliveredHls);
    await nativeSetup.player.setCurrentSrc(null, deliveredHls);
    assert.equal(prepared, deliveredHls);
    assert.equal(nativeSetup.calls[0][1], deliveredHls.url, 'negotiated URL and reporting session stay unchanged');
    assert.equal(nativeSetup.calls[0][2].nativeAudioHls.playSessionId, 'synthetic-play');
    assert.equal(nativeSetup.calls[0][2].nativeAudioHls.selection.audioStreamIndex, 2);
    const firstNativeToken = nativeSetup.calls[0][2].nativeControlToken;
    assert.match(firstNativeToken, /^[0-9a-f]{32}$/, 'native control token is 16 random bytes in lowercase hex');
    assert.equal(nativeSetup.calls[0][4], 1, 'delivered HLS has one selected audio track');
    assert.equal(JSON.stringify(deliveredHls), beforeHls);
    assert.deepEqual(Object.keys(nativeSetup.calls[0][3].headers), [], 'native credentials are not copied into load metadata');
    const dvStats=(await nativeSetup.player.getStats()).categories.find(c=>c.type==='video').stats;
    assert.equal(dvStats.find(s=>s.label==='Dolby-Vision-Quelldeklaration').value,'8.1');
    assert.equal(dvStats.find(s=>s.label==='Dolby-Vision-Ausgabe').value,'Nicht bestätigt');
    assert.equal(dvStats.find(s=>s.label==='Dolby-Vision-Angebot im Stream').value,'8.1');
    assert.equal(dvStats.find(s=>s.label==='Zuletzt beobachtete HLS-Variante').value,'Dolby Vision 8.1');
    const controlCalls = nativeSetup.calls.length;
    nativeSetup.native.nativeAudioStateChanged.emit('stale-token', 12, true);
    nativeSetup.native.nativeAudioStateChanged.emit(firstNativeToken, 101, true);
    nativeSetup.native.nativeAudioStateChanged.emit(firstNativeToken, 12, 'true');
    assert.equal(nativeSetup.events.filter(e => e[1] === 'volumechange').length, 0, 'stale or invalid audio state is ignored');
    nativeSetup.native.nativeAudioStateChanged.emit(firstNativeToken, 12, true);
    assert.equal(nativeSetup.player.getVolume(), 12);
    assert.equal(nativeSetup.player.isMuted(), true);
    assert.equal(nativeSetup.events.filter(e => e[1] === 'volumechange').length, 1);
    assert.equal(nativeSetup.calls.length, controlCalls, 'native audio state does not write back to native');
    nativeSetup.native.nativeAudioStateChanged.emit(firstNativeToken, 12, true);
    assert.equal(nativeSetup.events.filter(e => e[1] === 'volumechange').length, 1, 'unchanged state does not emit duplicates');
    nativeSetup.player.setAudioStreamIndex(9);
    assert.equal(nativeSetup.calls.length, controlCalls, 'another server audio track is not silently mapped to track one');
    const switchedDv=(await nativeSetup.player.getStats()).categories.find(c=>c.type==='video').stats;
    assert.ok(!switchedDv.some(s=>s.label==='Dolby-Vision-Quelldeklaration'));
    assert.ok(!switchedDv.some(s=>s.label==='Dolby-Vision-Angebot im Stream'));
    const trackError = nativeSetup.events.find(e => e[1] === 'error');
    assert.ok(trackError, 'unavailable track change emits an explicit playback error');
    assert.equal(trackError[2][0].streamInfo.mediaSource.SupportsTranscoding, false);
    assert.equal(nativeSetup.player._audioTrackIndexToSetOnPlaying, 2, 'failed switch retains the source selection');
    nativeSetup.native.nativeWindowStopped.emit('stale-token');
    assert.equal(nativeSetup.events.filter(e => e[1] === 'stopped').length, 0);
    nativeSetup.native.nativeWindowStopped.emit(firstNativeToken);
    nativeSetup.native.nativeWindowStopped.emit(firstNativeToken);
    assert.equal(nativeSetup.events.filter(e => e[1] === 'stopped').length, 1, 'native close ends one session exactly once');
    assert.equal(nativeSetup.player.currentSrc(), null);
    await nativeSetup.player.stop(false);
    assert.equal(nativeSetup.events.filter(e => e[1] === 'stopped').length, 1, 'JS stop after native close does not duplicate stop');
    nativeSetup.native.getAudioCapabilities = callback => callback(caps);
    await nativeSetup.player.setCurrentSrc(null, options());
    assert.equal(nativeClears, 1, 'fallback clears the previous native binding before losing its controller');
    assert.equal(nativeSetup.calls.at(-1)[2].nativeAudioHls, undefined);
    const noCrypto = setup(nativeHlsCaps);
    noCrypto.win.crypto = undefined;
    noCrypto.win.DeepStreamNativeAudio = {create: () => ({clear() {}, requestForPlayback: async input => ({
        enabled: true, contract: 'deepstream-audio-hls-v1', bindingId: 'binding', sourceUrl: input.url,
        playSessionId: input.playSessionId, selection: {mediaSourceId: input.mediaSource.Id,
            audioStreamIndex: input.mediaSource.DefaultAudioStreamIndex, codec: 'eac3', spatial: 'unknown'}})})};
    await assert.rejects(noCrypto.player.setCurrentSrc(null, options({url: deliveredHls.url, playMethod: 'Transcode',
        playSessionId: 'synthetic-play', mediaSource: {...deliveredHls.mediaSource}})), /Requested audio output is unavailable/);
    assert.ok(!noCrypto.calls.some(c => c[0] === 'load'), 'native HLS is rejected without secure random bytes');

    const invalidSignals = setup({...nativeHlsCaps, nativeAudioStateChanged: undefined});
    invalidSignals.win.DeepStreamNativeAudio = noCrypto.win.DeepStreamNativeAudio;
    await assert.rejects(invalidSignals.player.setCurrentSrc(null, options({url: deliveredHls.url, playMethod: 'Transcode',
        playSessionId: 'synthetic-play', mediaSource: {...deliveredHls.mediaSource}})), /Requested audio output is unavailable/);
    assert.ok(!invalidSignals.calls.some(c => c[0] === 'load'), 'native HLS is rejected without its control signals');

    const generations = setup(nativeHlsCaps);
    generations.win.DeepStreamNativeAudio = noCrypto.win.DeepStreamNativeAudio;
    const nextHls = () => options({url: deliveredHls.url, playMethod: 'Transcode', playSessionId: 'synthetic-play',
        mediaSource: {...deliveredHls.mediaSource}});
    await generations.player.setCurrentSrc(null, nextHls());
    const oldToken = generations.calls.at(-1)[2].nativeControlToken;
    await generations.player.setCurrentSrc(null, nextHls());
    const newToken = generations.calls.at(-1)[2].nativeControlToken;
    assert.notEqual(oldToken, newToken);
    generations.native.nativeWindowStopped.emit(oldToken);
    generations.native.nativeAudioStateChanged.emit(oldToken, 1, true);
    assert.equal(generations.events.filter(e => e[1] === 'stopped' || e[1] === 'volumechange').length, 0,
        'old session signals cannot alter the new playback');
    await generations.player.stop(false);
    generations.native.nativeWindowStopped.emit(newToken);
    assert.equal(generations.events.filter(e => e[1] === 'stopped').length, 1, 'native close after JS stop is ignored');

    const destroyed = setup(nativeHlsCaps);
    destroyed.win.DeepStreamNativeAudio = noCrypto.win.DeepStreamNativeAudio;
    await destroyed.player.setCurrentSrc(null, nextHls());
    const destroyedToken = destroyed.calls.at(-1)[2].nativeControlToken;
    destroyed.player.destroy();
    destroyed.native.nativeWindowStopped.emit(destroyedToken);
    destroyed.native.nativeAudioStateChanged.emit(destroyedToken, 1, true);
    assert.equal(destroyed.events.filter(e => e[1] === 'stopped' || e[1] === 'volumechange').length, 0,
        'destroy disconnects native control signals and invalidates the token');

    let lateNativeLoad;
    const closeDuringLoad = setup({...nativeHlsCaps, load: (...args) => {lateNativeLoad = args;}});
    closeDuringLoad.win.DeepStreamNativeAudio = noCrypto.win.DeepStreamNativeAudio;
    const closeDuringLoadPromise = closeDuringLoad.player.setCurrentSrc(null, nextHls());
    await new Promise(resolve => setImmediate(resolve));
    closeDuringLoad.native.nativeWindowStopped.emit(lateNativeLoad[1].nativeControlToken);
    lateNativeLoad.at(-1)(false);
    await closeDuringLoadPromise;
    assert.equal(closeDuringLoad.events.filter(e => e[1] === 'stopped').length, 1,
        'native close invalidates a late failed load without a duplicate stop or error');

    let disconnected = 0;
    const failedConnection = setup({...nativeHlsCaps,
        nativeWindowStopped: {connect() {}, disconnect() {disconnected++;}},
        nativeAudioStateChanged: {connect() {throw new Error('channel unavailable');}, disconnect() {}}});
    failedConnection.win.DeepStreamNativeAudio = noCrypto.win.DeepStreamNativeAudio;
    await assert.rejects(failedConnection.player.setCurrentSrc(null, nextHls()), /Requested audio output is unavailable/);
    assert.equal(disconnected, 1, 'partially connected native signal is rolled back');
    assert.ok(!failedConnection.calls.some(c => c[0] === 'load'));
    const pendingNative = setup(nativeHlsCaps);
    pendingNative.win.DeepStreamNativeAudio = {create: () => ({clear() {}, requestForPlayback: () => new Promise(resolve => {finishBinding = resolve;})})};
    const interrupted = pendingNative.player.setCurrentSrc(null, options());
    await new Promise(resolve => setImmediate(resolve));
    await pendingNative.player.stop(false);
    finishBinding(null);
    await interrupted;
    assert.ok(!pendingNative.calls.some(c => c[0] === 'load'), 'stop cancels a late native session binding');

    const noNativeBinding = setup();
    const pendingSource = {Id: 'source', SupportsTranscoding: true, DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: -1,
        MediaStreams: [{Index: 2, Type: 'Audio', Codec: 'eac3'}],
        DeepStreamNativeAudioRequest: {contract: 'deepstream-audio-hls-v1', itemId: 'item', sourceId: 'source', audioIndex: 2, playSessionId: 'play'}};
    const requiresNative = options({item: {Id: 'item'}, playSessionId: 'play', playMethod: 'Transcode', mediaSource: pendingSource});
    await assert.rejects(noNativeBinding.player.setCurrentSrc(null, requiresNative), /Requested audio output is unavailable/);
    assert.ok(!noNativeBinding.calls.some(c => c[0] === 'load'), 'a marked native request never starts unauthenticated mpv');
    assert.equal(pendingSource.SupportsTranscoding, true, 'cached source metadata remains untouched');
    assert.equal(requiresNative.mediaSource.SupportsTranscoding, false, 'the failed playback does not silently trigger lossy transcoding');

    const rejectedLoad = setup({load: (...args) => args.at(-1)(false)});
    await assert.rejects(rejectedLoad.player.setCurrentSrc(null, options()), /Playback request rejected/,
        'native load rejection reaches the Jellyfin playback error path instead of marking playback started');
    let lateLoadReply;
    const lateRejectedLoad = setup({load: (...args) => {lateLoadReply = args.at(-1);}});
    const oldLoad = lateRejectedLoad.player.setCurrentSrc(null, options());
    await new Promise(resolve => setImmediate(resolve));
    await lateRejectedLoad.player.stop(false);
    lateLoadReply(false);
    await oldLoad;

    const toastCalls = [], playbackToast = setup({getAudioSignalPath: callback => callback({
        backend: 'avplayer', sourceEvidence: {status: 'fixture_joc_declared'}, activation: {format: 'dolby-atmos', active: true, confirmed: true}
    })});
    playbackToast.win.document.body = {};
    playbackToast.win.setInterval = () => 1;
    playbackToast.win.clearInterval = () => {};
    playbackToast.win.setTimeout = () => 2;
    playbackToast.win.clearTimeout = () => {};
    playbackToast.win.DeepStreamFormatActivationToast = {create: () => ({
        startSession: id => toastCalls.push(['start', id]), observe: (id, signal) => toastCalls.push(['observe', id, signal]),
        stop: id => toastCalls.push(['stop', id]), destroy() {}
    })};
    await playbackToast.player.setCurrentSrc(null, options());
    playbackToast.player.startFormatActivationMonitor();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(toastCalls[0][0], 'start');
    assert.equal(toastCalls[1][2].audio.format, 'dolby-atmos');
    playbackToast.player.startFormatActivationMonitor();
    assert.equal(toastCalls.filter(c => c[0] === 'start').length, 1, 'resume does not announce the same activation again');
    await playbackToast.player.stop(false);
    assert.equal(toastCalls.at(-1)[0], 'stop');

    const fixture = {
        enabled: true, fixture: 'public-apple-joc-v1',
        sourceUrl: 'http://127.0.0.1:61531/single-joc-master.m3u8',
        sourceSha256: '70a29e4e5a56e79127db3820b98ce74a79e52e780beb57ff99eb5f90b428cc9e',
        audioSelection: 'single-joc', subtitles: 'off', transport: 'public-loopback-fixture'
    };
    function fixtureOptions(request = fixture, extra = {}) {
        return options({url: request.sourceUrl, experimentalAv: request,
            mediaSource: {MediaStreams: [{Index: 0, Type: 'Video'}, {Index: 1, Type: 'Audio', Codec: 'eac3', Language: 'eng'}],
                DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1}, ...extra});
    }
    const testCaps = {getAudioCapabilities: callback => callback({...caps, experimentalAvFixtureAvailable: true})};
    ({player, calls} = setup(testCaps));
    await player.setCurrentSrc(null, fixtureOptions({...fixture, headers: {Authorization: 'synthetic-only'}}));
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2].experimentalAv)), fixture, 'only fixed contract fields are passed');
    assert.equal(Object.keys(calls[0][3].headers).length, 0, 'fixture does not forward browser headers');
    assert.equal(calls[0][4], 1, 'the single delivered audio track maps to track one');
    assert.equal(calls[0][5], -1);
    ({player, calls} = setup());
    await player.setCurrentSrc(null, fixtureOptions());
    assert.equal(calls[0][2].experimentalAv, undefined, 'normal builds cannot enable AV through caller options');
    for (const request of [
        {...fixture, enabled: 'true'}, {...fixture, fixture: 'other'},
        {...fixture, sourceSha256: '0'.repeat(64)}, {...fixture, audioSelection: 'auto'},
        {...fixture, subtitles: 'auto'}, {...fixture, transport: 'public-https-no-auth'},
        {...fixture, sourceUrl: 'https://public.invalid/single-joc-master.m3u8'},
        {...fixture, sourceUrl: 'http://localhost:61531/single-joc-master.m3u8'},
        {...fixture, sourceUrl: 'http://127.0.0.1/single-joc-master.m3u8'},
        {...fixture, sourceUrl: 'http://127.0.0.1:80/single-joc-master.m3u8'},
        {...fixture, sourceUrl: fixture.sourceUrl + '?token=synthetic'},
        {...fixture, sourceUrl: fixture.sourceUrl + '#fragment'},
        {...fixture, sourceUrl: fixture.sourceUrl.replace('127.0.0.1', 'synthetic@127.0.0.1')},
        {...fixture, sourceUrl: fixture.sourceUrl.replace('single-joc', 'another')}
    ]) {
        ({player, calls} = setup(testCaps));
        await player.setCurrentSrc(null, fixtureOptions(request));
        assert.equal(calls[0][2].experimentalAv, undefined, 'unsupported request stays on normal player');
    }
    for (const extra of [
        {playMethod: 'DirectStream'}, {url: 'http://test.invalid/synthetic.mkv'},
        {mediaSource: {...options().mediaSource, DefaultSubtitleStreamIndex: 7}},
        {mediaSource: {...options().mediaSource, DefaultSubtitleStreamIndex: -1}},
        {mediaSource: {...fixtureOptions().mediaSource, DefaultAudioStreamIndex: 9}},
        {mediaSource: {...fixtureOptions().mediaSource, MediaStreams: [{Index: 1, Type: 'Audio', Codec: 'aac'}]}},
        {mediaSource: {...options().mediaSource, DefaultAudioStreamIndex: -1, DefaultSubtitleStreamIndex: -1}}
    ]) {
        ({player, calls} = setup(testCaps));
        await player.setCurrentSrc(null, fixtureOptions(fixture, extra));
        assert.equal(calls[0][2].experimentalAv, undefined, 'source, track and subtitle choices are preserved');
    }

    ({player, calls} = setup({}, 'manual'));
    await player.setCurrentSrc(null, options());
    assert.equal(calls[0][4], 1, 'manual setting must keep server-selected track');

    ({player, calls} = setup());
    await player.setCurrentSrc(null, options({mediaSource: {...options().mediaSource, DefaultAudioStreamIndex: -1}}));
    assert.equal(calls[0][4], -1, 'disabled audio must stay disabled');

    for (const playMethod of ['Transcode', 'DirectStream']) {
        ({player, calls} = setup());
        await player.setCurrentSrc(null, options({playMethod, mediaSource: {...options().mediaSource, DefaultAudioStreamIndex: 9}}));
        assert.equal(player._audioPlan.selectedIndex, 9, 'server output must keep its selected stream');
        assert.equal(calls[0][4], 1, 'server output has a single audio track');
        player.setAudioStreamIndex(9);
        assert.deepEqual(calls.at(-1), ['audio', 1]);
    }

    ({player, calls} = setup({getAudioCapabilities: undefined}));
    await player.setCurrentSrc(null, options());
    assert.equal(calls[0][4], 1, 'missing native capability method must preserve selected audio');

    ({player, calls} = setup({getAudioCapabilities() {throw new Error('native channel unavailable');}}));
    await player.setCurrentSrc(null, options());
    assert.equal(calls[0][4], 1, 'failed capability read must preserve selected audio');

    let callbacks = [];
    ({player, calls} = setup({getAudioCapabilities: cb => callbacks.push(cb)}));
    const first = player.setCurrentSrc(null, options({url: 'first'}));
    const second = player.setCurrentSrc(null, options({url: 'second'}));
    callbacks[1](caps);
    await second;
    callbacks[0](caps);
    await first;
    assert.equal(calls.filter(c => c[0] === 'load').length, 1, 'stale capability replies must not restart the previous film');
    assert.equal(calls[0][1], 'second');

    callbacks = [];
    ({player, calls} = setup({getAudioCapabilities: cb => callbacks.push(cb)}));
    const pending = player.setCurrentSrc(null, options());
    await player.stop(false);
    callbacks[0](caps);
    await pending;
    assert.equal(calls.filter(c => c[0] === 'load').length, 0, 'stop must cancel a pending load');

    console.log('Audio player: selection, transport mapping, backend statistics, source evidence, locale and stale-response cancellation passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});


(async()=>{
 for(const rejection of ['sync','async']) {
  const {player}=setup(), original={Name:'synthetic base profile'};
  player.appHost={getDeviceProfile:()=>new Promise(resolve=>setTimeout(()=>resolve(original),10))};
  player._nativeAudioNegotiation={registerItem:()=>{
   if(rejection==='sync')throw new Error('synthetic');
   return Promise.reject(new Error('synthetic'));
  }};
  assert.equal(await player.getDeviceProfile({},{}),original);
 }
 console.log('Audio player: failed experimental registration retains original profile.');
})().catch(error=>{console.error(error);process.exitCode=1;});
