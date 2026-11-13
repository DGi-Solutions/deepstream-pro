const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const moduleUnderTest = require('../native/audioEnhancements.js');
const baseEngine = require('../native/audioEngine.js');
const neutral = () => ({enabled: false, profile: 'speakers', bass: 0, treble: 0, clarity: 0, night: 0, boost: 0});

class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.isConnected = true;}
    append(...nodes) {for (const node of nodes) {node.parentNode?.removeChild(node); this.children.push(node); node.parentNode = this;}}
    removeChild(node) {this.children = this.children.filter(child => child !== node); node.parentNode = null;}
    remove() {this.parentNode?.removeChild(this);}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    getAttribute(key) {return this.attributes[key];}
    addEventListener(type, listener) {(this.listeners[type] ||= []).push(listener);}
    emit(type) {for (const listener of this.listeners[type] || []) listener({target: this});}
    all(predicate) {return [...(predicate(this) ? [this] : []), ...this.children.flatMap(child => child.all(predicate))];}
}

function fixture({language = 'en'} = {}) {
    let user = 'generated-user-a', time = 1000;
    const api = {getCurrentUserId: () => user, serverAddress: () => 'https://generated-server-a.invalid/base'};
    const win = {
        ApiClient: api, document: {documentElement: {lang: language}, createElement: tag => new Element(tag)},
        navigator: {language}, setTimeout, clearTimeout, api: {player: {}}
    };
    const saved = new WeakMap();
    const state = {blocked: false, pending: null, consumed: null, cancelCount: 0, nativeSets: [], reads: [], nativeSession: ''};
    const entries = () => {if (!saved.has(win.ApiClient)) saved.set(win.ApiClient, new Map()); return saved.get(win.ApiClient);};
    const scopeDefault = () => ({server: api.serverAddress(), sourceId: 'generated-source-a'});
    const key = (u, item, scope = scopeDefault()) => JSON.stringify([scope.server, u, item, scope.sourceId]);
    const enhancement = {
        defaults: neutral,
        validate(value) {
            const good = !!value && typeof value.enabled === 'boolean' && ['speakers', 'headphones'].includes(value.profile) &&
                [['bass', -4, 4], ['treble', -4, 4], ['clarity', 0, 100], ['night', 0, 100], ['boost', 0, 3]]
                    .every(([field, min, max]) => typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= min && value[field] <= max);
            return {ok: good, value: good ? {...value} : neutral(), errors: good ? [] : ['invalid']};
        },
        safe(value) {return this.validate(value).value;},
        forPlayback(value, plan) {return {...this.safe(value), objectSource: !!(plan?.nativeObjectRoute || plan?.source?.objectFormat)};},
        store() {return store;}
    };
    const store = {
        read(u, item, scope) {return enhancement.safe(entries().get(key(u, item, scope)) || neutral());},
        write(u, item, config, scope) {if (state.blocked) return false; entries().set(key(u, item, scope), enhancement.safe(config)); return true;},
        reset(u, item, scope) {if (state.blocked) return false; entries().delete(key(u, item, scope)); return true;},
        prepare(identity) {const config = this.read(identity.userId, identity.itemId, identity); state.pending = {...identity, config, time}; return config;},
        consume(request) {
            const pending = state.pending; state.pending = null;
            if (!pending || pending.api !== request.api || pending.server !== request.server || pending.userId !== request.userId ||
                pending.itemId !== request.itemId || pending.sourceId !== request.sourceId ||
                request.api !== win.ApiClient || request.api.getCurrentUserId() !== request.userId || time - pending.time > 120000) return null;
            return state.consumed || {itemId: pending.itemId, config: pending.config};
        },
        cancel() {state.pending = null; state.cancelCount++;}
    };
    const controller = moduleUnderTest.create(win, {enhancement, now: () => time});
    win.DeepStreamAudioEnhancements = {create: () => controller};
    const page = new Element('main'), container = new Element('section'); page.append(container);
    let current = true;
    const context = (overrides = {}) => ({api: win.ApiClient, userId: win.ApiClient.getCurrentUserId(), itemId: 'generated-film-a', sourceId: 'generated-source-a',
        page, container, language, isCurrent: () => current, ...overrides});
    const options = (overrides = {}) => ({url: 'http://test.invalid/generated-source.mkv', playMethod: 'DirectPlay', item: {Id: 'generated-film-a', Type: 'Movie'},
        mediaSource: {Id: 'generated-source-a', DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: -1,
            MediaStreams: [{Type: 'Audio', Index: 2, Codec: 'aac', Language: 'deu', Channels: 2},
                {Type: 'Audio', Index: 9, Codec: 'truehd', Profile: 'Dolby TrueHD + Dolby Atmos', Language: 'deu', Channels: 8}]}, ...overrides});
    const find = label => container.all(node => node.getAttribute('aria-label') === label)[0];
    function enable() {const master = find(language === 'de' ? 'Klanganpassung' : 'Sound adjustments'); const input = master.tagName === 'input' ? master : container.all(node => node.type === 'checkbox')[0]; input.checked = true; input.emit('change');}
    function slider(label, value) {const input = find(label); input.value = String(value); input.emit('input'); input.emit('change');}
    function native() {
        win.api.player.setAudioEnhancementForSession = (session, config, callback) => {
            state.nativeSets.push({session, config});
            callback({session, accepted: true, state: config.objectSource ? 'bypassed' : 'ready', reason: config.objectSource ? 'object_source' : '',
                enabled: config.enabled, pcmOnly: true, active: config.enabled && !config.objectSource && ['bass', 'treble', 'clarity', 'night', 'boost'].some(k => config[k] !== 0), verified: true});
        };
        win.api.player.getAudioEnhancementStatusForSession = (session, callback) => {
            state.reads.push(callback);
            callback({session: state.nativeSession, accepted: true, state: 'ready', enabled: true, pcmOnly: true, active: true, verified: true});
        };
    }
    return {win, api, state, store, enhancement, controller, page, container, context, options, find, enable, slider, native,
        setUser: value => {user = value;}, setTime: value => {time = value;}, leave: () => {current = false;}};
}

test('all controls start neutral with the master off and no unsupported output selector', () => {
    const f = fixture(); f.controller.attach(f.context());
    assert.deepEqual(f.controller.state().viewConfig, neutral());
    assert.equal(f.container.all(node => node.tagName === 'fieldset')[0].hidden, true);
    f.enable();
    assert.deepEqual(f.controller.state().viewConfig, {...neutral(), enabled: true});
    assert.equal(f.find('Output profile'), undefined);
    assert.equal(f.container.all(node => node.tagName === 'fieldset')[0].hidden, false);
    assert.equal(f.container.all(node => node.type === 'range').length, 5);
});

test('sliders persist only valid values and retain DOM focus targets instead of replacing the form', () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable();
    const input = f.find('Bass'); f.slider('Bass', 3);
    assert.equal(f.find('Bass'), input);
    assert.equal(f.controller.state().viewConfig.bass, 3);
    assert.equal(f.store.read('generated-user-a', 'generated-film-a').bass, 3);
    f.slider('Bass', 200);
    assert.equal(f.controller.state().viewConfig.bass, 3);
});

test('storage failure retains the latest ephemeral setting and requires real consume success', () => {
    const f = fixture(); f.store.write('generated-user-a', 'generated-film-a', {...neutral(), enabled: true, bass: -2});
    f.state.blocked = true; f.controller.attach(f.context()); f.slider('Bass', 4);
    assert.equal(f.store.read('generated-user-a', 'generated-film-a').bass, -2);
    const ticket = f.controller.preparePlayback(f.options(), {source: {objectFormat: null}});
    assert.equal(ticket.config.bass, 4);
    assert.equal(ticket.config.enabled, true);
    const second = f.controller.preparePlayback(f.options(), {});
    assert.deepEqual(second.config, neutral(), 'one prepared consume cannot be reused');
});

test('reset remains neutral when old storage survives a blocked reset and a redraw', () => {
    const f = fixture(); f.store.write('generated-user-a', 'generated-film-a', {...neutral(), enabled: true, clarity: 80, night: 70, boost: 3});
    f.controller.attach(f.context()); f.state.blocked = true;
    f.container.all(node => node.tagName === 'button')[0].emit('click');
    assert.deepEqual(f.controller.state().viewConfig, neutral());
    assert.equal(f.store.read('generated-user-a', 'generated-film-a').clarity, 80);
    f.controller.attach(f.context());
    assert.equal(f.container.all(node => node.className === 'deepstream-audio-enhancements').length, 1);
    assert.deepEqual(f.controller.state().viewConfig, neutral());
    assert.deepEqual(f.controller.preparePlayback(f.options(), {}).config, neutral());
});

test('German controls use concise local labels', () => {
    const f = fixture({language: 'de'}); f.controller.attach(f.context());
    assert.ok(f.find('Klanganpassung')); assert.ok(f.find('Sprachpräsenz')); assert.ok(f.find('Nachtmodus'));
    assert.equal(f.container.all(node => node.tagName === 'button')[0].textContent, 'Zurücksetzen');
});

test('identity requires exact lower-case item metadata and rejects conflicting Item metadata', () => {
    const f = fixture();
    assert.equal(moduleUnderTest.identityForPlayback(f.win, f.options()).itemId, 'generated-film-a');
    assert.equal(moduleUnderTest.identityForPlayback(f.win, f.options({Item: {Id: 'another-generated-film'}})), null);
    assert.equal(moduleUnderTest.identityForPlayback(f.win, f.options({item: {}, Item: {Id: 'generated-film-a'}})), null);
    assert.equal(moduleUnderTest.identityForPlayback(f.win, f.options({mediaSource: {Id: ''}})), null);
});

test('wrong item, source, API, account, expired preparation or cancelled view cannot enable effects', () => {
    for (const change of [
        f => {f.state.consumed = {itemId: 'wrong-generated-item', config: {...neutral(), enabled: true, boost: 3}};},
        f => {f.optionsOverride = {mediaSource: {...f.options().mediaSource, Id: 'other-generated-source'}};},
        f => {f.win.ApiClient = {getCurrentUserId: () => 'generated-user-a', serverAddress: () => 'https://generated-server-a.invalid/base'};},
        f => f.setUser('generated-user-b'), f => f.setTime(121001), f => f.controller.cancelView()
    ]) {
        const f = fixture(); f.controller.attach(f.context()); f.enable(); f.slider('Gain', 2); change(f);
        assert.deepEqual(f.controller.preparePlayback(f.options(f.optionsOverride), {}).config, neutral());
    }
});

test('stale view inputs cannot persist or prepare after leaving the page', () => {
    const f = fixture(); f.controller.attach(f.context()); const input = f.find('Bass'); f.leave();
    input.value = 4; input.emit('change');
    assert.equal(f.controller.state().prepared, false);
    assert.deepEqual(f.store.read('generated-user-a', 'generated-film-a'), neutral());
});

test('a server switch inside one API object invalidates its preparation', () => {
    const f = fixture(); let server = 'https://generated-server-a.invalid/base';
    f.api.serverAddress = () => server;
    f.controller.attach(f.context()); f.enable(); f.slider('Bass', 2);
    server = 'https://generated-server-b.invalid/base';
    assert.deepEqual(f.controller.preparePlayback(f.options(), {}).config, neutral());
});

test('a missing or unsafe server identity never prepares persisted adjustments', () => {
    for (const address of [undefined, '', 'https://user:secret@generated.invalid', 'https://generated.invalid/?token=x', 'file:///tmp/a']) {
        const f = fixture(); f.api.serverAddress = () => address;
        assert.equal(f.controller.attach(f.context()), false);
        assert.deepEqual(f.controller.preparePlayback(f.options(), {}).config, neutral());
    }
});

test('saved and window-local adjustments are isolated by server and version', () => {
    const f = fixture(); let server = 'https://generated-server-a.invalid/base';
    f.api.serverAddress = () => server;
    f.controller.attach(f.context()); f.enable(); f.slider('Bass', 3);
    f.controller.attach(f.context({sourceId: 'generated-source-b'}));
    assert.deepEqual(f.controller.state().viewConfig, neutral());
    f.controller.attach(f.context({sourceId: 'generated-source-a'}));
    assert.equal(f.controller.state().viewConfig.bass, 3);
    server = 'https://generated-server-b.invalid/base';
    f.controller.attach(f.context());
    assert.deepEqual(f.controller.state().viewConfig, neutral());
});

test('playback preparation includes the exact server and item in the store request', () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable();
    let request;
    const consume = f.store.consume;
    f.store.consume = function(value) {request = value; return consume.call(this, value);};
    f.controller.preparePlayback(f.options(), {});
    assert.equal(request.server, 'https://generated-server-a.invalid/base');
    assert.equal(request.itemId, 'generated-film-a');
    assert.equal(request.sourceId, 'generated-source-a');
});

test('an external store preparation alone cannot invent an unbound UI consume success', () => {
    const f = fixture(); f.store.write('generated-user-a', 'generated-film-a', {...neutral(), enabled: true, boost: 3});
    f.store.prepare({api: f.api, userId: 'generated-user-a', itemId: 'generated-film-a', sourceId: 'generated-source-a'});
    assert.deepEqual(f.controller.preparePlayback(f.options(), {}).config, neutral());
});

test('only verified native status for the exact bound session is shown active', async () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable(); f.slider('Bass', 2); f.native();
    const ticket = f.controller.preparePlayback(f.options(), {}), session = f.controller.bindPlayback(ticket, () => true);
    f.state.nativeSession = 'wrong-session'; await f.controller.refreshStatus(session);
    assert.equal(f.controller.state().activeStatus.active, false);
    assert.notEqual(f.container.all(node => node.className === 'deepstream-enhancement-status')[0].textContent, 'Active');
    f.state.nativeSession = ticket.session; await f.controller.refreshStatus(session);
    const status = f.container.all(node => node.className === 'deepstream-enhancement-status')[0];
    assert.equal(status.textContent, 'Active'); assert.equal(status.dataset.active, 'true');
});

test('native failures and unverified activity never claim verified active sound', async () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable();
    const ticket = f.controller.preparePlayback(f.options(), {}), session = f.controller.bindPlayback(ticket, () => true);
    f.win.api.player.getAudioEnhancementStatusForSession = (session, cb) => cb({session: ticket.session, accepted: true, state: 'error', active: false, enabled: true, verified: false});
    await f.controller.refreshStatus(session);
    assert.equal(f.container.all(node => node.className === 'deepstream-enhancement-status')[0].textContent, 'Not applied');
    f.win.api.player.getAudioEnhancementStatusForSession = (session, cb) => cb({session: ticket.session, accepted: true, state: 'ready', active: true, enabled: true, verified: false});
    await f.controller.refreshStatus(session);
    const status = f.container.all(node => node.className === 'deepstream-enhancement-status')[0];
    assert.equal(status.textContent, 'Not confirmed yet'); assert.equal(status.dataset.active, 'false');
});

test('neutral and protected routes have accurate status labels', () => {
    assert.equal(moduleUnderTest.statusText({accepted: true, active: false, enabled: true, reason: 'neutral_settings'}, 'en', true), 'Neutral');
    assert.equal(moduleUnderTest.statusText({accepted: true, active: false, enabled: true, reason: 'object_audio_source'}, 'de', true), 'Für diese Tonspur ausgesetzt');
    assert.equal(moduleUnderTest.statusText({accepted: true, active: false, enabled: true, reason: 'object_unconfirmed'}, 'de', true), 'Für diese Tonspur ausgesetzt');
    assert.equal(moduleUnderTest.statusText({accepted: true, active: false, enabled: true, reason: 'passthrough_configured'}, 'en', true), 'Bypassed for this audio track');
    assert.equal(moduleUnderTest.statusText({accepted: true, active: false, enabled: true, reason: 'spatial_route'}, 'en', true), 'Bypassed for this output');
    assert.equal(moduleUnderTest.statusText({accepted: true, active: true, verified: false, enabled: false, reason: 'filter_remove_failed'}, 'de', false), 'Änderung fehlgeschlagen');
    assert.equal(moduleUnderTest.statusText({accepted: true, active: false, reason: 'awaiting_audio_selection'}, 'de', true), 'Wird geprüft');
});

test('old native replies cannot mark a new media session active', async () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable();
    const firstTicket = f.controller.preparePlayback(f.options(), {}), first = f.controller.bindPlayback(firstTicket, () => true);
    let finish; f.win.api.player.getAudioEnhancementStatusForSession = (session, cb) => {finish = cb;};
    const pending = f.controller.refreshStatus(first);
    f.controller.attach(f.context({itemId: 'generated-episode-b', sourceId: 'generated-source-b'}));
    const options = f.options({item: {Id: 'generated-episode-b'}, mediaSource: {Id: 'generated-source-b'}});
    const secondTicket = f.controller.preparePlayback(options, {});
    f.controller.bindPlayback(secondTicket, () => true);
    finish({session: firstTicket.session, accepted: true, state: 'ready', active: true, verified: true}); await pending;
    assert.equal(f.controller.state().activeStatus, null);
});

test('viewing another title cannot change the audio of a playing title', () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable(); f.native();
    const ticket = f.controller.preparePlayback(f.options(), {}); f.controller.bindPlayback(ticket, () => true);
    f.controller.attach(f.context({itemId: 'generated-episode-b', sourceId: 'generated-source-b'}));
    f.enable(); f.slider('Gain', 3);
    assert.equal(f.state.nativeSets.length, 0);
});

test('live changes use only the guarded native method; no unguarded fallback is called', () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable();
    const ticket = f.controller.preparePlayback(f.options(), {}); f.controller.bindPlayback(ticket, () => true);
    let unguarded = 0; f.win.api.player.setAudioEnhancement = () => {unguarded++;};
    f.slider('Bass', 2);
    assert.equal(unguarded, 0);
    assert.equal(f.controller.state().activeStatus.state, 'unavailable');
});

test('manual track changes recompute object protection on the active configuration', async () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable(); f.slider('Bass', 2); f.native();
    const ticket = f.controller.preparePlayback(f.options(), {}), session = f.controller.bindPlayback(ticket, () => true);
    await f.controller.updatePlan(session, {source: {objectFormat: 'atmos'}});
    assert.equal(f.state.nativeSets.at(-1).session, ticket.session);
    assert.equal(f.state.nativeSets.at(-1).config.objectSource, true);
    await f.controller.updatePlan(session, {source: {objectFormat: null}});
    assert.equal(f.state.nativeSets.at(-1).config.objectSource, false);
    assert.equal(f.state.nativeSets.at(-1).config.bass, 2);
});

test('ending the matching session invalidates pending status and further live changes', async () => {
    const f = fixture(); f.controller.attach(f.context()); f.enable();
    const ticket = f.controller.preparePlayback(f.options(), {}), session = f.controller.bindPlayback(ticket, () => true);
    let finish; f.win.api.player.getAudioEnhancementStatusForSession = (session, cb) => {finish = cb;};
    const pending = f.controller.refreshStatus(session);
    f.controller.invalidatePlayback(session);
    finish({session: ticket.session, accepted: true, active: true, verified: true}); await pending;
    assert.equal(f.controller.state().activeStatus, null);
    f.native(); await f.controller.updatePlan(session, {});
    assert.equal(f.state.nativeSets.length, 0);
});

function playerFixture() {
    const f = fixture(); const calls = [];
    const native = f.win.api.player;
    native.getAudioCapabilities = cb => cb({decoderEnumerationAvailable: true, decoders: ['aac', 'truehd']});
    native.load = (...args) => {calls.push(args.slice(0, -1)); f.state.nativeSession = args[1].audioEnhancementSession; args.at(-1)(true);};
    native.setAudioStream = index => calls.push(['audio', index]);
    native.stop = () => calls.push(['stop']);
    f.native();
    f.win.DeepStreamAudio = {...baseEngine, enhancement: f.enhancement};
    f.win.jmpInfo = {settings: {audio: {streamSelection: 'auto'}}};
    const context = vm.createContext({window: f.win, jmpInfo: {userAgent: 'generated-test'},
        setTimeout, clearTimeout, console: {log() {}, debug() {}, error() {}},
        document: f.win.document});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/mpvVideoPlayer.js'), 'utf8'), context);
    const player = Object.create(context.window._mpvVideoPlayer.prototype);
    player.events = {trigger() {}};
    return {...f, player, calls};
}

test('the actual player passes consumed per-title configuration and opaque session atomically in load options', async () => {
    const f = playerFixture(); f.controller.attach(f.context()); f.enable(); f.slider('Bass', 3);
    await f.player.setCurrentSrc(null, f.options());
    assert.equal(f.calls[0][1].audioEnhancement.enabled, true);
    assert.equal(f.calls[0][1].audioEnhancement.bass, 3);
    assert.equal(f.calls[0][1].audioEnhancement.objectSource, true);
    assert.match(f.calls[0][1].audioEnhancementSession, /^deepstream-pcm-/);
    assert.equal(f.state.nativeSets.length, 0, 'initial configuration must not cross sessions through a separate setter');
    f.player.setAudioStreamIndex(2);
    assert.equal(f.state.nativeSets.at(-1).config.objectSource, false);
    assert.equal(f.state.nativeSets.at(-1).session, f.calls[0][1].audioEnhancementSession);
});

test('the actual player remains neutral without a matching prepare/consume', async () => {
    const f = playerFixture();
    f.store.write('generated-user-a', 'generated-film-a', {...neutral(), enabled: true, boost: 3});
    await f.player.setCurrentSrc(null, f.options());
    assert.equal(f.calls[0][1].audioEnhancement.enabled, false);
    assert.equal(f.calls[0][1].audioEnhancement.boost, 0);
});

test('an account change during async player capability discovery cannot load the old enhancement', async () => {
    const f = playerFixture(); f.controller.attach(f.context()); f.enable();
    let finish; f.win.api.player.getAudioCapabilities = cb => {finish = cb;};
    const pending = f.player.setCurrentSrc(null, f.options());
    f.setUser('generated-user-b'); finish({}); await pending;
    assert.equal(f.calls.length, 0);
});

test('a stopped player ignores delayed native readback', async () => {
    const f = playerFixture(); f.controller.attach(f.context()); f.enable();
    let finish; f.win.api.player.getAudioEnhancementStatusForSession = (session, cb) => {finish = cb;};
    await f.player.setCurrentSrc(null, f.options());
    const session = f.player._audioEnhancementSession;
    await f.player.stop(false);
    finish({session: session.nativeSession, accepted: true, active: true, verified: true});
    await new Promise(setImmediate);
    assert.equal(f.controller.state().activeStatus, null);
    assert.equal(f.player._audioEnhancementSession, null);
});

// Exercise the real engine/store supplied by the application, not a stand-in.
// The storage and metadata below are entirely generated for this test.
function actualEngineFixture(backing = new Map(), faults = {blocked: false}) {
    let userId = 'generated-user', server = 'https://generated-server.invalid/base';
    const api = {getCurrentUserId: () => userId, serverAddress: () => server};
    const storage = {
        getItem(key) {return backing.has(key) ? backing.get(key) : null;},
        setItem(key, value) {if (faults.blocked) throw new Error('storage unavailable'); backing.set(key, String(value));},
        removeItem(key) {if (faults.blocked) throw new Error('storage unavailable'); backing.delete(key);}
    };
    const win = {ApiClient: api, localStorage: storage,
        document: {documentElement: {lang: 'en'}, createElement: tag => new Element(tag)},
        navigator: {language: 'en'}, setTimeout, clearTimeout, api: {player: {}}};
    const controller = moduleUnderTest.create(win, {enhancement: baseEngine.enhancement});
    assert.ok(controller, 'the actual engine must expose the enhancement contract');
    const page = new Element('main'), container = new Element('section'); page.append(container);
    const context = (overrides = {}) => ({api, userId, itemId: 'generated-title', sourceId: 'generated-version', page, container,
        language: 'en', isCurrent: () => true, ...overrides});
    const options = (overrides = {}) => ({item: {Id: 'generated-title', Type: 'Movie'},
        mediaSource: {Id: 'generated-version', MediaStreams: []}, ...overrides});
    const find = label => container.all(node => node.getAttribute('aria-label') === label)[0];
    function master(value) {
        const input = container.all(node => node.tagName === 'input' && node.type === 'checkbox')[0];
        assert.ok(input); input.checked = value; input.emit('change');
    }
    function bass(value) {const input = find('Bass'); input.value = String(value); input.emit('input'); input.emit('change');}
    return {win, api, backing, faults, controller, container, context, options, master, bass,
        setServer: value => {server = value;}, setUser: value => {userId = value;}};
}

test('actual engine: matching server, account, title and version consume the chosen controls', () => {
    const f = actualEngineFixture(); assert.equal(f.controller.attach(f.context()), true);
    f.master(true); f.bass(3);
    const ticket = f.controller.preparePlayback(f.options(), {source: {objectFormat: null}});
    assert.equal(ticket.config.enabled, true);
    assert.equal(ticket.nativeConfig.bass, 3);
    assert.equal(ticket.nativeConfig.objectSource, false);
    assert.deepEqual(f.controller.preparePlayback(f.options(), {}).config, neutral(), 'the real store consumes preparation once');
});

test('actual engine: a new window retains controls but requires explicit re-enabling', () => {
    const backing = new Map(), first = actualEngineFixture(backing);
    first.controller.attach(first.context()); first.master(true); first.bass(3);
    const reopened = actualEngineFixture(backing);
    reopened.controller.attach(reopened.context());
    assert.equal(reopened.controller.state().viewConfig.bass, 3);
    assert.equal(reopened.controller.state().viewConfig.enabled, false);
    const ticket = reopened.controller.preparePlayback(reopened.options(), {});
    assert.equal(ticket.nativeConfig.enabled, false);
    assert.equal(ticket.nativeConfig.bass, 3);
});

test('actual engine: failed persistent disable stays disabled in session and after restart', () => {
    const backing = new Map(), faults = {blocked: false}, first = actualEngineFixture(backing, faults);
    first.controller.attach(first.context()); first.master(true); first.bass(2);
    const storedKey = [...backing.keys()][0];
    backing.set(storedKey, JSON.stringify({...neutral(), enabled: true, bass: 2}));
    faults.blocked = true; first.master(false);
    assert.equal(first.controller.state().viewConfig.enabled, false);
    assert.equal(first.controller.preparePlayback(first.options(), {}).nativeConfig.enabled, false);
    assert.equal(first.container.all(node => node.className === 'deepstream-enhancement-saved')[0].textContent,
        'Saved for this session only');
    const reopened = actualEngineFixture(backing, faults); reopened.controller.attach(reopened.context());
    assert.equal(reopened.controller.state().viewConfig.enabled, false);
    assert.equal(reopened.controller.preparePlayback(reopened.options(), {}).nativeConfig.enabled, false);
});

test('actual engine: mismatched server, account, title or version cannot activate processing', () => {
    for (const change of [
        f => {f.setServer('https://other-generated.invalid/base'); return f.options();},
        f => {f.setUser('other-generated-user'); return f.options();},
        f => f.options({item: {Id: 'other-generated-title'}}),
        f => f.options({mediaSource: {Id: 'other-generated-version'}})
    ]) {
        const f = actualEngineFixture(); f.controller.attach(f.context()); f.master(true); f.bass(3);
        assert.deepEqual(f.controller.preparePlayback(change(f), {}).config, neutral());
    }
});

test('actual engine and actual player pass a matched setting atomically to the native load', async () => {
    const f = actualEngineFixture(); f.controller.attach(f.context()); f.master(true); f.bass(3);
    const calls = [];
    f.api.getCurrentUserId = () => 'generated-user';
    f.win.DeepStreamAudio = baseEngine;
    f.win.DeepStreamAudioEnhancements = {create: () => f.controller};
    f.win.jmpInfo = {settings: {audio: {streamSelection: 'auto'}}};
    f.win.api.player.getAudioCapabilities = callback => callback({decoderEnumerationAvailable: true, decoders: ['aac']});
    f.win.api.player.load = (...args) => {calls.push(args.slice(0, -1)); args.at(-1)(true);};
    f.win.api.player.getAudioEnhancementStatusForSession = (session, cb) => cb({session, accepted: true, state: 'pending', active: false, verified: false});
    const runtime = vm.createContext({window: f.win, jmpInfo: {userAgent: 'generated-test'},
        setTimeout, clearTimeout, console: {log() {}, debug() {}, error() {}}, document: f.win.document});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/mpvVideoPlayer.js'), 'utf8'), runtime);
    const player = Object.create(runtime.window._mpvVideoPlayer.prototype); player.events = {trigger() {}};
    const options = f.options({url: 'http://test.invalid/generated.mkv', playMethod: 'DirectPlay',
        mediaSource: {Id: 'generated-version', DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: -1,
            MediaStreams: [{Type: 'Audio', Index: 2, Codec: 'aac', Language: 'deu', Channels: 2}]}});
    await player.setCurrentSrc(null, options);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].audioEnhancement.enabled, true);
    assert.equal(calls[0][1].audioEnhancement.bass, 3);
    assert.match(calls[0][1].audioEnhancementSession, /^deepstream-pcm-/);
});
