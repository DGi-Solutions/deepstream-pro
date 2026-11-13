'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

test('cover stays visible beneath the hover controls', t => {
    const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
    const browser = candidates.find(p => fs.existsSync(p));
    if (!browser) { t.skip('Set CHROME_PATH to a Chromium browser to run the computed-style regression'); return; }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deepstream-header-test-'));
    try {
        const fixture = pathToFileURL(path.join(__dirname,'fixtures','deepstream-card-hover.html')).href;
        const result = spawnSync(browser, ['--headless','--disable-gpu','--disable-background-networking',
            '--user-data-dir='+profile,'--dump-dom',fixture], {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
        assert.equal(result.status,0,'Headless browser did not complete');
        const output = result.stdout.match(/<output id="result">([^<]+)<\/output>/);
        assert.ok(output,'Fixture did not return results');
        const report=JSON.parse(output[1]);
        assert.equal(report.ok,true,JSON.stringify(report));
    } finally {fs.rmSync(profile,{recursive:true,force:true});}
});
