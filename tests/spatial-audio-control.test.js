'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const spatial = require('../native/spatialAudioControl');
class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.isConnected = true; this.textContent = ''; this.checked = false; this.disabled = false;}
    append(...nodes) {for (const node of nodes) {node.parent = this; this.children.push(node);}}
    remove() {if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); this.isConnected = false;}
    setAttribute(k, v) {this.attrs[k] = v;}
    addEventListener(k, f) {this.listeners[k] = f;}
    emit(k) {this.listeners[k]?.({target:this});}
    find(cls) {if (this.className === cls) return this; for (const node of this.children) {const found = node.find(cls); if (found) return found;} return null;}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(initial = false, options = {}) {
    let value = initial;
    const calls = [];
    const api = {getCurrentUserId: () => 'account'};
    const page = new Element('page');
    const container = new Element('container');
    const win = {document: {createElement: tag => new Element(tag)}, setTimeout, clearTimeout, ApiClient: api,
        initCompleted: Promise.resolve(), jmpInfo: {settingsUpdate: []}, api: {settings: {
            value(section, key, cb) {calls.push(['value', section, key]); if (options.deferRead) options.reads.push(cb); else cb(value);},
            setValue(section, key, next, cb) {calls.push(['setValue', section, key, next]); if (!options.rejectWrite) value = next;
                for (const listener of win.jmpInfo.settingsUpdate) listener(section, {[key]: value});
                if (options.deferWrite) options.writes.push(cb); else cb();}
        }}};
    const context = {api, userId: 'account', itemId: 'title', sourceId: 'source', page, container, language:'de', settings:{}, isCurrent: () => true};
    const controller = spatial.create(win);
    return {win, api, context, controller, container, calls, emit(next) {value = next; for (const f of win.jmpInfo.settingsUpdate) f('audio', {spatialAudio:next});}};
}
function input(f) {return f.container.find('deepstream-spatial-toggle').children[0];}
function status(f) {return f.container.find('deepstream-spatial-status').textContent;}

test('native global setting is read, changed and read back; another view reads the same setting', async () => {
    const f = fixture(); f.controller.attach(f.context); assert.equal(input(f).disabled, true); await tick();
    assert.equal(input(f).checked, false); input(f).checked = true; input(f).emit('change'); await tick();
    assert.equal(input(f).checked, true); assert.match(status(f), /Neustart/);
    assert.deepEqual(f.calls.filter(c => c[0] === 'setValue'), [['setValue', 'audio', 'spatialAudio', true]]);
    f.controller.attach({...f.context, itemId:'another', sourceId:'other'}); await tick(); assert.equal(input(f).checked, true);
    f.emit(false); assert.equal(input(f).checked, false);
});
test('write failure is not represented as successful', async () => {
    const f = fixture(false, {rejectWrite:true}); f.controller.attach(f.context); await tick();
    input(f).checked = true; input(f).emit('change'); await tick();
    assert.equal(input(f).checked, false); assert.match(status(f), /nicht bestätigt/);
});
test('obsolete reads and changes cannot update a new page', async () => {
    const options = {deferRead:true, reads:[]}; const f = fixture(false, options);
    f.controller.attach(f.context); await tick(); assert.equal(options.reads.length, 1);
    f.controller.attach({...f.context, itemId:'other'}); await tick(); assert.equal(options.reads.length, 2);
    options.reads[0](true); await tick(); assert.equal(input(f).disabled, true);
    options.reads[1](false); await tick(); assert.equal(input(f).checked, false); assert.equal(input(f).disabled, false);
    f.win.ApiClient = {}; input(f).checked = true; input(f).emit('change'); await tick();
    assert.equal(f.calls.filter(c => c[0] === 'setValue').length, 0);
});
test('notification wins over stale read; incompatible settings show advice without changing them', async () => {
    const options = {deferRead:true, reads:[]}; const f = fixture(false, options);
    f.context.settings = {channels:'2.0'}; f.controller.attach(f.context); await tick(); f.emit(true); options.reads[0](false); await tick();
    assert.equal(input(f).checked, true); assert.match(f.container.find('deepstream-spatial-hint').textContent, /Kanäle Auto/);
    assert.equal(f.context.settings.channels, '2.0'); assert.equal(f.calls.filter(c => c[0] === 'setValue').length, 0);
});
test('English copy states scope and restart uncertainty; invalid state fails closed', async () => {
    const f = fixture(null); f.context.language = 'en'; f.controller.attach(f.context); await tick();
    assert.equal(input(f).disabled, true); assert.match(status(f), /unavailable/);
    assert.match(f.container.find('deepstream-spatial-scope').textContent, /App-wide.*restart may be required/);
});

test('same title rerender preserves the control and pending status while settings propagate', async () => {
    const options = {deferWrite:true, writes:[]}; const f = fixture(false, options);
    f.controller.attach(f.context); await tick();
    const original = input(f); original.checked = true; original.emit('change');
    assert.equal(original.disabled, true); assert.match(status(f), /Wird gespeichert/);
    f.controller.attach({...f.context, settings:{channels:'auto'}});
    assert.equal(input(f), original); assert.equal(original.disabled, true);
    options.writes[0](); await tick();
    assert.equal(input(f), original); assert.equal(original.checked, true); assert.match(status(f), /Neustart/);
});
test('changed account or title replaces stale control without requesting focus', async () => {
    const f = fixture(false); f.controller.attach(f.context); await tick();
    const oldInput = input(f); let focusCalls = 0; oldInput.focus = () => {focusCalls++;};
    f.controller.attach({...f.context, itemId:'other'}); await tick();
    assert.notEqual(input(f), oldInput); assert.equal(focusCalls, 0);
});
