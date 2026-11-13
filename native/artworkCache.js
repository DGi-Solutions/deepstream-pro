/* Decoded images for navigation, plus a bounded persistent image-only cache. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DeepStreamArtworkCache = factory();
})(typeof window === 'object' ? window : null, function () {
    'use strict';
    function imageKey(context, candidate, origin) {
        // Never persist image request tokens, headers, or full query strings.
        let path;
        try {path = new URL(candidate.url, origin).pathname;} catch (_) {path = candidate.type || 'image';}
        return [origin, context.userId, context.id, candidate.type, candidate.tag, candidate.index, path].join('|');
    }
    function memoryCache(limit = 24) {
        const entries = new Map();
        return {get(key) {
            const value = entries.get(key);
            if (value) {entries.delete(key); entries.set(key, value);}
            return value;
        }, set(key, value) {
            entries.set(key, value);
            while (entries.size > limit) entries.delete(entries.keys().next().value);
        }};
    }
    function persistent(win) {
        let database;
        const open = () => database || (database = new Promise(resolve => {
            if (!win.indexedDB) {resolve(null); return;}
            const request = win.indexedDB.open('DeepStreamArtwork', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('images', {keyPath: 'key'});
            request.onsuccess = () => resolve(request.result);
            request.onerror = request.onblocked = () => resolve(null);
        }));
        return {
            async get(key) {
                try {
                    const db = await open(); if (!db) return null;
                    return await new Promise(resolve => {
                        const request = db.transaction('images').objectStore('images').get(key);
                        request.onsuccess = () => resolve(request.result && Date.now() - request.result.time < 604800000 ? request.result.blob : null);
                        request.onerror = () => resolve(null);
                    });
                } catch (_) {return null;}
            },
            async set(key, image) {
                try {
                    const canvas = win.document.createElement('canvas');
                    const scale = Math.min(1, 1600 / image.naturalWidth);
                    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
                    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
                    if (!blob || blob.size > 2000000) return;
                    const db = await open(); if (!db) return;
                    const store = db.transaction('images', 'readwrite').objectStore('images');
                    store.put({key, time: Date.now(), blob});
                    const all = store.getAll();
                    all.onsuccess = () => {
                        const old = all.result.sort((a, b) => b.time - a.time).slice(64);
                        for (const entry of old) store.delete(entry.key);
                    };
                } catch (_) { /* CORS, quota or private mode: use the standard image cache. */ }
            }
        };
    }
    return Object.freeze({imageKey, memoryCache, persistent});
});
