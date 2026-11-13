'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const toast = require('../native/formatActivationToast');
class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.className = ''; this.textContent = ''; this.parent = null; this.classList = {add: name => {this.className += ' ' + name;}}; }
    append(...nodes) { for (const node of nodes) {node.parent = this; this.children.push(node);} }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); this.parent = null; }
    setAttribute(k,v) {this.attributes[k]=v;}
}
function fixture(language = 'de', reduced = false) {
    let now = 0, next = 1; const jobs = new Map();
    const body = new Element('body'), head = new Element('head');
    const win = {document:{body,head,documentElement:{lang:language},createElement: tag => new Element(tag)},
        setTimeout(fn,ms){const id=next++; jobs.set(id,{at:now+ms,fn}); return id;},
        clearTimeout(id){jobs.delete(id);},
        matchMedia(query){assert.equal(query,'(prefers-reduced-motion: reduce)');return {matches:reduced};}};
    function advance(ms) {
        const end=now+ms;
        while (true) {
            const due=[...jobs].filter(([,v]) => v.at <= end).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
            if (!due) break; now=due[1].at;jobs.delete(due[0]);due[1].fn();
        }
        now=end;
    }
    return {win,body,head,jobs,advance,controller:toast.create(win,{language})};
}
const atmosphere={format:'dolby-atmos',active:true,confirmed:true};
const vision={format:'dolby-vision',active:true,confirmed:true};
test('only explicit, format-specific activation confirmations display',()=>{
    const f=fixture(); f.controller.startSession('a');
    for(const value of [{sourceLabel:'Dolby Atmos'}, {format:'eac3',active:true,confirmed:true},
        {format:'dolby-atmos',active:true}, {format:'dolby-atmos',active:false,confirmed:true},
        {format:'dolby-atmos',active:true,confirmed:'true'}, null])
        assert.equal(f.controller.observe('a',{audio:value}),false);
    assert.equal(f.controller.observe('a',{video:{...atmosphere}}),false);
    assert.equal(f.body.children.length,0);
    assert.equal(f.controller.observe('a',{audio:atmosphere}),true);
    assert.equal(f.body.children.length,1);
});
test('both simultaneous formats display together, then fade and clear on schedule',()=>{
    const f=fixture(); f.controller.startSession('a');
    f.controller.observe('a',{audio:atmosphere,video:vision});
    const el=f.body.children[0]; assert.equal(el.attributes.role,'status');
    assert.equal(el.attributes['aria-live'],'polite');
    assert.equal(el.attributes['aria-label'],'Dolby Atmos · Dolby Vision aktiviert');
    assert.deepEqual(el.children[1].children.map(x=>x.textContent),['Dolby Atmos','Dolby Vision']);
    f.advance(4499); assert.doesNotMatch(el.className,/is-fading/);
    f.advance(1); assert.match(el.className,/is-fading/);
    f.advance(349); assert.equal(f.body.children.length,1);
    f.advance(1); assert.equal(f.body.children.length,0);
    assert.equal(f.jobs.size,0);
});
test('repeated polling does not extend the timer and later second confirmation is shown only once',()=>{
    const f=fixture(); f.controller.startSession(1); f.controller.observe(1,{audio:atmosphere});
    f.advance(2000); assert.equal(f.controller.observe(1,{audio:atmosphere}),false);
    f.advance(2500); assert.match(f.body.children[0].className,/is-fading/);
    f.controller.observe(1,{audio:atmosphere,video:vision});
    assert.equal(f.body.children[0].attributes['aria-label'],'Dolby Atmos · Dolby Vision aktiviert');
    f.advance(4850);assert.equal(f.body.children.length,0);
    assert.equal(f.controller.observe(1,{video:vision,audio:atmosphere}),false);
    assert.equal(f.body.children.length,0);
});
test('session replacement, stop and stale observations cannot resurrect old toast',()=>{
    const f=fixture();const c=f.controller; c.startSession('one'); c.observe('one',{audio:atmosphere});
    c.startSession('two'); assert.equal(f.body.children.length,0); assert.equal(f.jobs.size,0);
    assert.equal(c.observe('one',{audio:atmosphere}),false);
    assert.equal(c.startSession('one'),false);
    assert.equal(c.stop('one'),false); assert.equal(c.observe('two',{video:vision}),true);
    assert.equal(c.stop('two'),true); assert.equal(f.body.children.length,0);
    assert.equal(c.observe('two',{audio:atmosphere}),false);assert.equal(c.startSession('two'),false);f.advance(10000);
    assert.equal(f.body.children.length,0);
});
test('reduced motion removes without fade and English label is accessible',()=>{
    const f=fixture('en-US',true);f.controller.startSession('x');f.controller.observe('x',{audio:atmosphere});
    assert.equal(f.body.children[0].attributes['aria-label'],'Dolby Atmos active');
    f.advance(4500); assert.equal(f.body.children.length,0); assert.equal(f.jobs.size,0);
    assert.match(f.head.children[0].textContent,/prefers-reduced-motion:reduce/);
});
test('destroy cleans style, pending timers and element and controller cannot restart',()=>{
    const f=fixture();const c=f.controller;c.startSession('x');c.observe('x',{audio:atmosphere});
    c.destroy();c.destroy(); assert.equal(f.body.children.length,0);assert.equal(f.head.children.length,0);
    assert.equal(f.jobs.size,0);assert.equal(c.startSession('y'),false);
    assert.equal(c.observe('x',{audio:atmosphere}),false);
});
test('style is pointer transparent, responsive, high layer and safe-area aware',()=>{
    const f=fixture(); const css=f.head.children[0].textContent;
    for(const pattern of [/pointer-events:none/,/safe-area-inset-top/,/safe-area-inset-right/,/z-index:2147483000/,/@media\(max-width:480px\)/])
        assert.match(css,pattern);
});

test('an invalidated format is removed and cannot reappear in a later combined notice',()=>{
    const f=fixture();const c=f.controller;c.startSession('x');c.observe('x',{audio:atmosphere});
    assert.equal(c.observe('x',{audio:{...atmosphere,active:false}}),false);
    assert.equal(f.body.children.length,0);
    c.observe('x',{video:vision});
    assert.equal(f.body.children[0].attributes['aria-label'],'Dolby Vision aktiviert');
});
