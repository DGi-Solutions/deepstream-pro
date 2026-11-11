const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const filename = 'native/inputPlugin.js';
const source = fs.readFileSync(filename, 'utf8');

async function startPlayback(item, nativeError = false) {
    const calls = [];
    const handlers = new Map();
    const events = {
        on(target, name, callback) {
            if (!handlers.has(target)) handlers.set(target, new Map());
            handlers.get(target).set(name, callback);
        },
        off(target, name) {
            if (handlers.has(target)) handlers.get(target).delete(name);
        }
    };
    const record = name => (...args) => calls.push({ name, args });
    const noopSignal = { connect() {} };
    const api = {
        input: {
            hostInput: noopSignal,
            volumeChanged: noopSignal,
            rateChanged: noopSignal,
            positionSeek: noopSignal
        },
        player: {
            playbackRateChanged: noopSignal,
            notifyMetadata(item) {
                calls.push({ name: 'metadata', args: [item] });
                if (nativeError) throw new Error('native bridge unavailable');
            },
            notifyPosition: record('position'),
            notifyVolumeChange: record('volume'),
            notifyQueueChange() {},
            notifyPlaybackState() {},
            notifyRateChange() {},
            notifyPlaybackStop() {},
            notifyShuffleChange() {},
            notifyRepeatChange() {},
            notifyDurationChange() {}
        },
        system: { hello() {} }
    };
    const playbackManager = {
        getPlayerState: () => ({ NowPlayingItem: item }),
        currentTime: () => 0,
        duration: () => 0,
        _playQueueManager: {
            getPlaylist: () => [],
            getCurrentPlaylistIndex: () => 0
        }
    };
    const sandbox = {
        window: {
            Events: events,
            apiPromise: Promise.resolve(api),
            api,
            jmpInfo: {
                settings: { main: { fullscreen: false } },
                settingsUpdate: []
            },
            playbackManager
        },
        console: { error() {}, log() {}, warn() {} },
        setInterval,
        clearInterval
    };
    vm.runInNewContext(source, sandbox, { filename });
    new sandbox.window._inputPlugin({
        inputManager: { handleCommand() {} },
        playbackManager
    });
    // Let the plugin's real async apiPromise initialization finish.
    await new Promise(resolve => setImmediate(resolve));

    const player = { getVolume: () => 80 };
    handlers.get(playbackManager).get('playbackstart')(null, player);
    return { calls, playerHandlers: handlers.get(player) };
}

(async () => {
    // Missing trailer ID: omit the whole initial block, but still bind events.
    let result = await startPlayback({ Name: 'Remote trailer' });
    assert.deepStrictEqual(result.calls, []);
    assert(result.playerHandlers.has('playing'));
    assert(result.playerHandlers.has('volumechange'));
    assert(result.playerHandlers.has('timeupdate'));

    // Valid ID: retain metadata, position, and normalized volume reporting.
    result = await startPlayback({ Id: 'item-1', Name: 'Movie' });
    assert.deepStrictEqual(result.calls.map(call => call.name), ['metadata', 'position', 'volume']);
    assert.strictEqual(result.calls[0].args[0].Id, 'item-1');
    assert.strictEqual(result.calls[1].args[0], 0);
    assert.strictEqual(result.calls[2].args[0], 0.8);
    assert(result.playerHandlers.has('playing'));

    // Native exception: catch it and continue registering remaining handlers.
    result = await startPlayback({ Id: 'item-2', Name: 'Movie' }, true);
    assert.deepStrictEqual(result.calls.map(call => call.name), ['metadata']);
    assert(result.playerHandlers.has('playing'));
    assert(result.playerHandlers.has('volumechange'));
    assert(result.playerHandlers.has('timeupdate'));

    console.log('inputPlugin mock tests: missing ID, valid ID, and native exception passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
