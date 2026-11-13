'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const capture = () => {const messages = []; return {messages, console: Object.fromEntries(['debug','log','error'].map(level => [level, (...args) => messages.push(args.join(' '))]))};};
const syntheticMedia = 'https://example.invalid/private-media?token=synthetic-token';
const syntheticSub = 'https://example.invalid/private-caption?token=synthetic-caption';
function body(source, marker) {
    let start = source.indexOf(marker); assert.notEqual(start, -1);
    start = source.indexOf('{', start); let depth = 0, quote = '', escape = false;
    for (let i = start; i < source.length; ++i) {
        const c = source[i];
        if (quote) {if (escape) escape = false; else if (c === '\\') escape = true; else if (c === quote) quote = ''; continue;}
        if (c === '"' || c === "'" || c === '`') {quote = c; continue;}
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return source.slice(start + 1, i);
    }
    throw new Error('unterminated handler');
}

test('player forwards synthetic source and subtitle without logging them', async () => {
    const out = capture(), calls = [];
    const playerApi = {setSubtitleStream: value => {calls.push(['subtitle', value]);}, getAudioCapabilities: cb => cb({}), load: (...args) => {calls.push(args.slice(0,-1));args.at(-1)(true);}};
    const ctx = vm.createContext({window:{api:{player:playerApi},jmpInfo:{settings:{audio:{}}}}, jmpInfo:{userAgent:'test'}, document:{createElement:()=>({setAttribute(){},protocol:'https:'})}, console:out.console, setTimeout, clearTimeout});
    vm.runInContext(fs.readFileSync(path.join(root,'native/mpvVideoPlayer.js'),'utf8'),ctx);
    const player = Object.create(ctx.window._mpvVideoPlayer.prototype);
    const options = {url:syntheticMedia,playMethod:'DirectPlay',item:{},mediaSource:{DefaultAudioStreamIndex:-1,DefaultSubtitleStreamIndex:2,MediaStreams:[{Type:'Subtitle',Index:2,DeliveryMethod:'External',DeliveryUrl:syntheticSub}]}};
    await player.setCurrentSrc(null,options);
    assert.equal(calls.length,1); assert.equal(calls[0][0],syntheticMedia); assert.equal(calls[0][4],'#,'+syntheticSub);
    assert.equal(player._currentSrc,syntheticMedia);
    player.setSubtitleStreamIndex(2); assert.equal(calls[1][1], '#,'+syntheticSub);
    assert(!out.messages.join('\n').includes(syntheticMedia)); assert(!out.messages.join('\n').includes(syntheticSub));
    assert(out.messages.some(m => m.includes('Playback requested'))); assert(out.messages.some(m => m.includes('External subtitle selected')));
});

test('QML lifecycle, external navigation and certificate logs exclude synthetic addresses', () => {
    const src=fs.readFileSync(path.join(root,'src/ui/webview.qml'),'utf8'), out=capture(), effects=[];
    const context=vm.createContext({console:out.console,WebEngineView:{LoadStartedStatus:1,LoadSucceededStatus:2,LoadFailedStatus:3},Qt:{callLater:fn => effects.push('later')},reapplyTransparentBackground(){},errorLabel:{visible:false,text:''},components:{player:{clearNativeAudioSession(){}},system:{openExternalUrl:url=>effects.push(['open',url]),logFilePath:'/synthetic-log'},settings:{ignoreSSLErrors:()=>false}},web:{currentHoveredUrl:syntheticMedia},request:{userInitiated:true},loadingInfo:{url:syntheticMedia,errorCode:42,errorString:'synthetic-error'},error:{url:syntheticMedia,description:syntheticSub,error:5,acceptCertificate:()=>effects.push('accepted')}});
    for(const status of [1,2,3]) {context.loadingInfo.status=status;vm.runInContext(body(src,'onLoadingChanged: function(loadingInfo)'),context);}
    vm.runInContext(body(src,'onNewWindowRequested:'),context);
    vm.runInContext(body(src,'onCertificateError: function(error)'),context);
    assert(effects.includes('later'));assert(effects.some(e=>Array.isArray(e)&&e[0]==='open'&&e[1]===syntheticMedia));
    assert.equal(context.errorLabel.visible,true);assert(!effects.includes('accepted'));
    context.components.settings.ignoreSSLErrors=()=>true;vm.runInContext(body(src,'onCertificateError: function(error)'),context);assert(effects.includes('accepted'));
    const log=out.messages.join('\n');assert(!log.includes(syntheticMedia));assert(!log.includes(syntheticSub));assert(log.includes('42'));assert(log.includes('5'));
});

test('audio playback forwards its source while omitting it from logs', async () => {
    const out=capture(), calls=[], signal={connect(){}};
    const native={playing:signal,positionUpdate:signal,finished:signal,updateDuration:signal,error:signal,paused:signal,bufferedRangesUpdated:signal,load:(...args)=>{calls.push(args);args.at(-1)(true);}};
    const ctx=vm.createContext({window:{api:{player:native}},jmpInfo:{userAgent:'test'},console:out.console,setTimeout,clearTimeout});
    vm.runInContext(fs.readFileSync(path.join(root,'native/mpvAudioPlayer.js'),'utf8'),ctx);
    const player=new ctx.window._mpvAudioPlayer({events:{},appHost:{},appSettings:{get:()=>1},toast:{}});
    await player.play({url:syntheticMedia,item:{}});
    assert.equal(calls[0][0],syntheticMedia);assert.equal(player.currentSrc(),syntheticMedia);
    assert(!out.messages.join('\n').includes(syntheticMedia));
});

test('connection resolution preserves navigation but logs neither address nor exception', async () => {
    const code=fs.readFileSync(path.join(root,'native/find-webclient.js'),'utf8').split('let isConnecting = false;')[0];
    const out=capture(),win={jmpInfo:{settings:{main:{}}},jmpCheckServerConnectivity:async () => syntheticSub};
    const ctx=vm.createContext({window:win,console:out.console});vm.runInContext(code,ctx);
    assert.equal(await ctx.tryConnect(syntheticMedia),true);
    assert.equal(win.location,syntheticSub);assert.equal(win.jmpInfo.settings.main.userWebClient,syntheticMedia);
    win.jmpCheckServerConnectivity=async()=>{throw new Error(syntheticMedia);};
    assert.equal(await ctx.tryConnect(syntheticMedia),false);
    assert(!out.messages.join('\n').includes(syntheticMedia));assert(!out.messages.join('\n').includes(syntheticSub));
});

test('metadata and CSP redirect events preserve signal and navigation without logging payload', () => {
    const player=fs.readFileSync(path.join(root,'native/mpvVideoPlayer.js'),'utf8');
    const qml=fs.readFileSync(path.join(root,'src/ui/webview.qml'),'utf8');
    const out=capture(), calls=[];
    const context=vm.createContext({console:out.console,player:{onMetaData:{connect:fn=>calls.push(fn)}},html:'',finalUrl:syntheticMedia,hadCSP:true,web:{url:''}});
    const line=player.split('\n').find(x=>x.includes('player.onMetaData.connect'));
    assert(line);vm.runInContext(line,context);calls[0]({Name:syntheticMedia});
    vm.runInContext(body(qml,'function(html, finalUrl, hadCSP)'),context);assert.equal(context.web.url,syntheticMedia);
    assert(!out.messages.join('\n').includes(syntheticMedia));
});

test('native targeted log statements omit server, media, profile and error text while preserving flow', () => {
    const files=['src/settings/SettingsComponent.cpp','src/system/SystemComponent.cpp','src/mpris/MprisComponent.cpp'];
    const [settings,system,mpris]=files.map(p=>fs.readFileSync(path.join(root,p),'utf8'));
    assert(!settings.includes('"Using web-client URL: " << url'));assert(settings.includes('return url;'));
    assert(!system.includes('"fetchPageForCSPWorkaround:" << url'));assert(!system.includes('"CSP workaround: applying for" << url'));assert(!system.includes('"No CSP detected for" << url'));
    assert(!system.includes('<< reply->errorString()'));assert(system.includes('emit pageContentReady(html, finalUrl, hadCSP)'));
    assert(!mpris.includes('<< metadata.value("Name").toString()'));assert(!mpris.includes('"Attempting to register MPRIS service:" << m_serviceName'));assert(mpris.includes('registerService(m_serviceName)'));
});

test('central JS console forwarding excludes source, address, path and title while retaining level and line', () => {
    const qml=fs.readFileSync(path.join(root,'src/ui/webview.qml'),'utf8'), calls=[];
    const secretPath='/synthetic/private/path', secretTitle='synthetic confidential title';
    const ctx=vm.createContext({level:2,message:syntheticMedia+' '+secretPath+' '+secretTitle,lineNumber:42,sourceID:syntheticSub,components:{system:{jsLog:(...args)=>calls.push(args)}}});
    vm.runInContext(body(qml,'onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID)'),ctx);
    assert.equal(calls[0][0],2); assert.equal(calls[0][1],'WebEngine JavaScript console event, line 42');
    for (const forbidden of [syntheticMedia,syntheticSub,secretPath,secretTitle]) assert(!calls[0][1].includes(forbidden));
});

test('mpv log events preserve severity but never emit arbitrary prefix or text', () => {
    const os=require('node:os'), {spawnSync}=require('node:child_process');
    const src=fs.readFileSync(path.join(root,'src/player/PlayerComponent.cpp'),'utf8');
    const start=src.indexOf('case MPV_EVENT_LOG_MESSAGE:'); const end=src.indexOf('case MPV_EVENT_CLIENT_MESSAGE:',start);
    assert(start>=0 && end>start);const eventCase=src.slice(start,end);
    assert(!eventCase.includes('msg->text'));assert(!eventCase.includes('msg->prefix'));
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mpv-redaction-test-'));
    const cpp=`#include <iostream>\n#include <sstream>\n#include <string>\n#include <cstring>\n#include <cassert>\nstd::ostringstream logOutput; struct Log {const char* level; Log(const char* l):level(l){logOutput << l << ":";} template<class T> Log& operator<<(const T& x){logOutput<<x;return *this;} ~Log(){logOutput<<"\\n";}}; Log qDebug(){return Log("debug");} Log qInfo(){return Log("info");} Log qWarning(){return Log("warning");} Log qCritical(){return Log("critical");}\nstruct mpv_event_log_message{const char* prefix;const char* text;int log_level;}; struct Event {void* data;}; enum{MPV_EVENT_LOG_MESSAGE=1, MPV_LOG_LEVEL_V=50, MPV_LOG_LEVEL_INFO=40, MPV_LOG_LEVEL_WARN=30};\nvoid dispatch(Event* event){switch(1){${eventCase} default:break;}}\nint main(){for(int level:{50,40,30,20}) {mpv_event_log_message msg{"synthetic-private-path","synthetic-private-title https://example.invalid/secret",level};Event e{&msg};dispatch(&e);}std::cout<<logOutput.str();}`;
    try {
        fs.writeFileSync(path.join(temp,'test.cpp'),cpp);
        const compile=spawnSync('c++',['-std=c++17',path.join(temp,'test.cpp'),'-o',path.join(temp,'test')],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
        const run=spawnSync(path.join(temp,'test'),[],{encoding:'utf8'});assert.equal(run.status,0);
        assert.equal(run.stdout,'debug:mpv log event\ninfo:mpv log event\nwarning:mpv log event\ncritical:mpv log event\n');
        assert(!run.stdout.includes('synthetic-private'));assert(!run.stdout.includes('example.invalid'));
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
