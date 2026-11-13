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
function harness(accept = true, closeAccepted = true) {
  const calls = [];
  const ctx = {
    localMediaEnabled: true, localMediaActive: false, localMediaPaused: true, localMediaError: '', localTrackFingerprint:'x',
    localAudioTracks: { clear: () => calls.push(['clear-audio']) },
    localSubtitleTracks: { clear: () => calls.push(['clear-subtitle']) },
    qsTr: value => value,
    localMediaController: {
      open: value => {calls.push(['open', value]); return accept;},
      close: () => { calls.push(['close']); return closeAccepted; },
    },
    components: {player: {
      setVideoOnlyMode: value => calls.push(['visible', value]),
    }},
  };
  vm.createContext(ctx);
  vm.runInContext(`${extract('openLocalMedia')}\n${extract('closeLocalMedia')}\n${extract('handleLocalStartupFailure')}`, ctx);
  return { ctx, calls };
}
test('opening a user-selected file starts local controller and hides web view', () => {
  const { ctx, calls } = harness();
  assert.equal(ctx.openLocalMedia('file:///tmp/Clip%20%E2%82%AC.mkv'), true);
  assert.equal(calls[0][1], 'file:///tmp/Clip%20%E2%82%AC.mkv');
  assert.deepEqual(calls.at(-1), ['visible', true]);
  assert.equal(ctx.localMediaActive, true);
});
test('network or empty input never reaches the player', () => {
  const { ctx, calls } = harness();
  assert.equal(ctx.openLocalMedia('https://example.com/file.mkv'), false);
  assert.equal(ctx.openLocalMedia(''), false);
  assert.equal(calls.length, 0);
});
test('a rejected player request does not hide the web view', () => {
  const { ctx, calls } = harness(false);
  assert.equal(ctx.openLocalMedia('file:///missing.mp4'), false);
  assert.equal(ctx.localMediaActive, false);
  assert.deepEqual(calls.map(c => c[0]), ['open']);
  assert.ok(ctx.localMediaError);
});
test('close stops the active player once and restores the web view', () => {
  const { ctx, calls } = harness();
  ctx.openLocalMedia('file:///tmp/sample.mp4');
  ctx.closeLocalMedia();
  ctx.closeLocalMedia();
  assert.equal(ctx.localMediaActive, false);
  assert.equal(calls.filter(c => c[0] === 'close').length, 1);
  assert.deepEqual(calls.at(-1), ['visible', false]);
});
test('an invalidated local view cannot close an externally started player', () => {
  const { ctx, calls } = harness();
  ctx.openLocalMedia('file:///tmp/sample.mp4');
  ctx.localMediaActive = false; // controller invalidated after an external request
  ctx.closeLocalMedia();
  assert.equal(calls.filter(c => c[0] === 'close').length, 0);
});
test('a local failure reports no path or URL', () => {
  const {ctx} = harness(false);
  const privateUrl = 'file:///tmp/private-film-name.mkv';
  ctx.openLocalMedia(privateUrl);
  assert.ok(ctx.localMediaError);
  assert.ok(!ctx.localMediaError.includes('private-film-name'));
});
test('unknown ownership prevents global stop and keeps local controls visible', () => {
  const {ctx, calls} = harness(true, false);
  ctx.openLocalMedia('file:///tmp/a.mp4'); ctx.closeLocalMedia();
  assert.equal(ctx.localMediaActive, true);
  assert.ok(ctx.localMediaError);
  assert.equal(calls.filter(c => c[0] === 'visible' && c[1] === false).length, 0);
});
test('failed startup returns to web only after scoped cancellation succeeds', () => {
  const first = harness(); first.ctx.openLocalMedia('file:///tmp/a.mp4');
  first.ctx.handleLocalStartupFailure(false);
  assert.equal(first.ctx.localMediaActive, true);
  assert.ok(first.ctx.localMediaError);
  const second = harness(); second.ctx.openLocalMedia('file:///tmp/b.mp4');
  second.ctx.handleLocalStartupFailure(true);
  assert.equal(second.ctx.localMediaActive, false);
  assert.deepEqual(second.calls.at(-1), ['visible', false]);
});

test("release gate blocks local opening without touching the player", () => {
  const {ctx, calls} = harness();
  ctx.localMediaEnabled = false;
  assert.equal(ctx.openLocalMedia("file:///tmp/sample.mp4"), false);
  assert.equal(ctx.localMediaActive, false);
  assert.deepEqual(calls, []);
});
