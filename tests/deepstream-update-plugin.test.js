const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const latest = 'https://github.com/DGi-Solutions/deepstream-pro/releases/latest';
const release = version => `https://github.com/DGi-Solutions/deepstream-pro/releases/tag/v${version}`;
const tick = () => new Promise(setImmediate);

async function setup({version = '1.2.3', lang = 'en', rejectConfirm = false,
    fetchResult = {ok: true, url: release('1.3.0')}, fetchError = false, delay = false,
    locale = true, apiError = false} = {}) {
    const calls = {fetch: [], checks: 0, dialogs: [], opened: [], timers: []};
    let notify;
    const system = {
        updateInfoEmitted: {connect: fn => {notify = fn;}},
        checkForUpdates: () => {calls.checks++;},
        openExternalUrl: url => {calls.opened.push(url);}
    };
    const context = vm.createContext({
        URL, Set,
        window: {
            jmpInfo: {version}, document: {documentElement: {lang}}, navigator: {language: lang},
            apiPromise: apiError ? Promise.reject(new Error('test channel failure')) : Promise.resolve({system}),
            DeepStreamLocale: locale ? {language: win => win.document.documentElement.lang.startsWith('de') ? 'de' : 'en'} : undefined
        },
        fetch: async (...args) => {
            calls.fetch.push(args);
            if (fetchError) throw new Error('test offline');
            return fetchResult;
        },
        setTimeout: (fn, ms) => {calls.timers.push({fn, ms}); if (!delay) fn();}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/updatePlugin.js'), 'utf8'), context);
    new context.window._updatePlugin({confirm: async options => {
        calls.dialogs.push(options);
        if (rejectConfirm) throw new Error('test cancel');
    }});
    await tick();
    return {calls, context, emit: value => notify?.(value), hasHandler: () => !!notify};
}

test('Mac checks only the DeepStream latest URL and opens its confirmed canonical stable release', async () => {
    const {calls, emit} = await setup();
    await emit('SSL_UNAVAILABLE');
    assert.equal(calls.checks, 1);
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.fetch[0][0], latest);
    assert.equal(calls.fetch[0][1].credentials, 'omit');
    assert.equal(calls.fetch[0][1].referrerPolicy, 'no-referrer');
    assert.deepEqual(calls.opened, [release('1.3.0')]);
    assert.equal(calls.dialogs.length, 1);
    assert.equal(calls.dialogs[0].text, 'DeepStream Pro 1.3.0 is available.');
    assert.equal(calls.dialogs[0].confirmText, 'Open release');
    assert.equal(calls.timers[0].ms, 3000);
});

test('the native redirect path does not fetch another endpoint', async () => {
    const {calls, emit} = await setup();
    await emit(release('1.2.4'));
    assert.equal(calls.fetch.length, 0);
    assert.deepEqual(calls.opened, [release('1.2.4')]);
});

test('alpha, prerelease, development and unknown current versions do not check or prompt', async () => {
    for (const version of ['0.2.0-alpha', '0.2.0-alpha.2', '2.1.0-pre8', '2.0.0-dev',
        '1.2.3-rc.1', '1.2.3+build.3', '', null, undefined, 'unknown', '01.2.3', '1.2']) {
        const {calls, hasHandler} = await setup({version: version === undefined ? '' : version});
        assert.equal(hasHandler(), false, String(version));
        assert.equal(calls.checks, 0, String(version));
        assert.equal(calls.fetch.length, 0);
        assert.equal(calls.dialogs.length, 0);
        assert.equal(calls.opened.length, 0);
    }
});

test('current and older stable versions do not prompt, with numeric component comparison', async () => {
    for (const [current, target] of [['1.2.3', '1.2.3'], ['1.2.3', '1.2.2'],
        ['1.2.3', '1.1.99'], ['2.0.0', '1.999.999'], ['1.10.0', '1.9.9']]) {
        const {calls, emit} = await setup({version: current});
        await emit(release(target));
        assert.equal(calls.dialogs.length, 0, `${current} -> ${target}`);
        assert.equal(calls.opened.length, 0);
    }
});

test('newer minor, major and patch versions are all recognized', async () => {
    for (const [current, target] of [['1.2.3', '1.2.4'], ['1.2.3', '1.10.0'], ['1.99.99', '2.0.0']]) {
        const {calls, emit} = await setup({version: current});
        await emit(release(target));
        assert.deepEqual(calls.opened, [release(target)]);
    }
});

test('prerelease, malformed and unsafe version tags never prompt', async () => {
    for (const tag of ['2.0.0-alpha', '2.0.0-dev', '2.0.0-pre1', '2.0.0-rc.1',
        '2.0.0+build', '02.0.0', '2.0', '2.0.0.0', '9007199254740992.0.0', '2.-1.0', '2.0.NaN']) {
        const {calls, emit} = await setup();
        await emit(release(tag));
        assert.equal(calls.dialogs.length, 0, tag);
        assert.equal(calls.opened.length, 0);
    }
});

test('foreign repository, host, credentials, download URLs and query/hash additions are rejected', async () => {
    for (const target of [
        'https://github.com/jellyfin/jellyfin-desktop/releases/tag/v9.0.0',
        'https://github.com/DGi-Solutions/another-project/releases/tag/v9.0.0',
        'https://github.com/other/deepstream-pro/releases/tag/v9.0.0',
        'https://github.com.evil.invalid/DGi-Solutions/deepstream-pro/releases/tag/v9.0.0',
        'http://github.com/DGi-Solutions/deepstream-pro/releases/tag/v9.0.0',
        'https://user:pass@github.com/DGi-Solutions/deepstream-pro/releases/tag/v9.0.0',
        'https://github.com:444/DGi-Solutions/deepstream-pro/releases/tag/v9.0.0',
        'https://github.com/DGi-Solutions/deepstream-pro/releases/download/v9.0.0/test.pkg',
        release('9.0.0') + '?download=1', release('9.0.0') + '#anything',
        release('9.0.0') + '/more', release('9.0.0') + '\n',
        'javascript:alert(1)', '/DGi-Solutions/deepstream-pro/releases/tag/v9.0.0', null, {},
        'https://github.com/DGi-Solutions/deepstream-pro/releases/latest'
    ]) {
        const {calls, emit} = await setup();
        await emit(target);
        assert.equal(calls.dialogs.length, 0, String(target));
        assert.equal(calls.opened.length, 0);
        assert.equal(calls.fetch.length, 0);
    }
});

test('a redirect from latest to a foreign URL is rejected before any prompt or open', async () => {
    const {calls, emit} = await setup({fetchResult: {ok: true,
        url: 'https://example.invalid/DGi-Solutions/deepstream-pro/releases/tag/v9.0.0'}});
    await emit('SSL_UNAVAILABLE');
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.dialogs.length, 0);
    assert.equal(calls.opened.length, 0);
});

test('the opened URL is canonical even if an equivalent repository casing and slash was emitted', async () => {
    const {calls, emit} = await setup();
    await emit('https://github.com/dgi-solutions/DEEPSTREAM-PRO/releases/tag/v1.3.0/');
    assert.deepEqual(calls.opened, [release('1.3.0')]);
});

test('cancelling the confirmation never opens a page', async () => {
    const {calls, emit} = await setup({rejectConfirm: true});
    await emit(release('1.3.0'));
    assert.equal(calls.dialogs.length, 1);
    assert.equal(calls.opened.length, 0);
    await emit(release('1.3.0'));
    assert.equal(calls.dialogs.length, 1, 'a dismissed release is not shown repeatedly in one session');
});

test('offline, failed HTTP and invalid API checks stay quiet', async () => {
    for (const options of [{fetchError: true}, {fetchResult: {ok: false, url: release('1.3.0')}},
        {fetchResult: {ok: true, url: ''}}]) {
        const {calls, emit} = await setup(options);
        await emit('SSL_UNAVAILABLE');
        assert.equal(calls.dialogs.length, 0);
        assert.equal(calls.opened.length, 0);
    }
    const {calls, hasHandler} = await setup({apiError: true});
    assert.equal(hasHandler(), false);
    assert.equal(calls.checks, 0);
});

test('a pending or repeated notification cannot create duplicate dialogs', async () => {
    const {calls, emit} = await setup({delay: true});
    const pending = emit(release('1.3.0'));
    await emit(release('1.3.0'));
    assert.equal(calls.timers.length, 1);
    calls.timers[0].fn();
    await pending;
    await emit(release('1.3.0'));
    assert.equal(calls.dialogs.length, 1);
    assert.equal(calls.opened.length, 1);
});

test('the app version is checked again after the dialog delay', async () => {
    const {calls, emit, context} = await setup({delay: true});
    const pending = emit(release('1.3.0'));
    context.window.jmpInfo.version = '1.3.0';
    calls.timers[0].fn();
    await pending;
    assert.equal(calls.dialogs.length, 0);
    assert.equal(calls.opened.length, 0);
});

test('German wording follows the existing locale helper', async () => {
    const {calls, emit} = await setup({lang: 'de-DE'});
    await emit(release('1.3.0'));
    assert.equal(calls.dialogs[0].title, 'Update für DeepStream Pro');
    assert.equal(calls.dialogs[0].text, 'DeepStream Pro 1.3.0 ist verfügbar.');
    assert.equal(calls.dialogs[0].cancelText, 'Später');
    assert.equal(calls.dialogs[0].confirmText, 'Release öffnen');
});

test('German fallback works when the optional locale helper is unavailable', async () => {
    const {calls, emit} = await setup({lang: 'de', locale: false});
    await emit(release('1.3.0'));
    assert.equal(calls.dialogs[0].title, 'Update für DeepStream Pro');
});
