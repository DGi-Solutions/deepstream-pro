const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const listeners = new Map();
const elements = [];
class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.style = {}; this.handlers = {}; elements.push(this);}
    appendChild(child) {this.children.push(child); child.parentNode = this; return child;}
    append(...children) {children.forEach(child => this.appendChild(child));}
    addEventListener(type, handler) {(this.handlers[type] ||= []).push(handler);}
    setAttribute(name, value) {this[name] = value;}
    remove() {this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);}
    focus() {document.activeElement = this;}
    get isConnected() {return !this.removed && (this === document.body || this === document.head || this.parentNode?.isConnected);}
    click() {for (const fn of this.handlers.click || []) fn({target: this});}
    querySelector(selector) {return elements.find(e => e.isConnected && e.className?.split(' ').includes(selector.slice(1)));}
}
const document = {
    createElement: tag => new Element(tag),
    createTextNode: text => ({textContent: text}),
    getElementById: id => elements.find(e => e.id === id && e.isConnected) || null,
    querySelector: selector => elements.find(e => e.isConnected && e.className?.split(' ').includes(selector.slice(1))) || null,
    addEventListener(type, handler) {if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler);},
    removeEventListener(type, handler) {listeners.get(type)?.delete(handler);}
};
document.body = new Element('body'); document.head = new Element('head');
const opener = new Element('button'); document.body.appendChild(opener); opener.focus();
const settings = {main: {fullscreen: false}, video: {}, audio: {streamSelection: 'auto'}};
const jmpInfo = {settings, settingsDescriptions: {audio: []}, sections: [{key: 'audio', order: 1}], scriptPath: 'qrc:///extension'};
const signal = () => ({connect() {}});
const native = {settings: {sectionValueUpdate: signal(), groupUpdate: signal(), setValue() {}}, window: {setCursorVisibility() {}}, system: {openExternalUrl() {}}};
const window = {jmpInfo, qt: {webChannelTransport: {}}, sessionStorage: {getItem() {return null;}, setItem() {}}};
const context = vm.createContext({window, document, jmpInfo, console, MutationObserver: class {observe() {}},
    QWebChannel: function (_, callback) {callback({objects: native});}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/nativeshell.js'), 'utf8'), context);
context.initCompleted = window.initCompleted;
for (const fn of listeners.get('DOMContentLoaded') || []) fn();

(async () => {
    await window.initCompleted;
    const baseline = [jmpInfo.settingsUpdate.length, jmpInfo.settingsDescriptionsUpdate.length];
    await context.showSettingsModal();
    const back = document.getElementById('deepstream-settings-back');
    assert.ok(back, 'settings must have a visible back button in the header');
    assert.equal(back.parentNode.className, 'formDialogHeader');
    const modal = document.getElementById('deepstream-settings-dialog');
    assert.ok(modal);
    await context.showSettingsModal();
    assert.equal(elements.filter(e => e.id === 'deepstream-settings-dialog' && e.isConnected).length, 1, 'opening twice must not stack dialogs');
    back.click();
    assert.equal(modal.isConnected, false);
    assert.equal(document.activeElement, opener, 'closing must restore keyboard focus');
    assert.deepEqual([jmpInfo.settingsUpdate.length, jmpInfo.settingsDescriptionsUpdate.length], baseline, 'closing must unregister only the dialog callbacks');
    await context.showSettingsModal();
    let consumed = false;
    for (const fn of listeners.get('keydown') || []) fn({key: 'Escape', preventDefault() {consumed = true;}, stopPropagation() {}});
    assert.equal(document.getElementById('deepstream-settings-dialog'), null, 'Escape must close the dialog');
    assert.equal(consumed, true);
    assert.equal(listeners.get('keydown')?.size || 0, 0, 'closing must remove the key handler');
    console.log('Settings dialog: back, Escape, single dialog, focus restoration and callback cleanup passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
