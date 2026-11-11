const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const engine = require('../native/audioEngine.js');

const caps = {decoderEnumerationAvailable: true, decoders: ['truehd', 'eac3', 'ac3'], objectAudioRoutes: []};
const streams = [
    {Index: 0, Type: 'Video'},
    {Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'deu', Channels: 6},
    {Index: 7, Type: 'Subtitle'},
    {Index: 9, Type: 'Audio', Codec: 'truehd', Language: 'deu', Channels: 8},
    {Index: 11, Type: 'Audio', Codec: 'truehd', Language: 'eng', Channels: 8},
    {Index: 15, Type: 'Subtitle', IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: '/synthetic-subtitle.srt'}
];

function setup(nativeOverrides = {}, mode = 'auto') {
    const calls = [];
    const native = {
        getAudioCapabilities: callback => callback(caps),
        getAudioSignalPath: callback => callback({outputDriver: 'avfoundation', output: {'channel-count': 8, samplerate: 48000}, objectRenderingConfirmed: false}),
        load: (...args) => {calls.push(['load', ...args.slice(0, -1)]); args.at(-1)();},
        setAudioStream: index => calls.push(['audio', index]),
        stop: () => calls.push(['stop']),
        ...nativeOverrides
    };
    const context = vm.createContext({
        window: {api: {player: native}, DeepStreamAudio: engine, jmpInfo: {settings: {audio: {streamSelection: mode}}}},
        jmpInfo: {userAgent: 'DeepStream test'},
        setTimeout, clearTimeout,
        console: {log() {}, debug() {}, error() {}},
        document: {createElement: () => ({setAttribute() {}, protocol: 'http:'})}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/mpvVideoPlayer.js'), 'utf8'), context);
    const player = Object.create(context.window._mpvVideoPlayer.prototype);
    player.events = {trigger() {}};
    player.globalize = {translate: x => x};
    return {player, native, calls};
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

    console.log('Audio player: track mapping, subtitles, resume, manual mode, server output, capability failures and pending-load cancellation passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
