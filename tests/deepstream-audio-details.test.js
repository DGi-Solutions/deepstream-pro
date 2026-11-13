const assert = require('node:assert/strict');
const {model, createLoader, rate, bitrate, readSettings, trackLabel, artworkSources, isMediaPage} = require('../native/audioDetails.js');
const caps = {decoderEnumerationAvailable: true, decoders: ['truehd', 'eac3', 'aac'], objectAudioRoutes: []};
const spatialSettings = {streamSelection: 'auto', spatialAudio: true, devicetype: 'basic', device: 'auto', channels: 'auto', exclusive: false};
const source = {Id: 'synthetic-a', DefaultAudioStreamIndex: 2, MediaStreams: [
    {Index: 0, Type: 'Video', Codec: 'hevc'},
    {Index: 2, Type: 'Audio', Codec: 'truehd', Profile: 'Dolby TrueHD + Dolby Atmos', Channels: 8, ChannelLayout: '7.1', Language: 'deu', BitRate: 5600000, SampleRate: 48000, BitDepth: 24},
    {Index: 5, Type: 'Audio', Codec: 'eac3', Profile: 'Dolby Digital Plus', Channels: 6, Language: 'deu', BitRate: 640000},
    {Index: 8, Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'eng'}
]};
const view = overrides => model({source, selectedIndex: 2, settings: spatialSettings, capabilities: caps, ...overrides});
const rows = value => Object.fromEntries(value.rows);
const cleanLabel = trackLabel({...source.MediaStreams[1], Title: 'TrueHD Atmos 7.1 mixed by Teststudio', DisplayTitle: 'mixed by Teststudio'});
assert.equal(cleanLabel, 'Deutsch · TrueHD / Atmos · 7.1 · 48 kHz · 24 Bit · 5,6 Mbit/s');
assert.equal(cleanLabel.includes('Teststudio'), false);
const imageCalls = [];
const imageApi = {getScaledImageUrl(id, options) {
    imageCalls.push({id, ...options});
    const path = '/Items/' + id + '/Images/' + options.type + (options.index == null ? '' : '/' + options.index);
    delete options.type; delete options.index;
    return path;
}};
assert.deepEqual(artworkSources(imageApi, {Id: 'film', BackdropImageTags: ['film-tag'], ParentBackdropItemId: 'series', ParentBackdropImageTags: ['series-tag'], ImageTags: {Primary: 'cover-tag'}}),
    ['/Items/film/Images/Backdrop/0', '/Items/series/Images/Backdrop/0', '/Items/film/Images/Primary']);
assert.equal(imageCalls[0].index, 0, 'backdrops use the indexed server endpoint');
assert.equal(imageCalls[1].tag, 'series-tag');
assert.deepEqual(artworkSources(imageApi, {Id: 'film', BackdropImageTags: ['first', 'second', 'first']}), ['/Items/film/Images/Backdrop/0', '/Items/film/Images/Backdrop/1'], 'use distinct available motifs and exclude repeated image tags');
assert.deepEqual(artworkSources(imageApi, {Id: 'episode', ParentBackdropItemId: 'series', ParentBackdropImageTags: ['series-tag']}), ['/Items/series/Images/Backdrop/0']);
assert.deepEqual(artworkSources(imageApi, {Id: 'no-images'}), [], 'do not invent image requests when the server reports no artwork');
assert.equal(isMediaPage({Type: 'Movie'}), true);
assert.equal(isMediaPage({Type: 'Episode'}), true);
assert.equal(isMediaPage({Type: 'Person'}), false, 'film artwork and hidden-poster styling must not apply to actor portraits');
assert.deepEqual(artworkSources({getScaledImageUrl() {throw new Error('unsupported helper');}, getImageUrl(id, options) {return id + ':' + options.type + ':' + options.index;}}, {Id: 'film', BackdropImageTags: ['tag']}), ['film:Backdrop:0']);
let result = view();
assert.equal(result.title, 'TrueHD / Atmos');
assert.equal(rows(result)['Sprache'], 'Deutsch');
assert.equal(rows(result)['Kanäle'], '8 · 7.1');
assert.equal(rows(result)['Bitrate'], '5,6 Mbit/s');
assert.equal(rows(result)['Abtastrate'], '48 kHz');
assert.equal(rows(result)['Bittiefe'], '24 Bit');
assert.equal(rows(result)['Kompression'], 'Verlustfrei');
assert.equal(rows(result)['Räumliche Metadaten der Quelle'], 'Dolby Atmos');
assert.equal(result.output, 'Spatial Audio · Mehrkanal-PCM');
assert.equal(result.tracks.length, 3);
assert.equal(result.decoder, 'Verfügbar');
const bridgedSettings = {};
for (const [key, value] of Object.entries(spatialSettings)) Object.defineProperty(bridgedSettings, key, {get: () => value});
assert.equal(view({settings: readSettings(bridgedSettings)}).output, 'Spatial Audio · Mehrkanal-PCM', 'the native bridge exposes non-enumerable setting getters');
result = view({selectedIndex: 5});
assert.equal(result.title, 'Dolby Digital Plus');
assert.equal(rows(result)['Bittiefe'], 'Nicht angegeben');
assert.equal(rows(result)['Kompression'], 'Verlustbehaftet');
assert.equal(result.plannedTrack, 'TrueHD / Atmos');
assert.equal(view({selectedIndex: 5, settings: {...spatialSettings, streamSelection: 'manual'}}).plannedTrack, 'Dolby Digital Plus');
assert.equal(view({capabilities: {}}).decoder, 'Noch nicht geprüft');
assert.equal(view({settings: {...spatialSettings, channels: '2.0'}}).output, 'Stereo-PCM');
assert.equal(view({settings: {...spatialSettings, devicetype: 'hdmi'}}).output, 'HDMI nach Ausgabeeinstellung');
assert.equal(view({settings: {...spatialSettings, devicetype: 'spdif'}}).output, 'S/PDIF nach Ausgabeeinstellung');
assert.equal(view({settings: {...spatialSettings, customAudioOutput: 'coreaudio'}}).output, 'Benutzerdefinierter Audioausgang');
assert.equal(model({source: {MediaStreams: []}}), null);
assert.equal(model({source: {MediaStreams: [{Type: 'Audio', Index: 0, Codec: 'aac', Title: 'Atmos 7.1'}]}}).rows.at(-1)[1], 'Nicht angegeben');
assert.equal(rate(44100), '44,1 kHz');
assert.equal(rate(Infinity), 'Nicht angegeben');
assert.equal(bitrate(640000), '640 kbit/s');
assert.equal(bitrate(0), 'Nicht angegeben');

(async () => {
    const pending = new Map(), rendered = [], failures = [];
    const loader = createLoader({fetchItem: c => new Promise((resolve, reject) => pending.set(c.id, {resolve, reject})),
        fetchCapabilities: async () => caps, render: (value, c) => rendered.push({value, id: c.id}), unavailable: c => failures.push(c.id)});
    const context = id => ({id, sourceId: 'synthetic-a', selectedIndex: 2, settings: spatialSettings, isCurrent: () => true});
    const a = loader.update(context('old-film'));
    const b = loader.update(context('current-film'));
    pending.get('current-film').resolve({MediaSources: [source]}); await b;
    pending.get('old-film').resolve({MediaSources: [source]}); await a;
    assert.deepEqual(rendered.map(r => r.id), ['current-film'], 'a late answer must not put the previous film audio on the current page');
    const c = loader.update(context('cancelled')); loader.cancel();
    pending.get('cancelled').resolve({MediaSources: [source]}); await c;
    assert.equal(rendered.length, 1, 'leaving the page must cancel its pending update');
    let currentUser = 'first-user';
    const switched = loader.update({...context('account-switch'), userId: 'first-user', api: {getCurrentUserId: () => currentUser}});
    currentUser = 'second-user';
    pending.get('account-switch').resolve({MediaSources: [source]}); await switched;
    assert.equal(rendered.length, 1, 'changing account must discard the previous account response');
    const d = loader.update(context('failed')); pending.get('failed').reject(new Error('synthetic API failure')); await d;
    assert.deepEqual(failures, ['failed']);
    let choice;
    const multi = createLoader({fetchItem: async () => ({MediaSources: [source, {Id: 'version-b', MediaStreams: [source.MediaStreams[2]]}]}),
        fetchCapabilities: async () => caps, render: value => choice = value, unavailable() {throw new Error('unexpected failure');}});
    await multi.update({...context('versioned'), sourceId: 'version-b', selectedIndex: 5});
    assert.equal(choice.title, 'Dolby Digital Plus', 'changing film version must use its own audio metadata');
    console.log('Audio details: source facts, Spatial Audio preview, manual mode, output settings, missing fields, film versions and stale-response cancellation passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
