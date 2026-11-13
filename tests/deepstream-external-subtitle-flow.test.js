const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const qml = fs.readFileSync(path.join(__dirname, '../src/ui/webview.qml'), 'utf8');
function extract(name) {
  const start = qml.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  const open = qml.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < qml.length; i++) {
    if (qml[i] === '{') depth++;
    if (qml[i] === '}' && --depth === 0) return qml.slice(start, i + 1);
  }
  throw new Error('unterminated function');
}
function harness() {
  const calls = [];
  let current = '7';
  const ctx = {
    localMediaEnabled: true, localSubtitleDialogToken: '', localMediaError: '', qsTr: value => value,
    localSubtitleDialog: {open: () => calls.push(['dialog'])},
    localMediaController: {
      subtitleDialogToken: () => current,
      addSubtitleFile: (file, token) => {calls.push(['add', file, token]); return token !== '' && token === current;},
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`${extract('openLocalSubtitleDialog')}\n${extract('acceptLocalSubtitle')}`, ctx);
  return {ctx, calls, changeSession: value => { current = value; }};
}
test('no dialog opens while no local session is ready', () => {
  const h = harness(); h.changeSession('');
  assert.equal(h.ctx.openLocalSubtitleDialog(), false);
  assert.deepEqual(h.calls, []);
});
test('selected subtitle is sent once with the bound session token', () => {
  const h = harness();
  assert.equal(h.ctx.openLocalSubtitleDialog(), true);
  assert.equal(h.ctx.acceptLocalSubtitle('file:///tmp/title.srt'), true);
  assert.deepEqual(h.calls, [['dialog'], ['add', 'file:///tmp/title.srt', '7']]);
  assert.equal(h.ctx.localSubtitleDialogToken, '');
});
test('switching sessions while the dialog is open rejects the old selection', () => {
  const h = harness(); h.ctx.openLocalSubtitleDialog(); h.changeSession('8');
  assert.equal(h.ctx.acceptLocalSubtitle('file:///tmp/private-name.srt'), false);
  assert.equal(h.ctx.localSubtitleDialogToken, '');
  assert.ok(!h.ctx.localMediaError.includes('private-name'));
});
test('a repeated acceptance cannot reuse a consumed token', () => {
  const h = harness(); h.ctx.openLocalSubtitleDialog();
  assert.equal(h.ctx.acceptLocalSubtitle('file:///tmp/title.srt'), true);
  assert.equal(h.ctx.acceptLocalSubtitle('file:///tmp/title.srt'), false);
});

test("release gate blocks subtitle dialog and selection", () => {
  const h = harness(); h.ctx.localMediaEnabled = false;
  assert.equal(h.ctx.openLocalSubtitleDialog(), false);
  assert.equal(h.ctx.acceptLocalSubtitle("file:///tmp/title.srt"), false);
  assert.deepEqual(h.calls, []);
});
