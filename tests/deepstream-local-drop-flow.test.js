const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const qml = fs.readFileSync(path.join(__dirname, '../src/ui/webview.qml'), 'utf8');
function extract(name) {
  const start = qml.indexOf(`  function ${name}(`); assert.notEqual(start, -1);
  const open = qml.indexOf('{', start); let depth = 0;
  for (let i = open; i < qml.length; i++) {
    if (qml[i] === '{') depth++;
    if (qml[i] === '}' && --depth === 0) return qml.slice(start, i + 1);
  }
  throw Error('unterminated');
}
function harness() {
  let token = '3:-1'; const opened = []; let allowOpen = true;
  const ctx = { Qt: {CopyAction: 1}, localMediaEnabled: true, localDropToken: '',
    localMediaController: {
      canDropFile: value => { try {const u = new URL(value); return u.protocol === 'file:' && !u.host && !u.search && !u.hash && !!u.pathname;} catch {return false;} },
      dropInteractionToken: () => token,
    },
    openLocalMedia: value => {opened.push(value); return allowOpen;},
  };
  vm.createContext(ctx);
  vm.runInContext(['localDropFile', 'beginLocalDrop', 'finishLocalDrop'].map(extract).join('\n'), ctx);
  return {ctx, opened, change: value => {token = value;}, rejectOpen: () => {allowOpen = false;}};
}
function event(urls, supportedActions = 1) {
  return {hasUrls: urls.length > 0, urls, supportedActions, accepted: true,
    action: null, accept(action) {this.accepted = true; this.action = action;}};
}
test('one local drop opens in copy mode, never move', () => {
  const h=harness(), e=event(['file:///tmp/Film%20A.mkv'],3);
  assert.equal(h.ctx.beginLocalDrop(e),true); assert.equal(e.action,1);
  assert.equal(h.ctx.finishLocalDrop(e),true); assert.equal(e.action,1);
  assert.deepEqual(h.opened,['file:///tmp/Film%20A.mkv']);
  assert.equal(h.ctx.localDropToken,'');
});
for (const [name,urls] of [['remote',['https://example.com/video']],['remote file host',['file://remote/share.mkv']],['empty',[]],['multiple',['file:///a','file:///b']],['query',['file:///a?token=x']],['fragment',['file:///a#x']]]) {
  test(`${name} is rejected without player mutation`,()=>{
    const h=harness(), e=event(urls); assert.equal(h.ctx.beginLocalDrop(e),false);
    assert.equal(e.accepted,false); assert.deepEqual(h.opened,[]);
  });
}
test('a move-only source is rejected, not moved',()=>{
  const h=harness(), e=event(['file:///tmp/a.mkv'],2);
  assert.equal(h.ctx.beginLocalDrop(e),false); assert.equal(e.accepted,false); assert.deepEqual(h.opened,[]);
});
test('player or playlist changes while dragging invalidate the drop',()=>{
  const h=harness(), e=event(['file:///tmp/a.mkv']);
  assert.equal(h.ctx.beginLocalDrop(e),true); h.change('4:42:42');
  assert.equal(h.ctx.finishLocalDrop(e),false); assert.equal(e.accepted,false); assert.deepEqual(h.opened,[]);
});
test('missing player token and a failed open are not acknowledged as drops',()=>{
  const h=harness(), e=event(['file:///tmp/a.mkv']); h.change('');
  assert.equal(h.ctx.beginLocalDrop(e),false); h.change('5:-1');
  assert.equal(h.ctx.beginLocalDrop(e),true); h.rejectOpen();
  assert.equal(h.ctx.finishLocalDrop(e),false); assert.equal(e.accepted,false);
});

test("release gate rejects local drops without opening the player", () => {
  const h = harness(), e = event(["file:///tmp/sample.mp4"]);
  h.ctx.localMediaEnabled = false;
  assert.equal(h.ctx.beginLocalDrop(e), false);
  assert.equal(e.accepted, false);
  assert.deepEqual(h.opened, []);
});
