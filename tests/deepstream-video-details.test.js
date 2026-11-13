'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { model } = require('../native/videoDetails.js');

function value(result, label) {
  const row = result.rows.find((item) => item.label === label);
  return row ? row.value : undefined;
}

test('reports structured HEVC video data and source Dolby Vision profile', () => {
  const source = { MediaStreams: [{
    Type: 'Video', Index: 0, Codec: 'hevc', Profile: 'Main 10', Width: 3840, Height: 2160,
    AverageFrameRate: 23.976, BitRate: 31500000, BitDepth: 10, PixelFormat: 'yuv420p10le',
    VideoRangeType: 'DOVIWithHDR10', ColorSpace: 'bt2020nc', ColorTransfer: 'smpte2084',
    ColorPrimaries: 'bt2020', AspectRatio: '16:9', DvProfile: 8, DvLevel: 6,
  }] };
  const result = model(source, 0, 'de');
  assert.equal(result.title, 'Video');
  assert.equal(value(result, 'Codec'), 'HEVC');
  assert.equal(value(result, 'Profil'), 'Main 10');
  assert.equal(value(result, 'Auflösung'), '3840 × 2160');
  assert.equal(value(result, 'Bildrate'), '23,976 fps');
  assert.equal(value(result, 'Bitrate'), '31,5 Mbit/s');
  assert.equal(value(result, 'Bittiefe'), '10 Bit');
  assert.equal(value(result, 'Pixelformat'), 'yuv420p10le');
  assert.equal(value(result, 'Dynamikumfang'), 'Dolby Vision / HDR10');
  assert.equal(value(result, 'Farbraum'), 'bt2020nc');
  assert.equal(value(result, 'Transferfunktion'), 'smpte2084');
  assert.equal(value(result, 'Primärfarben'), 'bt2020');
  assert.equal(value(result, 'Seitenverhältnis'), '16:9');
  assert.equal(value(result, 'Dolby-Vision-Profil'), '8');
  assert.equal(value(result, 'Dolby-Vision-Level'), '6');
});

test('chooses a video index, then its default, then the first video', () => {
  const source = {
    DefaultVideoStreamIndex: 4,
    MediaStreams: [
      { Type: 'Audio', Index: 3, Codec: 'not-video' },
      { Type: 'Video', Index: 0, Codec: 'h264' },
      { Type: 'Video', Index: 4, Codec: 'av1' },
    ],
  };
  assert.equal(value(model(source, 0), 'Codec'), 'H.264');
  assert.equal(value(model(source, 4), 'Codec'), 'AV1');
  assert.equal(value(model(source, 3), 'Codec'), 'AV1');
  assert.equal(value(model(source, null), 'Codec'), 'AV1');
  assert.equal(value(model({ ...source, DefaultVideoStreamIndex: 99 }, 99), 'Codec'), 'H.264');
});

test('returns null without a usable video stream', () => {
  assert.equal(model(), null);
  assert.equal(model(null), null);
  assert.equal(model({ MediaStreams: null }), null);
  assert.equal(model({ MediaStreams: [null, { Type: 'Audio', Index: 0 }] }), null);
});

test('missing values remain null and absent Dolby Vision values do not add rows', () => {
  const result = model({ MediaStreams: [{ Type: 'Video' }] });
  assert.equal(result.rows.length, 12);
  assert.ok(result.rows.every((row) => row.value === null));
  assert.equal(value(result, 'Dolby-Vision-Profil'), undefined);
  assert.equal(value(result, 'Dolby-Vision-Level'), undefined);
});

test('rejects non-finite, null, zero and negative numeric values', () => {
  const result = model({ MediaStreams: [{
    Type: 'Video', Width: NaN, Height: Infinity, AverageFrameRate: null, RealFrameRate: -1,
    BitRate: Infinity, BitDepth: 0, DvProfile: NaN, DvLevel: null,
  }] });
  for (const label of ['Auflösung', 'Bildrate', 'Bitrate', 'Bittiefe']) {
    assert.equal(value(result, label), null);
  }
  assert.equal(value(result, 'Dolby-Vision-Profil'), undefined);
  assert.equal(value(result, 'Dolby-Vision-Level'), undefined);
});

test('uses a valid fallback frame rate and localizes numbers without grouping dimensions', () => {
  const source = { MediaStreams: [{
    Type: 'Video', Codec: 'vp9', Width: 1920, Height: 1080, AverageFrameRate: Infinity,
    RealFrameRate: 29.97, BitRate: 2500000,
  }] };
  const de = model(source, undefined, 'de');
  const en = model(source, undefined, 'en-US');
  assert.equal(value(de, 'Codec'), 'VP9');
  assert.equal(value(de, 'Auflösung'), '1920 × 1080');
  assert.equal(value(de, 'Bildrate'), '29,97 fps');
  assert.equal(value(de, 'Bitrate'), '2,5 Mbit/s');
  assert.equal(value(en, 'Bildrate'), '29.97 fps');
  assert.equal(value(en, 'Bitrate'), '2.5 Mbit/s');
  assert.equal(value(model({ MediaStreams: [{ Type: 'Video', BitRate: 750000 }] }), 'Bitrate'), '750 kbit/s');
});

test('maps known structured source ranges without inventing display capabilities', () => {
  const expected = [
    ['SDR', 'SDR'], ['HDR10', 'HDR10'], ['HLG', 'HLG'], ['HDR10Plus', 'HDR10+'],
    ['DOVIWithHDR10', 'Dolby Vision / HDR10'],
    ['DOVIWithHDR10Plus', 'Dolby Vision / HDR10+'],
  ];
  for (const [input, display] of expected) {
    const result = model({ MediaStreams: [{ Type: 'Video', VideoRangeType: input }] });
    assert.equal(value(result, 'Dynamikumfang'), display);
    assert.ok(!result.rows.some((row) => /passthrough|hardware|display/i.test(row.label)));
  }
});

test('does not infer HDR or Dolby Vision from free titles', () => {
  const result = model({ MediaStreams: [{
    Type: 'Video', Codec: 'hevc', Title: 'Dolby Vision Profile 8.1 HDR10',
    DisplayTitle: 'Dolby Vision 8.1 HDR10+',
  }] });
  assert.equal(value(result, 'Dynamikumfang'), null);
  assert.equal(value(result, 'Dolby-Vision-Profil'), undefined);
  assert.equal(value(result, 'Dolby-Vision-Level'), undefined);
});

test('bounds unrecognized structured text and treats it as text', () => {
  const result = model({ MediaStreams: [{ Type: 'Video', VideoRangeType: '<unsafe>' + 'x'.repeat(100) }] });
  assert.ok(value(result, 'Dynamikumfang').length <= 80);
  assert.doesNotMatch(value(result, 'Dynamikumfang'), /[<>]/);
});

test('exports the same model as a browser UMD global without browser APIs', () => {
  const source = fs.readFileSync(path.join(__dirname, '../native/videoDetails.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(typeof context.DeepStreamVideoDetails.model, 'function');
  const result = context.DeepStreamVideoDetails.model({ MediaStreams: [{ Type: 'Video', Codec: 'av1' }] });
  assert.equal(result.rows[0].value, 'AV1');
});
