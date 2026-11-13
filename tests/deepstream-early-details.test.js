const assert = require('node:assert/strict');
const {createLoader} = require('../native/audioDetails.js');

(async () => {
    let resolveCapabilities;
    const renders = [];
    const source = {MediaStreams: [{Type: 'Audio', Index: 1, Codec: 'aac'}]};
    const loader = createLoader({initialRender: true,
        fetchItem: async () => ({Type: 'Movie', MediaSources: [source]}),
        fetchCapabilities: () => new Promise(resolve => resolveCapabilities = resolve),
        render: (value, context, item, selectedSource) => renders.push({value, selectedSource}),
        unavailable() {throw new Error('Unexpected failure');}});
    const completion = loader.update({settings: {}, isCurrent: () => true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders.length, 1, 'Source details and layout must render while the native decoder query is pending');
    assert.equal(renders[0].selectedSource, source);
    resolveCapabilities({decoderEnumerationAvailable: true, decoders: ['aac']});
    await completion;
    assert.equal(renders.length, 2);
    assert.equal(renders[1].value.decoder, 'Verfügbar');
    console.log('Early source layout does not wait for native decoder enumeration.');
})().catch(error => {console.error(error); process.exitCode = 1;});
