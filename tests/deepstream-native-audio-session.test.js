const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {create, hlsSelection} = require('../native/nativeAudioSession.js');
const source = 'https://server.invalid/jellyfin/Videos/item-1/master.m3u8?MediaSourceId=source-1&PlaySessionId=play-1&AudioStreamIndex=2&AudioCodec=eac3&AllowAudioStreamCopy=true&MaxAudioChannels=8';
const selected = {Index: 2, Type: 'Audio', Codec: 'eac3', Channels: 8, BitRate: 768000, SampleRate: 48000, Profile: 'Dolby Digital Plus + Dolby Atmos'};
const options = () => ({url: source, playMethod: 'Transcode', playSessionId: 'play-1', item: {Id: 'item-1', ServerId: 'server-1'},
    mediaSource: {Id: 'source-1', DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: -1, MediaStreams: [selected]}});
const caps = {nativeAudioHlsAvailable: true};
function fixture({mode = 'normal'} = {}) {
    const calls = [], listeners = new Set(), pageEvents = new Map();
    let complete, poll, timeout, counter = 0;
    const win = {setTimeout(fn, delay) {if (mode === 'timeout') {timeout = fn; return 1;} return setTimeout(fn, delay);},
        clearTimeout(value) {if (mode !== 'timeout') clearTimeout(value);}, setInterval(fn) {poll = fn; return 1;}, clearInterval() {},
        addEventListener(name, fn) {pageEvents.set(name, fn);}, removeEventListener(name) {pageEvents.delete(name);},
        jmpInfo: {settings: {audio: {spatialAudio: true}}},
        ApiClient: {serverAddress: () => 'https://server.invalid/jellyfin/', serverId: () => 'server-1', getCurrentUserId: () => 'user-1',
            _sdk: {basePath: 'https://server.invalid/jellyfin', authorizationHeader: 'MediaBrowser Token="synthetic-session"'}},
        api: {player: {
            clearNativeAudioSession() {calls.push(['clear']);},
            bindNativeAudioSession(input, callback) {
                calls.push(['bind', input]);
                const bindingId = 'binding-' + ++counter;
                complete = (accepted = true) => {for (const fn of listeners) fn(bindingId, accepted);};
                if (mode === 'early') {complete(); callback(bindingId);}
                else {callback(bindingId); if (mode === 'normal' || mode === 'disconnect-throws') complete();}
            },
            nativeAudioSessionBindingResult: {connect(fn) {if (mode === 'connect-throws') throw Error('synthetic connect'); listeners.add(fn);},
                disconnect(fn) {listeners.delete(fn); if (mode === 'disconnect-throws') throw Error('synthetic disconnect');}}
        }}
    };
    return {win, calls, complete: accepted => complete(accepted), poll: () => poll(), timeout: () => timeout(), pageEvents, listeners};
}
(async () => {
    const current = {serverBaseUrl: 'https://server.invalid/jellyfin', serverId: 'server-1'};
    assert.deepEqual(hlsSelection(options(), current), {mediaSourceId: 'source-1', audioStreamIndex: 2, codec: 'eac3', spatial: 'joc'});
    const unknown = options();
    unknown.mediaSource.MediaStreams = [{...selected, Profile: undefined, Title: 'Atmos mixed by synthetic', DisplayTitle: 'JOC'}];
    assert.equal(hlsSelection(unknown, current).spatial, 'unknown', 'titles cannot prove spatial metadata');
    for (const mutate of [
        o => o.playMethod = 'DirectPlay', o => o.item.ServerId = 'other', o => o.item.Id = 'other',
        o => o.mediaSource.Id = 'other', o => o.playSessionId = 'other', o => o.mediaSource.DefaultAudioStreamIndex = 3,
        o => o.mediaSource.DefaultSubtitleStreamIndex = 4,
        o => o.mediaSource.MediaStreams = [{...selected, Codec: 'truehd'}],
        o => o.mediaSource.MediaStreams = [{...selected, IsExternal: true}],
        o => o.mediaSource.MediaStreams = [selected, selected],
        o => o.url = o.url.replace('server.invalid', 'foreign.invalid'),
        o => o.url = o.url.replace('https:', 'http:'),
        o => o.url += '&AudioStreamIndex=2',
        o => o.url = o.url.replace('AudioCodec=eac3', 'AudioCodec=aac'),
        o => o.url = o.url.replace('AudioCodec=eac3', 'AudioCodec=copy'),
        o => o.url = o.url.replace('AllowAudioStreamCopy=true', 'AllowAudioStreamCopy=false'),
        o => o.url = o.url.replace('MaxAudioChannels=8', 'MaxAudioChannels=2'),
        o => o.url += '&AudioBitRate=128000', o => o.url += '&AudioSampleRate=44100',
        o => o.url += '#fragment',
        o => o.url = o.url.replace('AudioCodec=eac3', 'AudioCodec=copy').replace('AllowAudioStreamCopy=true', 'AllowAudioStreamCopy=false'),
        o => o.url = o.url.replace('AudioCodec=eac3', 'AudioCodec=copy').replace('MaxAudioChannels=8', 'MaxAudioChannels=2')
    ]) {const o = options(); mutate(o); assert.equal(hlsSelection(o, current), null);}
    for (const mode of ['normal', 'early', 'disconnect-throws']) {
        const f = fixture({mode}), controller = create(f.win);
        assert.equal(create(f.win), controller);
        const input = options(), before = JSON.stringify(input);
        const request = await controller.requestForPlayback(input, caps);
        assert.equal(request.contract, 'deepstream-audio-hls-v1');
        assert.equal(request.bindingId, 'binding-1');
        assert.equal(request.sourceUrl, source);
        assert.equal(request.playSessionId, 'play-1');
        assert.equal(JSON.stringify(input), before, 'binding does not mutate negotiation or selection');
        assert.ok(!JSON.stringify(request).includes('synthetic-session'), 'credential never enters playback options');
        assert.equal(f.listeners.size, 0);
        await controller.requestForPlayback(input, caps);
        assert.equal(f.calls.filter(c => c[0] === 'bind').length, 1, 'same session reuses its binding');
        f.win.ApiClient._sdk.authorizationHeader = 'MediaBrowser Token="synthetic-next"';
        f.poll();
        assert.equal((await controller.requestForPlayback(input, caps)).bindingId, 'binding-2');
        controller.dispose();
        assert.equal(f.pageEvents.size, 0);
    }
    for (const mutate of [
        f => f.win.ApiClient._sdk.basePath = 'https://foreign.invalid',
        f => f.win.ApiClient._sdk.authorizationHeader = 'MediaBrowser Token="synthetic"\r\nInjected: bad',
        f => f.win.ApiClient.getCurrentUserId = () => '',
        f => f.win.ApiClient = null,
        f => f.win.jmpInfo.settings.audio.spatialAudio = false
    ]) {
        const f = fixture(), controller = create(f.win); mutate(f);
        assert.equal(await controller.requestForPlayback(options(), caps), null);
        assert.equal(f.calls.filter(c => c[0] === 'bind').length, 0);
        controller.dispose();
    }
    const disabled = fixture(), off = create(disabled.win);
    assert.equal(await off.requestForPlayback(options(), {}), null);
    assert.equal(disabled.calls.length, 0, 'default builds do not bind native sessions'); off.dispose();
    for (const mutate of [
        (f, o) => {f.win.ApiClient.getCurrentUserId = () => 'next-user'; f.poll();},
        (f, o) => {f.win.ApiClient.serverId = () => 'next-server'; f.poll();},
        (f, o) => {o.url += '&AudioBitRate=128000';},
        (f, o) => {o.mediaSource.DefaultAudioStreamIndex = -1;},
        (f, o) => {f.pageEvents.get('pagehide')();},
        (f, o) => {require('../native/nativeAudioSession.js').sessionChanged(f.win);},
        (f, o) => {f.win.jmpInfo.settings.audio.spatialAudio = false;}
    ]) {
        const f = fixture({mode: 'deferred'}), controller = create(f.win), o = options();
        const pending = controller.requestForPlayback(o, caps);
        mutate(f, o); f.complete();
        assert.equal(await pending, null, 'late binding may not activate changed playback/session');
        assert.equal(f.listeners.size, 0);
        controller.dispose();
    }
    const invalidSignal = fixture({mode: 'connect-throws'}), noSignal = create(invalidSignal.win);
    assert.equal(await noSignal.requestForPlayback(options(), caps), null, 'a broken native signal falls back safely');
    noSignal.dispose();
    const noCallback = fixture({mode: 'timeout'}), timed = create(noCallback.win);
    const timedRequest = timed.requestForPlayback(options(), caps); noCallback.timeout();
    assert.equal(await timedRequest, null, 'a missing callback is bounded');
    const timeoutClears = noCallback.calls.filter(c => c[0] === 'clear').length;
    assert.ok(timeoutClears >= 2, 'timeout revokes the outstanding native binding');
    noCallback.complete(true);
    assert.equal(noCallback.listeners.size, 0, 'late acceptance cannot revive the timed-out JS binding');
    timed.dispose();
    const stringServer = fixture(), stringClient = create(stringServer.win);
    stringServer.win.ApiClient.serverAddress = 'https://server.invalid/jellyfin';
    assert.equal((await stringClient.requestForPlayback(options(), caps)).bindingId, 'binding-1'); stringClient.dispose();
    const hooks = [], context = vm.createContext({window: {DeepStreamNativeAudio: {sessionChanged: value => hooks.push(value)}},
        jmpInfo: {settings: {}}, Promise});
    const shellPrefix = fs.readFileSync(path.join(__dirname, '../native/nativeshell.js'), 'utf8').split('function getDeviceProfile()')[0];
    vm.runInContext(shellPrefix, context);
    await context.window.NativeShell.onLocalUserSignedIn();
    context.window.NativeShell.onLocalUserSignedOut();
    assert.deepEqual(hooks, [context.window, context.window], 'real Jellyfin NativeShell hooks immediately revoke session bindings');
    const rejected = fixture({mode: 'deferred'}), controller = create(rejected.win);
    const result = controller.requestForPlayback(options(), caps); rejected.complete(false);
    assert.equal(await result, null); controller.dispose();
    const videoFixture=fixture(), videoController=create(videoFixture.win), videoOptions=options();
    videoFixture.win.jmpInfo.settings.audio.spatialAudio=false;
    videoOptions.url=videoOptions.url.replace('AudioCodec=eac3','AudioCodec=aac').replace('MaxAudioChannels=8','MaxAudioChannels=2');
    videoOptions.mediaSource.MediaStreams=[{...selected,Codec:'aac',Channels:2,Profile:'LC',IsExternal:false}];
    videoOptions.mediaSource.DeepStreamNativeAudioRequest={contract:'deepstream-video-hls-v1'};
    const videoCap={nativeDolbyVisionHlsAvailable:true};
    const videoRequest=await videoController.requestForPlayback(videoOptions,videoCap);
    assert.equal(videoRequest.contract,'deepstream-video-hls-v1');assert.equal(videoRequest.selection.codec,'aac');
    assert.equal(videoFixture.calls.find(c=>c[0]==='bind')[1].contract,'deepstream-video-hls-v1');
    videoOptions.mediaSource.DefaultSubtitleStreamIndex=4;
    assert.equal(await videoController.requestForPlayback(videoOptions,videoCap),null);
    videoController.dispose();
    const eacFixture=fixture(), eacController=create(eacFixture.win), eacOptions=options();
    eacFixture.win.jmpInfo.settings.audio.spatialAudio=false;
    eacOptions.mediaSource.MediaStreams=[{...selected,IsExternal:false}];
    eacOptions.mediaSource.DeepStreamNativeAudioRequest={contract:'deepstream-video-hls-v1'};
    const eacRequest=await eacController.requestForPlayback(eacOptions,videoCap);
    assert.equal(eacRequest.contract,'deepstream-video-hls-v1');assert.equal(eacRequest.selection.codec,'eac3');assert.equal(eacRequest.selection.channels,8);
    for(const mutate of [o=>o.mediaSource.MediaStreams[0].Channels=9,o=>o.mediaSource.MediaStreams[0].IsExternal=true,o=>o.mediaSource.DefaultAudioStreamIndex=3,o=>o.url=o.url.replace('AudioCodec=eac3','AudioCodec=aac'),o=>o.mediaSource.MediaStreams.push({...o.mediaSource.MediaStreams[0]}),o=>o.mediaSource.DefaultSubtitleStreamIndex=4]) {const bad=structuredClone(eacOptions);mutate(bad);assert.equal(await eacController.requestForPlayback(bad,videoCap),null);}
    eacController.dispose();
    const changing=fixture({mode:'deferred'}), changingController=create(changing.win), changingOptions=structuredClone(videoOptions);
    changingOptions.mediaSource.DefaultSubtitleStreamIndex=-1;changing.win.jmpInfo.settings.audio.spatialAudio=false;
    const changingRequest=changingController.requestForPlayback(changingOptions,videoCap);
    changingOptions.mediaSource.MediaStreams[0].Channels=6;changing.complete();
    assert.equal(await changingRequest,null,'changed AAC selection cannot activate');changingController.dispose();

    const v2Options = codec => {
        const o=options(),channels={aac:2,ac3:6,eac3:8,flac:8,alac:8};
        o.url=o.url.replace('AudioCodec=eac3','AudioCodec='+codec)+'&AllowVideoStreamCopy=true&VideoCodec=hevc';
        o.mediaSource.MediaStreams=[{Index:0,Type:'Video',Codec:'hevc',BitDepth:10,IsExternal:false,IsInterlaced:false,VideoRangeType:'DOVI',DvProfile:5,DvLevel:6,RpuPresentFlag:1,BlPresentFlag:1,ElPresentFlag:0},
            {...selected,Codec:codec,Channels:channels[codec],Profile:codec==='aac'?'LC':undefined,IsExternal:false}];
        o.mediaSource.DeepStreamNativeAudioRequest={contract:'deepstream-video-hls-v2',itemId:o.item.Id,sourceId:o.mediaSource.Id,audioIndex:2,playSessionId:o.playSessionId};
        return o;
    };
    for (const codec of ['aac','ac3','eac3','flac','alac']) {
        const o=v2Options(codec),selection=hlsSelection(o,current,'deepstream-video-hls-v2');
        assert.equal(selection.codec,codec);assert.equal(selection.channels,o.mediaSource.MediaStreams[1].Channels);
    }
    for (const mutate of [
        o=>o.mediaSource.MediaStreams.push(o.mediaSource.MediaStreams[1]),
        o=>o.url=o.url.replace('server.invalid','foreign.invalid'),
        o=>o.url+='&AudioCodec=ac3',
        o=>o.url=o.url.replace('&AllowVideoStreamCopy=true',''),
        o=>o.url=o.url.replace('AllowVideoStreamCopy=true','AllowVideoStreamCopy=false'),
        o=>o.url=o.url.replace('VideoCodec=hevc','VideoCodec=h264'),
        o=>o.mediaSource.MediaStreams[0].RpuPresentFlag=0,
        o=>o.mediaSource.MediaStreams[1].Channels=7
    ]) {const o=v2Options('ac3');mutate(o);assert.equal(hlsSelection(o,current,'deepstream-video-hls-v2'),null);}
    const v2Capabilities=()=>({nativeDolbyVisionHlsAvailable:true,nativeDolbyVisionAudioHlsV2:{available:true,codecs:['ac3']}});
    {
        const f=fixture({mode:'deferred'}),controller=create(f.win),o=v2Options('ac3'),capabilities=v2Capabilities();
        const pending=controller.requestForPlayback(o,capabilities);f.complete();
        const request=await pending;assert.equal(request.contract,'deepstream-video-hls-v2');assert.equal(request.selection.channels,6);
        assert.equal(f.calls.find(c=>c[0]==='bind')[1].contract,'deepstream-video-hls-v2');controller.dispose();
    }
    for(const change of [
        (o,c)=>{o.mediaSource.MediaStreams[1].Channels=7;},
        (o,c)=>{c.nativeDolbyVisionAudioHlsV2.codecs=[];},
        (o,c)=>{o.mediaSource.DefaultAudioStreamIndex=3;},
        (o,c)=>{o.mediaSource.DeepStreamNativeAudioRequest.sourceId='other';}
    ]){
        const f=fixture({mode:'deferred'}),controller=create(f.win),o=v2Options('ac3'),capabilities=v2Capabilities();
        const pending=controller.requestForPlayback(o,capabilities);change(o,capabilities);f.complete();
        assert.equal(await pending,null);controller.dispose();
    }
    const missingV2=fixture(),missingController=create(missingV2.win);
    assert.equal(await missingController.requestForPlayback(v2Options('ac3'),{}),null);
    assert.equal(missingV2.calls.filter(c=>c[0]==='bind').length,0);missingController.dispose();
    console.log('Native audio session: selection, authentication lifecycle, races and disabled-path checks passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
