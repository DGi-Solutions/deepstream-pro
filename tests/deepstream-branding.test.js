const assert = require('node:assert/strict');
const {applyHeaderBranding} = require('../native/deepstreamTheme.js');
class Element {
    constructor(tag, classes = []) {
        this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = '';
        this.classes = new Set(classes);
        this.classList = {add: name => this.classes.add(name)};
        this.style = {setProperty: (name, value, priority) => this.attributes[name] = [value, priority]};
    }
    set className(value) {this.classes = new Set(value.split(' '));}
    setAttribute(name, value) {this.attributes[name] = value;}
    getAttribute(name) {return this.attributes[name];}
    removeAttribute(name) {delete this.attributes[name];}
    replaceChildren(...nodes) {this.children = nodes; this.replacements = (this.replacements || 0) + 1;}
    querySelector(selector) {return this.children.find(node => node.classes.has(selector.slice(1)));}
}
const brand = new Element('h3', ['pageTitleWithLogo', 'pageTitleWithDefaultLogo']);
brand.children = [new Element('img')];
brand.attributes['aria-hidden'] = 'true';
const back = new Element('button', ['headerBackButton']);
const backHandler = () => 'back'; back.onclick = backHandler;
const document = {createElement: tag => new Element(tag), querySelectorAll: selector => selector.startsWith('.MuiToolbar-root') ? [] : [brand]};
const url = 'file:///generated-extension/deepstream-pro.png';
applyHeaderBranding(document, url);
assert.equal(brand.querySelector('.deepstream-brand-mark').getAttribute('src'), url);
assert.equal(brand.querySelector('.deepstream-brand-name').textContent, 'DeepStream Pro');
assert.deepEqual(brand.attributes['background-image'], ['none', 'important']);
assert.equal(brand.getAttribute('aria-label'), 'DeepStream Pro');
assert.equal(brand.getAttribute('aria-hidden'), undefined);
assert.equal(back.onclick, backHandler, 'branding must preserve navigation controls and their handlers');
applyHeaderBranding(document, url);
assert.equal(brand.replacements, 1, 'unchanged branding must not cause a mutation loop');
brand.children = [];
applyHeaderBranding(document, url);
assert.equal(brand.replacements, 2, 'reapply after the server redraws the header');
const empty = new Element('h3');
applyHeaderBranding({createElement: document.createElement, querySelectorAll: selector => selector.startsWith('.MuiToolbar-root') ? [] : [empty]}, '');
assert.equal(empty.replacements, undefined, 'wait for an available bundled image');
console.log('Branding: bundled logo, accessible name, stable DOM, redraw and navigation preservation passed.');
