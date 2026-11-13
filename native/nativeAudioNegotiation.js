/* Correlate a single SDK PlaybackInfo request without persisting media URLs or credentials. */
(function (root, factory) {
    const adapter = factory();
    if (typeof module === 'object' && module.exports) module.exports = adapter;
    if (root) root.DeepStreamNativeAudioNegotiation = adapter;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const controllers = new WeakMap();
    const correlation = Symbol('deepstreamPlaybackInfo');
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    function snapshot(win) {
        try {
            const api = win.ApiClient, sdk = api?._sdk;
            const user = api?.getCurrentUserId(), server = api?.serverId();
            const address = typeof api?.serverAddress === 'function' ? api.serverAddress() : api?.serverAddress;
            const url = new URL(address), sdkUrl = new URL(sdk?.basePath);
            const base = url.origin + url.pathname.replace(/\/+$/, '');
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
                sdkUrl.origin + sdkUrl.pathname.replace(/\/+$/, '') !== base || sdkUrl.username || sdkUrl.password || sdkUrl.search || sdkUrl.hash ||
                !validId(user) || !validId(server) || typeof sdk.authorizationHeader !== 'string' ||
                !/^MediaBrowser\s+\S/.test(sdk.authorizationHeader) || /[\r\n\0]/.test(sdk.authorizationHeader)) return null;
            return {api, sdk, user, server, serverId:server, base, serverBaseUrl:base, authorization:sdk.authorizationHeader};
        } catch (_) { return null; }
    }
    function same(a,b) { return !!a && !!b && a.api===b.api && a.sdk===b.sdk && a.user===b.user && a.server===b.server && a.base===b.base && a.authorization===b.authorization; }
    function target(config,current) {
        try {
            if (String(config?.method).toLowerCase() !== 'post' || typeof config.url !== 'string' ||
                (config.params && Object.keys(config.params).length)) return null;
            const raw=config.url, url=/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? new URL(raw)
                : new URL(String(config.baseURL || current.base).replace(/\/+$/, '') + '/' + raw.replace(/^\/+/, ''));
            if (url.username || url.password || url.search || url.hash) return null;
            const base=new URL(current.base), prefix=base.pathname.replace(/\/+$/, '')+'/Items/';
            if(url.origin!==base.origin || !url.pathname.toLowerCase().startsWith(prefix.toLowerCase()))return null;
            const suffix=url.pathname.slice(prefix.length).split('/');
            return suffix.length===2 && validId(suffix[0]) && suffix[1].toLowerCase()==='playbackinfo' ? suffix[0] : null;
        } catch (_) {return null;}
    }
    function headersMatch(config, current) {
        try {
            if(config.auth != null || !config.headers)return false;
            const h=typeof config.headers.toJSON==='function' ? config.headers.toJSON() : config.headers;
            if(!record(h))return false;
            const auth=Object.entries(h).filter(([k])=>['authorization','x-emby-authorization','x-emby-token','x-mediabrowser-token'].includes(k.toLowerCase()));
            return auth.length===1 && typeof auth[0][1]==='string' && auth[0][1]===current.authorization;
        } catch (_) {return false;}
    }
    function nonce(win) {
        try {
            if(typeof win.crypto?.getRandomValues!=='function')return null;
            const bytes=new Uint8Array(16);win.crypto.getRandomValues(bytes);
            return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
        } catch (_) {return null;}
    }
    function checkDelivery(win,response,context,current) {
        try {
            const data=response?.data;
            if(!record(data)||data.ErrorCode||!Array.isArray(data.MediaSources)||!validId(data.PlaySessionId))return null;
            const contract=context.contract || (context.videoRoute ? 'deepstream-video-hls-v1' : 'deepstream-audio-hls-v1');
            const chosen=context.sourceId, matches=data.MediaSources.filter(s=>s?.Id===chosen);
            if(matches.length!==1)return null;
            const source=matches[0], original=context.item.MediaSources.find(s=>s?.Id===chosen);
            if(!original || source.DefaultAudioStreamIndex!==context.audioIndex || source.DefaultSubtitleStreamIndex!==-1 ||
                (source.DefaultSecondarySubtitleStreamIndex!=null && source.DefaultSecondarySubtitleStreamIndex!==-1) ||
                !Array.isArray(source.MediaStreams) || typeof source.TranscodingUrl!=='string')return null;
            const srcAudio=original.MediaStreams.filter(s=>s.Type==='Audio' && s.Index===context.audioIndex);
            const srcVideo=original.MediaStreams.filter(s=>s.Type==='Video');
            if(srcAudio.length!==1 || srcVideo.length!==1)return null;
            if(contract==='deepstream-video-hls-v2') {
                const actualAudio=source.MediaStreams.filter(s=>s.Type==='Audio' && s.Index===context.audioIndex);
                const actualVideo=source.MediaStreams.filter(s=>s.Type==='Video');
                if(actualAudio.length!==1 || actualVideo.length!==1)return null;
                for(const key of ['Protocol','IsRemote','RequiresOpening','RequiresClosing','IsInfiniteStream','LiveStreamId'])
                    if(source[key]!==original[key])return null;
                for(const [a,b,fields] of [
                    [srcAudio[0],actualAudio[0],['Index','Type','Codec','Channels','Profile','SampleRate','BitRate','IsExternal']],
                    [srcVideo[0],actualVideo[0],['Index','Type','Codec','BitDepth','IsExternal','IsInterlaced','VideoRangeType','DvProfile','DvLevel','RpuPresentFlag','BlPresentFlag','ElPresentFlag']]
                ]) if(fields.some(key=>a[key]!==b[key]))return null;
            }
            for(const reasons of [data.TranscodeReasons,data.TranscodingReasons,source.TranscodeReasons,source.TranscodingReasons]) {
                if(reasons!=null && (!Array.isArray(reasons) || reasons.some(r=>r!=='ContainerNotSupported')))return null;
            }
            if(context.allowAudioCopy!==true || context.allowVideoCopy!==true)return null;
            const originalUrl=new URL(source.TranscodingUrl, current.base+'/');
            if(originalUrl.hash)return null;
            const params=new Map();for(const [k,v] of originalUrl.searchParams){const key=k.toLowerCase();if(params.has(key))return null;params.set(key,v);}
            // Jellyfin also serializes reasons into the delivery URL. A missing
            // reason is not proof of stream copy; explicit incompatible reasons reject.
            if (params.has('transcodereasons')) {
                const reasons=params.get('transcodereasons').split(',').map(x=>x.trim().toLowerCase());
                if (!reasons.length || reasons.some(x=>x!== 'containernotsupported' && x!== '0') ||
                    (reasons.includes('0') && reasons.length!==1)) return null;
            }
            for(const key of ['allowaudiostreamcopy','allowvideostreamcopy'])
                if(params.has(key) && params.get(key).toLowerCase()!=='true')return null;
            if((params.get('videocodec')||'').toLowerCase()!==String(srcVideo[0].Codec).toLowerCase())return null;
            const segment=(params.get('segmentcontainer')||'').toLowerCase();
            const container=String(source.TranscodingContainer||'').toLowerCase();
            if((segment && segment!=='mp4') || (container && container!=='mp4') || (!segment && !container))return null;
            for(const info of [data.TranscodingInfo,source.TranscodingInfo]) {
                if(info!=null && (!record(info) || info.IsVideoDirect!==true || info.IsAudioDirect!==true ||
                    (info.VideoCodec && String(info.VideoCodec).toLowerCase()!==String(srcVideo[0].Codec).toLowerCase()) ||
                    (info.AudioCodec && String(info.AudioCodec).toLowerCase()!==context.audioCodec)))return null;
            }
            const limit=(key,value)=>{
                if(!params.has(key))return true;
                const text=params.get(key);if(!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value<=0)return false;
                const n=Number(text);return Number.isSafeInteger(n) && n>=value;
            };
            if(!limit('maxwidth',srcVideo[0].Width) || !limit('width',srcVideo[0].Width) ||
               !limit('maxheight',srcVideo[0].Height) || !limit('height',srcVideo[0].Height) ||
               !limit('videobitrate',srcVideo[0].BitRate) || !limit('maxvideobitdepth',srcVideo[0].BitDepth))return null;
            for(const key of ['videoprofile','videolevel','videorange','videorangetype','framerate','videoframerate'])
                if(params.has(key))return null;
            // Matching average/reference rates do not establish a maximum frame
            // rate or the server job's actual copy decision (VFR can exceed both).
            if (params.has('maxframerate')) return null;
            // StreamBuilder encodes the device range condition as hevc-rangetype.
            // Never invent or widen this server-generated option after negotiation.
            if (context.dvRange) {
                const advertised = params.get('hevc-rangetype');
                if (!advertised || advertised.toLowerCase() !== context.dvRange.replaceAll('|', ',').toLowerCase()) return null;
            } else if (params.has('hevc-rangetype')) return null;
            // The server can omit true default flags. Append only missing flags to
            // the same original URL; retain the original query bytes and token.
            const missing=[];
            if(!params.has('allowaudiostreamcopy'))missing.push('AllowAudioStreamCopy=true');
            if(!params.has('allowvideostreamcopy'))missing.push('AllowVideoStreamCopy=true');
            const deliveredUrl=source.TranscodingUrl+(missing.length?(source.TranscodingUrl.includes('?')?'&':'?')+missing.join('&'):'');
            const options={item:context.item,mediaSource:source,url:new URL(deliveredUrl,current.base+'/').toString(),playMethod:'Transcode',playSessionId:data.PlaySessionId};
            if(!win.DeepStreamNativeAudio?.hlsSelection(options,current,contract))return null;
            return {source,transcodingUrl:deliveredUrl,marker:{contract,itemId:context.item.Id,sourceId:chosen,audioIndex:context.audioIndex,playSessionId:data.PlaySessionId}};
        } catch (_) {return null;}
    }
    function create(win,readCapabilities) {
        if(typeof readCapabilities!=='function')return null;
        let binding=null,disposed=false,epoch=0;
        const tickets=new Map(),contexts=new Map(),latest=new Map(),inflight=new Map(),revoked=new Set();
        const verifiedFollowups=new WeakSet();
        function clear() {
            epoch++;for(const c of contexts.values())win.clearTimeout(c.timer);
            for(const name of inflight.keys())revoked.add(name);
            inflight.clear();contexts.clear();tickets.clear();latest.clear();
            if(binding){try{binding.axios.interceptors.request.eject(binding.requestId);}catch(_){}
                try{binding.axios.interceptors.response.eject(binding.responseId);}catch(_){} binding=null;}
        }
        function removeItem(id){for(const [name,c] of contexts)if(c.item.Id===id){win.clearTimeout(c.timer);contexts.delete(name);}
            for(const [key,t] of tickets)if(t.itemId===id)tickets.delete(key);}
        async function intercept(config) {
            const current=snapshot(win),itemId=current&&target(config,current);
            if(!itemId || disposed || !headersMatch(config,current))return config;
            let request;try{request=typeof config.data==='string'?JSON.parse(config.data):config.data;}catch(_){return config;}
            if(!record(request)||request.UserId!==current.user||!record(request.DeviceProfile))return config;
            const context=contexts.get(request.DeviceProfile.Name);
            if(!context || context.item.Id!==itemId || !same(context.snapshot,current))return config;
            try{if(JSON.stringify(request.DeviceProfile)!==context.profileJson)return config;}catch(_){return config;}
            contexts.delete(request.DeviceProfile.Name);win.clearTimeout(context.timer);
            if(inflight.size+revoked.size>=8){if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;}
            const captured=epoch;let capabilities;try{capabilities=await readCapabilities('getAudioCapabilities');}catch(_){if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;}
            if(disposed||captured!==epoch||latest.get(itemId)!==context.ticket||!same(current,snapshot(win))){if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;}
            let decision;try{decision=win.DeepStreamNativeAudioProfile?.plan({profile:request.DeviceProfile,request,item:context.item,capabilities,settings:win.jmpInfo?.settings,options:context.options});}catch(_){if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;}
            if(!decision?.applied){
                // A missing selection can only be resolved from the server's first,
                // unchanged PlaybackInfo response. Never guess from title metadata.
                if (decision?.reason === 'selection_unknown' &&
                    (request.AudioStreamIndex == null || request.SubtitleStreamIndex == null) &&
                    (request.AudioStreamIndex == null || (Number.isSafeInteger(request.AudioStreamIndex) && request.AudioStreamIndex >= 0)) &&
                    (request.SubtitleStreamIndex == null || request.SubtitleStreamIndex === -1) &&
                    (request.SecondarySubtitleStreamIndex == null || request.SecondarySubtitleStreamIndex === -1) &&
                    request.IsPlayback === true && !config.signal?.aborted) {
                    let probeRequest,requestJson;
                    try { requestJson=JSON.stringify(request);probeRequest=JSON.parse(requestJson); } catch (_) {
                        if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;
                    }
                    const c={probe:true,epoch:captured,snapshot:current,item:context.item,ticket:context.ticket,
                        name:request.DeviceProfile.Name,profileJson:context.profileJson,request:probeRequest,requestJson,
                        options:context.options,axios:binding.axios};
                    inflight.set(c.name,c);
                    return config;
                }
                if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;
            }
            const sourceId=request.MediaSourceId ?? (context.item.MediaSources.length===1 ? context.item.MediaSources[0].Id : null);
            if(!validId(sourceId)){if(latest.get(itemId)===context.ticket)latest.delete(itemId);return config;}
            let originalData;
            try { originalData=typeof config.data==='string'?config.data:structuredClone(request); } catch (_) { return config; }
            const output={...config,data:typeof config.data==='string'?JSON.stringify(decision.request):decision.request};
            const c={epoch:captured,snapshot:current,item:context.item,sourceId,audioIndex:request.AudioStreamIndex,ticket:context.ticket,name:request.DeviceProfile.Name,profileJson:JSON.stringify(decision.request.DeviceProfile),allowAudioCopy:decision.request.AllowAudioStreamCopy,allowVideoCopy:decision.request.AllowVideoStreamCopy,dvRange:decision.dvRange,audioCodec:decision.audioCodec,videoRoute:decision.videoRoute,contract:decision.contract,originalData,axios:binding.axios};
            inflight.set(c.name,c);
            Object.defineProperty(output,correlation,{value:c});
            return output;
        }
        async function completeProbe(response,c) {
            // No backend is started by PlaybackInfo for an ordinary file source.
            // An ambiguous/multiple/live response stays exactly as the server gave it.
            const stillCurrent=()=>!disposed && c.epoch===epoch && latest.get(c.item.Id)===c.ticket &&
                same(c.snapshot,snapshot(win)) && !response.config?.signal?.aborted;
            const finishOriginal=()=>{if(!stillCurrent()) throw new Error('Native audio playback session changed'); return response;};
            if(!stillCurrent()) throw new Error('Native audio playback session changed');
            const data=response?.data, sources=data?.MediaSources;
            if(data?.ErrorCode || !validId(data?.PlaySessionId) || !Array.isArray(sources) || sources.length!==1 ||
                !Array.isArray(c.item.MediaSources) || c.item.MediaSources.length!==1) {latest.delete(c.item.Id);return response;}
            const actual=sources[0], origin=c.item.MediaSources[0];
            if(!record(actual)||!record(origin)||!validId(actual.Id)||actual.Id!==origin.Id||
                (c.request.MediaSourceId != null && c.request.MediaSourceId!==actual.Id) ||
                origin.Protocol!=='File' || origin.IsRemote!==false || origin.RequiresOpening!==false ||
                origin.RequiresClosing!==false || origin.IsInfiniteStream!==false || origin.LiveStreamId ||
                actual.RequiresOpening===true || actual.RequiresClosing===true || actual.IsRemote===true ||
                (actual.Protocol != null && actual.Protocol!=='File') || actual.IsInfiniteStream===true || actual.LiveStreamId ||
                !Number.isSafeInteger(actual.DefaultAudioStreamIndex) || actual.DefaultAudioStreamIndex<0 ||
                actual.DefaultSubtitleStreamIndex!==-1 ||
                (actual.DefaultSecondarySubtitleStreamIndex!=null && actual.DefaultSecondarySubtitleStreamIndex!==-1) ||
                (c.request.AudioStreamIndex!=null && c.request.AudioStreamIndex!==actual.DefaultAudioStreamIndex) ||
                (c.request.SubtitleStreamIndex!=null && c.request.SubtitleStreamIndex!==-1) ||
                !Array.isArray(origin.MediaStreams)||!Array.isArray(actual.MediaStreams)) {latest.delete(c.item.Id);return response;}
            const ai=actual.DefaultAudioStreamIndex;
            const oldA=origin.MediaStreams.filter(x=>x.Type==='Audio'&&x.Index===ai);
            const newA=actual.MediaStreams.filter(x=>x.Type==='Audio'&&x.Index===ai);
            const oldV=origin.MediaStreams.filter(x=>x.Type==='Video');
            const newV=actual.MediaStreams.filter(x=>x.Type==='Video');
            const equalFields=(a,b,fields)=>fields.every(k=>a[k]===b[k]);
            if(oldA.length!==1||newA.length!==1||oldV.length!==1||newV.length!==1||
                !equalFields(oldA[0],newA[0],['Index','Type','Codec','Channels','IsExternal','Profile','SampleRate','BitRate'])||
                !equalFields(oldV[0],newV[0],['Index','Type','Codec','BitDepth','VideoRangeType','DvProfile','DvLevel','RpuPresentFlag','BlPresentFlag','ElPresentFlag'])) {latest.delete(c.item.Id);return response;}
            let next;
            try {next=structuredClone(c.request);}catch(_){latest.delete(c.item.Id);return response;}
            next.MediaSourceId=actual.Id;next.AudioStreamIndex=ai;next.SubtitleStreamIndex=-1;
            let decision;
            try {decision=win.DeepStreamNativeAudioProfile?.plan({profile:next.DeviceProfile,request:next,item:c.item,
                capabilities:await readCapabilities('getAudioCapabilities'),settings:win.jmpInfo?.settings,options:c.options});}
            catch(_){return finishOriginal();}
            if(!stillCurrent())throw new Error('Native audio playback session changed');
            if(!decision?.applied){latest.delete(c.item.Id);return response;}
            if(typeof AbortController!=='function' || typeof c.axios?.request!=='function'){latest.delete(c.item.Id);return response;}
            const abort=new AbortController(), external=response.config?.signal;
            const stop=()=>abort.abort();external?.addEventListener?.('abort',stop,{once:true});
            let timer, headers;
            try {
                const src=typeof response.config.headers?.toJSON==='function'?response.config.headers.toJSON():response.config.headers;
                if(!record(src))return finishOriginal();
                headers={...src};for(const name of Object.keys(headers))if(name.toLowerCase()==='content-length')delete headers[name];
                const request={...response.config,headers,signal:abort.signal,
                    data:typeof response.config.data==='string'?JSON.stringify(decision.request):decision.request};
                const nextContext={...c,probe:false,probeOriginalResponse:response,probeSession:data.PlaySessionId,
                    sourceId:actual.Id,audioIndex:ai,profileJson:JSON.stringify(decision.request.DeviceProfile),
                    allowAudioCopy:decision.request.AllowAudioStreamCopy,allowVideoCopy:decision.request.AllowVideoStreamCopy,
                    dvRange:decision.dvRange,audioCodec:decision.audioCodec,videoRoute:decision.videoRoute,contract:decision.contract};
                inflight.set(c.name,nextContext);
                const timeout=new Promise((_,reject)=>{timer=win.setTimeout(()=>{abort.abort();reject(new Error('Native audio test timeout'));},5000);});
                const result=await Promise.race([Promise.resolve().then(()=>{
                    if(!stillCurrent() || abort.signal.aborted)throw new Error('Native audio playback session changed');
                    return c.axios.request(request);
                }),timeout]);
                if(!stillCurrent())throw new Error('Native audio playback session changed');
                if(result!==response && (!record(result) || !verifiedFollowups.has(result))) return response;
                return result;
            } catch(_) {return finishOriginal();}
            finally {if(timer)win.clearTimeout(timer);external?.removeEventListener?.('abort',stop);inflight.delete(c.name);
                if(latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id);}
        }
        function responseInterceptor(response) {
            let c=response?.config?.[correlation], name, body;
            if(!c){
                try{body=typeof response?.config?.data==='string'?JSON.parse(response.config.data):response?.config?.data;name=body?.DeviceProfile?.Name;}catch(_){}
                const forced=body?.EnableDirectPlay===false && body?.EnableDirectStream===false &&
                    body?.AllowAudioStreamCopy===true && body?.AllowVideoStreamCopy===true;
                if(typeof name==='string' && revoked.has(name) && forced){revoked.delete(name);throw new Error('Native audio playback session changed');}
                if(typeof name==='string')c=inflight.get(name);
                if(c){
                    let sameProfile=false;try{sameProfile=JSON.stringify(body.DeviceProfile)===c.profileJson;}catch(_){}
                    if((!c.probe && !forced) || !sameProfile)return response;
                    if(!headersMatch(response.config,c.snapshot) || target(response.config,c.snapshot)!==c.item.Id)
                        throw new Error('Native audio playback could not be verified');
                } else {
                    const current=snapshot(win),id=current&&target(response?.config,current);
                    if(!record(body?.DeviceProfile) && id && [...inflight.values()].some(x=>x.item.Id===id && same(x.snapshot,current)))
                        throw new Error('Native audio playback could not be verified');
                    return response;
                }
            } else if(!headersMatch(response.config,c.snapshot) || target(response.config,c.snapshot)!==c.item.Id) {
                throw new Error('Native audio playback could not be verified');
            }
            inflight.delete(c.name);
            if(disposed||c.epoch!==epoch||latest.get(c.item.Id)!==c.ticket||!same(c.snapshot,snapshot(win)))throw new Error('Native audio playback session changed');
            if(c.probe) {
                let requestJson;
                try {const data=typeof response.config.data==='string'?JSON.parse(response.config.data):response.config.data;requestJson=JSON.stringify(data);}catch(_){requestJson=null;}
                if(requestJson!==c.requestJson){if(latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id);return response;}
                return completeProbe(response,c);
            }
            let delivery=checkDelivery(win,response,c,c.snapshot);
            if(c.probeOriginalResponse && response?.data?.PlaySessionId===c.probeSession) delivery=null;
            if(!delivery && c.probeOriginalResponse) return c.probeOriginalResponse;
            if(!delivery){
                // An unverified forced-HLS response must never be passed to mpv.
                // Retry once with the exact original JSON request and the same SDK.
                if(!binding || binding.axios!==c.axios || typeof c.axios?.request!=='function' || response.config?.signal?.aborted){
                    if(latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id);
                    throw new Error('Native audio playback could not be verified');
                }
                let retryHeaders;
                try {
                    const originalHeaders=typeof response.config.headers?.toJSON==='function'
                        ? response.config.headers.toJSON() : response.config.headers;
                    if(!record(originalHeaders)) throw new Error('headers');
                    retryHeaders={...originalHeaders};
                    for(const name of Object.keys(retryHeaders))
                        if(name.toLowerCase()==='content-length')delete retryHeaders[name];
                } catch (_) { if(latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id); throw new Error('Native audio playback could not be verified'); }
                const retryConfig={...response.config,headers:retryHeaders,data:c.originalData};
                delete retryConfig[correlation];
                return Promise.resolve().then(()=>{
                    if(disposed||c.epoch!==epoch||latest.get(c.item.Id)!==c.ticket||
                        !same(c.snapshot,snapshot(win))||retryConfig.signal?.aborted)
                        throw new Error('Native audio playback session changed');
                    return c.axios.request(retryConfig);
                }).then(retried=>{
                    if(disposed||c.epoch!==epoch||latest.get(c.item.Id)!==c.ticket||
                        !same(c.snapshot,snapshot(win))||retryConfig.signal?.aborted)
                        throw new Error('Native audio playback session changed');
                    const d=retried?.data, matches=Array.isArray(d?.MediaSources)?d.MediaSources.filter(s=>s?.Id===c.sourceId):[];
                    if(!validId(d?.PlaySessionId)||matches.length!==1||
                        matches[0].DefaultAudioStreamIndex!==c.audioIndex||
                        matches[0].DefaultSubtitleStreamIndex!==-1)
                        throw new Error('Original playback selection could not be verified');
                    return retried;
                }).finally(()=>{if(latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id);});
            }
            // Only the selected in-memory DTO receives this marker. No token or URL is added.
            const data={...response.data,MediaSources:response.data.MediaSources.map(s=>s===delivery.source?{...s,TranscodingUrl:delivery.transcodingUrl,DeepStreamNativeAudioRequest:delivery.marker}:s)};
            if(!c.probeOriginalResponse && latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id);
            const verified={...response,data};
            if(c.probeOriginalResponse)verifiedFollowups.add(verified);
            return verified;
        }
        function responseFailure(error) {
            let c=error?.config?.[correlation];if(!c){try{const body=typeof error?.config?.data==='string'?JSON.parse(error.config.data):error?.config?.data;const name=body?.DeviceProfile?.Name;revoked.delete(name);c=inflight.get(name);}catch(_){}}
            if(c){inflight.delete(c.name);if(!c.probeOriginalResponse && latest.get(c.item.Id)===c.ticket)latest.delete(c.item.Id);}
            return Promise.reject(error);
        }
        function bind(current) {
            const axios=current.sdk.axiosInstance,req=axios?.interceptors?.request,res=axios?.interceptors?.response;
            if(typeof req?.use!=='function'||typeof req?.eject!=='function'||typeof res?.use!=='function'||typeof res?.eject!=='function')return false;
            if(binding?.axios===axios)return true;
            if(binding)clear();let requestId;
            try{requestId=req.use(intercept);const responseId=res.use(responseInterceptor,responseFailure);binding={axios,requestId,responseId};return true;}
            catch(_){if(requestId!=null)try{req.eject(requestId);}catch(__){}return false;}
        }
        const pagehide=()=>clear();win.addEventListener?.('pagehide',pagehide);
        const controller={
            async registerItem(item,options,baseProfilePromise) {
                const current=snapshot(win), captured=epoch, id=item?.Id;
                if(validId(id))removeItem(id);
                const ticket={itemId:id};tickets.set(ticket,ticket);let retained=false;
                if(validId(id)){latest.delete(id);latest.set(id,ticket);while(latest.size>8)latest.delete(latest.keys().next().value);}
                while(tickets.size>8)tickets.delete(tickets.keys().next().value);
                try {
                    const profile=await baseProfilePromise;
                    if(disposed||!current||!validId(id)||item.ServerId!==current.server||options?.isRetry===true||
                        !record(profile)||!same(current,snapshot(win))||captured!==epoch||!tickets.has(ticket))return profile;
                    let capabilities;try{capabilities=await readCapabilities('getAudioCapabilities');}catch(_){return profile;}
                    if((capabilities?.nativeAudioHlsAvailable!==true && capabilities?.nativeDolbyVisionHlsAvailable!==true)||!same(current,snapshot(win))||captured!==epoch||!tickets.has(ticket))return profile;
                    let details=item;
                    if(!Array.isArray(item.MediaSources)||!item.MediaSources.length){
                        if(typeof current.api.getItem!=='function')return profile;
                        let timer;try{details=await Promise.race([Promise.resolve().then(()=>current.api.getItem(current.user,id)),new Promise(resolve=>{timer=win.setTimeout(()=>resolve(null),2500);})]);}
                        catch(_){return profile;}finally{win.clearTimeout(timer);}
                        if(!details||details.Id!==id||(details.ServerId && details.ServerId!==current.server))return profile;
                        details={...item,MediaSources:details.MediaSources};
                    }
                    if(disposed||!same(current,snapshot(win))||captured!==epoch||!tickets.has(ticket))return profile;
                    const route=win.jmpInfo?.settings?.audio;
                    if(!record(route)||(route.spatialAudio!==true && capabilities?.nativeDolbyVisionHlsAvailable!==true)||route.devicetype!=='basic'||route.device!=='auto'||route.channels!=='auto'||route.exclusive!==false)return profile;
                    const value=nonce(win);if(!value||typeof structuredClone!=='function')return profile;
                    let marked,profileJson;try{marked=structuredClone(profile);marked.Name='DeepStream Pro ['+value+']';profileJson=JSON.stringify(marked);}catch(_){return profile;}
                    if(!record(marked)||contexts.has(marked.Name)||!bind(current)||!same(current,snapshot(win))||captured!==epoch||!tickets.has(ticket))return profile;
                    const timer=win.setTimeout(()=>{contexts.delete(marked.Name);if(latest.get(id)===ticket)latest.delete(id);},30000);
                    contexts.set(marked.Name,{snapshot:current,item:details,profileJson,timer,ticket,options:options?{isRetry:options.isRetry}:undefined});
                    while(contexts.size>8){const key=contexts.keys().next().value;win.clearTimeout(contexts.get(key).timer);contexts.delete(key);}
                    retained=true;return marked;
                } finally {tickets.delete(ticket);if(!retained && latest.get(id)===ticket)latest.delete(id);}
            },clear,dispose(){disposed=true;clear();win.removeEventListener?.('pagehide',pagehide);controllers.get(win)?.delete(controller);}
        };
        if(!controllers.has(win))controllers.set(win,new Set());controllers.get(win).add(controller);return Object.freeze(controller);
    }
    return Object.freeze({create,sessionChanged(win){for(const controller of controllers.get(win)||[])controller.clear();}});
});
