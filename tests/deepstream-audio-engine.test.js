const assert = require('node:assert/strict');
const {describe, plan} = require('../native/audioEngine.js');

const caps = {decoderEnumerationAvailable: true, decoders: ['truehd', 'eac3', 'ac3', 'dts', 'flac', 'alac', 'aac', 'pcm_s24le'], objectAudioRoutes: []};
const audio = (Index, Codec, fields = {}) => ({Type: 'Audio', Index, Codec, Language: 'deu', Channels: 6, ...fields});
const sources = [
    audio(2, 'truehd', {Channels: 8, Profile: 'Dolby TrueHD + Dolby Atmos', BitDepth: 24}),
    audio(4, 'eac3', {Profile: 'Dolby Digital Plus + Dolby Atmos'}),
    audio(7, 'dts', {Profile: 'DTS-HD MA', BitDepth: 24}),
    audio(8, 'ac3'),
    audio(12, 'aac', {Channels: 2})
];
const makePlan = overrides => plan({streams: sources, selectedIndex: 8, capabilities: caps, ...overrides});

assert.equal(describe(sources[0]).objectFormat, 'atmos');
assert.equal(describe(sources[1]).label, 'Dolby Digital Plus / Atmos');
assert.equal(describe(audio(0, 'dts', {Profile: 'DTS-HD MA', AudioSpatialFormat: 'DtsX'})).objectFormat, 'dtsx');
assert.equal(describe(audio(0, 'dts', {AudioSpatialFormat: 'DtsX'})).lossless, false);
assert.equal(describe(audio(0, 'aac', {Title: 'TrueHD Atmos DTS:X'})).objectFormat, null);
assert.equal(describe(audio(0, 'eac3', {Title: 'Atmos'})).objectFormat, null);
assert.equal(describe(audio(0, 'pcm_s24le')).lossless, true);
assert.equal(describe(audio(0, 'flac')).lossless, true);
assert.equal(describe(audio(0, 'alac')).lossless, true);
assert.equal(describe(audio(0, 'ac3')).lossless, false);

let result = makePlan();
assert.equal(result.selectedIndex, 2);
assert.equal(result.nativeObjectRoute, false);
assert.equal(result.reason, 'lossless_decode');
const nativeCaps = {...caps, objectAudioRoutes: [{codec: 'eac3', format: 'atmos', available: true, preservesSpatialMetadata: true}]};
assert.equal(makePlan({capabilities: nativeCaps}).selectedIndex, 4);
assert.equal(makePlan({capabilities: nativeCaps}).nativeObjectRoute, true);
assert.equal(makePlan({capabilities: {...nativeCaps, objectAudioRoutes: [{...nativeCaps.objectAudioRoutes[0], preservesSpatialMetadata: false}]}}).selectedIndex, 2);
assert.equal(makePlan({capabilities: {...nativeCaps, objectAudioRoutes: [{...nativeCaps.objectAudioRoutes[0], sampleRates: [48000]}]}}).selectedIndex, 2);
assert.equal(makePlan({capabilities: {...caps, decoders: ['aac']}}).selectedIndex, 12);
assert.equal(makePlan({capabilities: {}}).selectedIndex, 8);
assert.equal(makePlan({playMethod: 'Transcode'}).selectedIndex, 8);
assert.equal(makePlan({playMethod: 'DirectStream'}).selectedIndex, 8);
assert.equal(makePlan({mode: 'manual'}).selectedIndex, 8);
assert.equal(makePlan({selectedIndex: -1}).selectedIndex, -1);
assert.equal(makePlan({failedIndices: [2]}).selectedIndex, 7);
assert.equal(makePlan({failedIndices: [2, 7]}).selectedIndex, 4);
assert.equal(makePlan({failedIndices: sources.map(s => s.Index)}).reason, 'no_supported_alternative');

const languageTest = [audio(1, 'aac', {Language: 'de', Channels: 2}), audio(2, 'truehd', {Language: 'eng', Channels: 8}), audio(3, 'ac3', {Language: 'ger'})];
assert.equal(plan({streams: languageTest, selectedIndex: 1, capabilities: caps}).selectedIndex, 3);
assert.equal(plan({streams: [audio(1, 'aac', {Language: 'und'}), audio(2, 'truehd', {Language: 'eng'})], selectedIndex: 1, capabilities: caps}).selectedIndex, 1);
const commentary = [audio(1, 'aac', {Channels: 2}), audio(2, 'truehd', {Title: 'Director Commentary', Channels: 8}), audio(3, 'flac', {IsAudioDescription: true, Channels: 8})];
assert.equal(plan({streams: commentary, selectedIndex: 1, capabilities: caps}).selectedIndex, 1);
assert.equal(plan({streams: commentary, selectedIndex: 3, capabilities: caps}).selectedIndex, 3, 'audio description must not switch to commentary');
assert.equal(plan({streams: [audio(1, 'ac3'), audio(2, 'truehd', {Title: 'Regiekommentar'})], selectedIndex: 1, capabilities: caps}).selectedIndex, 1);
assert.equal(makePlan({capabilities: null}).selectedIndex, 8);
assert.equal(plan({streams: [null, {}, audio(0, 'ac3'), audio(8, 'truehd', {IsExternal: true})], selectedIndex: 0, capabilities: caps}).selectedIndex, 0);
assert.equal(plan({streams: [audio(0, 'ac3'), {...audio(2, 'truehd'), Index: '2'}], selectedIndex: 0, capabilities: caps}).selectedIndex, 0);
assert.equal(plan().selectedIndex, -1);
assert.equal(plan({streams: []}).selectedIndex, -1);
assert.equal(describe(audio(0, 'truehd', {Channels: '<script>', BitRate: Infinity})).channels, 0);

assert.equal(describe(audio(0, '__proto__')).label, '__PROTO__');
assert.equal(describe(null).label, 'Unbekannt');

console.log('Audio engine: format detection, real capabilities, native-object preference, language, manual mode, remux/transcode, alternatives and malformed metadata passed.');
