const assert = require('node:assert/strict');
const {remoteLoader, publicImage, different, secondaryHeight} = require('../native/artwork.js');
assert.equal(publicImage('https://image.tmdb.org/t/p/w1280/example.jpg'), 'https://image.tmdb.org/t/p/w1280/example.jpg');
for (const value of ['http://image.tmdb.org/a.jpg', 'https://private.example/a.jpg', 'https://user:secret@image.tmdb.org/a.jpg', 'https://image.tmdb.org/a.jpg?token=secret', 'data:image/png,private']) assert.equal(publicImage(value), null);
assert.equal(different([20, 40, 60], [21, 39, 61]), false, 'resized copies of one motif are excluded');
assert.equal(different([20, 40, 60], [180, 160, 140]), true);
assert.equal(secondaryHeight(50, 1510), 1000, 'second motif begins directly below the hero and covers the natural content height');
assert.equal(secondaryHeight(0, 100), 0);
(async () => {
    let calls = 0, user = 'a', request;
    const api = {getCurrentUserId: () => user, getUrl: (path, query) => ({path, query}), ajax: async options => {
        calls++; request = options;
        return {Images: [{Url: 'https://image.tmdb.org/t/p/w1280/example.jpg'}, {Url: 'https://private.example/secret.jpg'}]};
    }};
    const load = remoteLoader();
    const a = await load(api, user, {Id: 'synthetic-film'});
    assert.equal(a.length, 1); assert.equal(request.type, 'GET');
    assert.equal(request.url.path, 'Items/synthetic-film/RemoteImages');
    assert.equal(request.url.query.type, 'Backdrop');
    await load(api, user, {Id: 'synthetic-film'}); assert.equal(calls, 1, 'reuse provider metadata within the session cache');
    user = 'b'; await load(api, user, {Id: 'synthetic-film'}); assert.equal(calls, 2, 'cache is separated by account');
    assert.deepEqual(await load({...api, ajax: async () => {throw new Error('offline');}}, user, {Id: 'offline'}), []);
    console.log('Artwork: distinct motifs, natural scroll height, read-only provider lookup, account cache and public image filtering passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
