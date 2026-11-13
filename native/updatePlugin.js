(function() {
    'use strict';

    const latestRelease = 'https://github.com/DGi-Solutions/deepstream-pro/releases/latest';

    function stableVersion(value) {
        if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
        const parts = value.split('.').map(Number);
        return parts.every(Number.isSafeInteger) ? parts : null;
    }

    function releaseLink(value) {
        if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
        try {
            const parsed = new URL(value);
            if (parsed.origin !== 'https://github.com' || parsed.username || parsed.password ||
                parsed.search || parsed.hash) return null;
            const tag = /^\/DGi-Solutions\/deepstream-pro\/releases\/tag\/(v?([0-9.]+))\/?$/i.exec(parsed.pathname);
            const version = tag && stableVersion(tag[2]);
            if (!version) return null;
            return {version, label: tag[2], url: `https://github.com/DGi-Solutions/deepstream-pro/releases/tag/${tag[1]}`};
        } catch (_) {
            return null;
        }
    }

    function isNewer(candidate, current) {
        for (let i = 0; i < current.length; i++) {
            if (candidate[i] !== current[i]) return candidate[i] > current[i];
        }
        return false;
    }

    function labels(version) {
        const locale = window.DeepStreamLocale;
        const lang = locale && typeof locale.language === 'function' ? locale.language(window)
            : /^de(?:[-_]|$)/i.test(window.document?.documentElement?.lang || window.navigator?.language || '') ? 'de' : 'en';
        return lang === 'de' ? {
            title: 'Update für DeepStream Pro',
            text: `DeepStream Pro ${version} ist verfügbar.`,
            cancelText: 'Später', confirmText: 'Release öffnen'
        } : {
            title: 'DeepStream Pro update',
            text: `DeepStream Pro ${version} is available.`,
            cancelText: 'Later', confirmText: 'Open release'
        };
    }

    class updatePlugin {
        constructor({confirm}) {
            this.name = 'DeepStream Pro Updates';
            this.type = 'input';
            this.id = 'updatePlugin';

            // Alpha, pre, dev and unknown versions stay on their chosen channel.
            const current = stableVersion(window.jmpInfo?.version);
            if (!current) return;

            (async () => {
                const api = await window.apiPromise;
                if (!api?.system || typeof api.system.openExternalUrl !== 'function' ||
                    typeof api.system.checkForUpdates !== 'function' ||
                    typeof api.system.updateInfoEmitted?.connect !== 'function') return;
                let pending = false;
                const notified = new Set();
                const onUpdateNotify = async value => {
                    if (pending) return;
                    pending = true;
                    try {
                        let target = value;
                        if (value === 'SSL_UNAVAILABLE') {
                            const response = await fetch(latestRelease, {
                                credentials: 'omit', referrerPolicy: 'no-referrer'
                            });
                            if (!response.ok) return;
                            target = response.url;
                        }
                        const release = releaseLink(target);
                        if (!release || !isNewer(release.version, current) || notified.has(release.label)) return;
                        notified.add(release.label);
                        // Let the initial client view finish before opening a dialog.
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        if (window.jmpInfo?.version !== current.join('.')) return;
                        await confirm(labels(release.label));
                        // Only the validated, canonical release page is opened.
                        api.system.openExternalUrl(release.url);
                    } catch (_) {
                        // Cancellation, offline checks and invalid responses stay quiet.
                    } finally {
                        pending = false;
                    }
                };
                api.system.updateInfoEmitted.connect(onUpdateNotify);
                api.system.checkForUpdates();
            })().catch(() => {});
        }
    }

    window._updatePlugin = updatePlugin;
})();
