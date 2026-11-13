const test = require('node:test');
const assert = require('node:assert/strict');
const {enhancement} = require('../native/audioEngine.js');

function fixture() {
    const data = new Map();
    const failures = {write: false, remove: false};
    const localStorage = {
        getItem: key => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => {if (failures.write) throw Error('write'); data.set(key, value);},
        removeItem: key => {if (failures.remove) throw Error('remove'); data.delete(key);}
    };
    const api = {user: 'account', address: 'https://server.example',
        getCurrentUserId() {return this.user;}, serverAddress() {return this.address;}};
    const context = {api, server: api.address, userId: api.user, itemId: 'item', sourceId: 'source-a'};
    const window = {localStorage};
    return {data, failures, localStorage, api, context, window, store: enhancement.store(window)};
}
const enabled = {enabled: true, profile: 'speakers', bass: 2, treble: 0, clarity: 0, night: 0, boost: 0};
const scope = c => ({server: c.server, sourceId: c.sourceId});

test('defaults and invalid settings are neutral', () => {
    const config = enhancement.defaults();
    assert.equal(config.enabled, false);
    for (const key of ['bass', 'treble', 'clarity', 'night', 'boost']) assert.equal(config[key], 0);
    assert.equal(enhancement.safe({...enabled, bass: NaN}).enabled, false);
});

test('stored controls never reactivate automatically after a new window', () => {
    const f = fixture();
    assert.equal(f.store.write('account', 'item', enabled, scope(f.context)), true);
    assert.equal(f.store.read('account', 'item', scope(f.context)).enabled, true);
    const fresh = enhancement.store({localStorage: f.localStorage});
    const restored = fresh.read('account', 'item', scope(f.context));
    assert.equal(restored.enabled, false);
    assert.equal(restored.bass, 2);
});

test('failed disable and reset cannot revive an older enabled value', () => {
    const f = fixture();
    assert.equal(f.store.write('account', 'item', enabled, scope(f.context)), true);
    f.failures.write = true;
    assert.equal(f.store.write('account', 'item', {...enabled, enabled: false}, scope(f.context)), false);
    assert.equal(f.store.read('account', 'item', scope(f.context)).enabled, false);
    f.failures.remove = true;
    assert.equal(f.store.reset('account', 'item', scope(f.context)), false);
    assert.equal(f.store.read('account', 'item', scope(f.context)).enabled, false);
    assert.equal(enhancement.store({localStorage: f.localStorage}).read('account', 'item', scope(f.context)).enabled, false);
});

test('a stale enabled preference from an older version is dormant after restart', () => {
    const f = fixture();
    f.store.write('account', 'item', enabled, scope(f.context));
    const key = [...f.data.keys()][0];
    f.data.set(key, JSON.stringify(enabled));
    f.failures.remove = true;
    assert.equal(f.store.reset('account', 'item', scope(f.context)), false);
    const fresh = enhancement.store({localStorage: f.localStorage});
    assert.equal(fresh.read('account', 'item', scope(f.context)).enabled, false);
});

test('settings are isolated by account, title, server and media version', () => {
    const f = fixture();
    f.store.write('account', 'item', enabled, scope(f.context));
    for (const [user, item, context] of [
        ['other', 'item', scope(f.context)], ['account', 'other', scope(f.context)],
        ['account', 'item', {server: 'https://other.example', sourceId: 'source-a'}],
        ['account', 'item', {server: f.context.server, sourceId: 'source-b'}],
        ['account', 'item', {}]
    ]) assert.equal(f.store.read(user, item, context).enabled, false);
});

test('prepared settings are consumed once and invalidated on context change', () => {
    const f = fixture();
    f.store.write('account', 'item', enabled, scope(f.context));
    f.store.prepare(f.context);
    assert.equal(f.store.consume({...f.context, itemId: 'other'}), null);
    f.store.prepare(f.context);
    assert.equal(f.store.consume({...f.context, sourceId: 'other'}), null);
    f.store.prepare(f.context);
    f.api.address = 'https://other.example';
    assert.equal(f.store.consume(f.context), null);
    f.api.address = f.context.server;
    f.store.prepare(f.context);
    assert.equal(f.store.consume(f.context).config.enabled, true);
    assert.equal(f.store.consume(f.context), null);
});

test('malformed origins and inaccessible storage remain off', () => {
    const f = fixture();
    assert.equal(f.store.write('account', 'item', enabled, {server: 'https://user:pass@server.example', sourceId: 'source-a'}), false);
    const inaccessible = enhancement.store({get localStorage() {throw Error('blocked');}});
    assert.equal(inaccessible.write('account', 'item', enabled, scope(f.context)), false);
    assert.equal(inaccessible.read('account', 'item', scope(f.context)).enabled, true);
    assert.equal(inaccessible.reset('account', 'item', scope(f.context)), false);
    assert.equal(inaccessible.read('account', 'item', scope(f.context)).enabled, false);
});
