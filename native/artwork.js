/* Artwork stays in the signed-in Jellyfin client. No metadata is changed. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./artworkCache.js'));
    else root.DeepStreamArtwork = factory(root.DeepStreamArtworkCache);
})(typeof window === 'object' ? window : null, function (cacheModule) {
    'use strict';
    const HERO_HEIGHT = 560;
    const secondaryHeight = (top, height) => Math.max(0, Number(top) + Number(height) - HERO_HEIGHT);
    function publicImage(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && url.hostname === 'image.tmdb.org' &&
                !url.username && !url.password && !url.port && !url.search && !url.hash ? url.href : null;
        } catch (_) {return null;}
    }
    function different(a, b) {
        if (!a || !b || a.length !== b.length) return null;
        let distance = 0;
        for (let i = 0; i < a.length; i++) distance += Math.abs(a[i] - b[i]);
        return distance / a.length > 12;
    }
    function remoteLoader() {
        const sessions = new WeakMap();
        return function load(api, userId, item) {
            let entries = sessions.get(api);
            if (!entries) {entries = new Map(); sessions.set(api, entries);}
            const id = item.ParentBackdropItemId || item.Id;
            if (!id || !api.getUrl || !api.ajax) return Promise.resolve([]);
            const key = userId + ':' + id;
            const previous = entries.get(key);
            if (previous && Date.now() - previous.time < 3600000) return previous.promise;
            const promise = Promise.resolve().then(() => api.ajax({type: 'GET', dataType: 'json',
                url: api.getUrl('Items/' + encodeURIComponent(id) + '/RemoteImages', {
                    type: 'Backdrop', limit: 6, providerName: 'TheMovieDb', includeAllLanguages: true
                })
            })).then(result => {
                if (api.getCurrentUserId?.() !== userId) return [];
                return [...new Set((result?.Images || []).map(image => publicImage(image.Url)).filter(Boolean))]
                    .map(url => ({type: 'Backdrop', url}));
            }).catch(() => []);
            entries.set(key, {time: Date.now(), promise});
            if (entries.size > 16) entries.delete(entries.keys().next().value);
            return promise;
        };
    }
    function create(win, {candidates}) {
        const doc = win.document, states = new WeakMap(), loadRemote = remoteLoader();
        const decoded = cacheModule.memoryCache(), disk = cacheModule.persistent(win);
        function clear(page) {
            const state = states.get(page);
            if (state) {state.cancelled = true; state.observer?.disconnect();}
            states.delete(page);
            page.querySelectorAll('.deepstream-film-art, .deepstream-secondary-art').forEach(node => node.remove());
        }
        function update(context, item) {
            const local = candidates(context.api, item);
            const key = [context.userId, context.id, ...local.map(image => image.url)].join('|');
            if (states.get(context.page)?.key === key) return;
            clear(context.page);
            const state = {key, cancelled: false};
            states.set(context.page, state);
            const active = () => !state.cancelled && context.isCurrent() &&
                context.api.getCurrentUserId?.() === context.userId;
            const add = (image, className) => {
                const art = doc.createElement('div');
                art.className = className; art.setAttribute('aria-hidden', 'true');
                art.style.backgroundImage = 'url(' + JSON.stringify(image.url) + ')';
                context.page.prepend(art);
                return art;
            };
            const fingerprint = image => {
                try {
                    const canvas = doc.createElement('canvas'); canvas.width = 16; canvas.height = 9;
                    const ctx = canvas.getContext('2d', {willReadFrequently: true});
                    ctx.drawImage(image, 0, 0, 16, 9);
                    return ctx.getImageData(0, 0, 16, 9).data;
                } catch (_) {return null;}
            };
            async function load(candidate) {
                const key = cacheModule.imageKey(context, candidate, win.location.origin);
                const cached = decoded.get(key);
                if (cached) return active() ? {...cached, candidate: {...candidate, url: cached.candidate.url}} : null;
                function read(url) {
                    return new Promise(resolve => {
                        if (!active()) {resolve(null); return;}
                        const image = new win.Image();
                        image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
                        image.onload = () => resolve(active() ? {candidate: {...candidate, url}, image, pixels: fingerprint(image)} : null);
                        image.onerror = () => resolve(null);
                        image.src = url;
                    });
                }
                const blob = await disk.get(key);
                let loaded;
                if (blob && active()) {
                    const url = win.URL.createObjectURL(blob);
                    loaded = await read(url);
                    if (!loaded) win.URL.revokeObjectURL(url);
                }
                if (!loaded && active()) {
                    loaded = await read(candidate.url);
                    if (loaded) disk.set(key, loaded.image);
                }
                if (loaded) decoded.set(key, loaded);
                return loaded;
            }
            (async () => {
                let hero;
                const extra = () => loadRemote(context.api, context.userId, item);
                for (const candidate of local) {hero = await load(candidate); if (hero || !active()) break;}
                if (!hero && active()) for (const candidate of await extra()) {hero = await load(candidate); if (hero || !active()) break;}
                if (!hero || !active()) return;
                add(hero.candidate, 'deepstream-film-art');
                win.console?.info('DeepStream artwork: hero loaded');
                let second;
                const seen = new Set([hero.candidate.url]);
                async function choose(choices) {
                    for (const candidate of choices) {
                        if (!active()) return;
                        if (candidate.type !== 'Backdrop' || seen.has(candidate.url) ||
                            (hero.candidate.tag && candidate.tag === hero.candidate.tag)) continue;
                        seen.add(candidate.url);
                        const loaded = await load(candidate);
                        if (loaded && different(hero.pixels, loaded.pixels) !== false) {second = loaded; return;}
                    }
                }
                await choose(local);
                if (!second && active()) await choose(await extra());
                if (!second || !active()) return;
                const art = add(second.candidate, 'deepstream-secondary-art');
                win.console?.info('DeepStream artwork: distinct secondary loaded');
                const wrapper = context.page.querySelector('.detailPageWrapperContainer');
                const resize = () => {
                    if (!active() || !wrapper) return;
                    art.style.height = secondaryHeight(wrapper.offsetTop, wrapper.offsetHeight) + 'px';
                };
                resize();
                if (win.ResizeObserver && wrapper) {
                    state.observer = new win.ResizeObserver(resize); state.observer.observe(wrapper);
                }
            })().catch(() => { /* Artwork must not interrupt navigation or playback. */ });
        }
        return Object.freeze({update, clear});
    }
    return Object.freeze({create, remoteLoader, publicImage, different, secondaryHeight});
});
