const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
function harness(width, contentWidth, contentX = 0) {
  const localMediaScroll = {width, contentWidth, contentX, contentItem: {}};
  const ctx = {localMediaScroll}; vm.createContext(ctx);
  vm.runInContext(extract('revealLocalControl'), ctx);
  return {ctx, scroll: localMediaScroll, control: (x, width) => ({width, mapToItem: () => ({x})})};
}
test('keyboard focus reveals a close button beyond a 213px viewport', () => {
  const h = harness(213, 1100); h.ctx.revealLocalControl(h.control(1020, 70));
  assert.equal(h.scroll.contentX, 877);
});
test('keyboard focus returns to a control left of the viewport', () => {
  const h = harness(213, 1100, 800); h.ctx.revealLocalControl(h.control(10, 60));
  assert.equal(h.scroll.contentX, 10);
});
test('already visible controls leave the viewport unchanged', () => {
  const h = harness(213, 1100, 400); h.ctx.revealLocalControl(h.control(450, 100));
  assert.equal(h.scroll.contentX, 400);
});
test('oversized controls use their start and scrolling stays in bounds', () => {
  const h = harness(100, 250, 30); h.ctx.revealLocalControl(h.control(220, 180));
  assert.equal(h.scroll.contentX, 150);
});
test('no overflow clamps content offset to zero', () => {
  const h = harness(400, 200, 10); h.ctx.revealLocalControl(h.control(190, 80));
  assert.equal(h.scroll.contentX, 0);
});
