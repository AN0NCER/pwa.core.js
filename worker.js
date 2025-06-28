const version = '0.0.1';
const hash = 'ooooo';

const cacheName = `pwa-tunime-${hash}-v${version}`;

const appShellFilesToCache = [];

const servers = [];

const log = console.log.bind(console, `[${version}]:[${hash}] ->`);
const worker = self;

const settings = {
    key: 'settings',
    cache: 'pwa-settings',
    val: null,

    get: async function () {
        if (this.val) return this.val;
        try {
            const cache = await caches.open(this.cache);
            const response = await cache.match(this.key);
            if (response) {
                this.val = await response.json()
                return this.val;
            }
            return null;
        } catch (error) {
            log('Settings get error:', error);
            return null;
        }

    },

    set: async function (setup) {
        try {
            const cache = await caches.open(this.cache);
            const response = new Response(JSON.stringify(setup));
            await cache.put(this.key, response);
            this.val = setup;
            return true;
        } catch (error) {
            log('Settings set error:', error);
            return false;
        }

    },

    update: async function (updates) {
        const current = await this.get() || {};
        const merged = { ...current, ...updates };
        return await this.set(merged);
    },

    getValue: async function (key, defaultValue = null) {
        const all = await this.get();
        const storedValue = all && all.hasOwnProperty(key) ? all[key] : null;

        if (storedValue === null) {
            return defaultValue;
        }

        if (typeof storedValue === 'object' && storedValue !== null && typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
            return { ...defaultValue, ...storedValue };
        }

        return storedValue;
    },

    clear: async function () {
        try {
            const cache = await caches.open(this.cache);
            await cache.delete(this.key);
            this.val = null;
            return true;
        } catch (error) {
            log('Settings clear error:', error);
            return false;
        }
    }
};

worker.addEventListener('install', (event) => {
    /**
     * Запрашивает разрешение на установку
     * @param {BroadcastChannel} channel 
     * @returns {Promise<boolean>}
     */
    const requestInstallPermission = (channel) => {
        return new Promise((resolve, reject) => {
            const end = (bool) => {
                channel.removeEventListener('message', listener);
                if (bool) {
                    return resolve(bool);
                } else {
                    return reject(new Error('Installation rejected by user'));
                }
            }

            const listener = (event) => {
                switch (event.data.type) {
                    case 'INSTALL_APPROVED':
                        end(true);
                        break;
                    case 'INSTALL_REJECTED':
                        end(false);
                        break;
                    case 'INSTALL_RECEIVED':
                        clearTimeout(timer);
                        break;
                }
            }

            channel.addEventListener('message', listener);

            const timer = setTimeout(() => {
                end(true);
            }, 1000);

            channel.postMessage({
                type: 'INSTALL_PERMISSION_REQUEST',
                payload: { version, hash, cacheName, total: appShellFilesToCache.length }
            });
        });
    }

    event.waitUntil(
        settings.getValue('install', {
            activate: true,
            batchSize: 2,
            channel: 'sw-update',
            install: true
        }).then(async (setup) => {
            const broadcast = new BroadcastChannel(setup.channel);

            if (!setup.install) {
                await requestInstallPermission(broadcast);
            }

            await settings.update({ 'source': 'worker' });

            broadcast.postMessage({
                type: 'NEW_VERSION',
                payload: { version, hash, cacheName, total: appShellFilesToCache.length }
            });

            await caching(appShellFilesToCache, setup);

            if (setup.activate) {
                worker.skipWaiting();
            }
        })
    );
});

worker.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await worker.clients.claim();

        const names = await caches.keys();

        await Promise.all(
            names.map(name => {
                if (name !== cacheName && name !== settings.cache) {
                    return caches.delete(name);
                }
            })
        );

        log('worker activated');
    })());
});

async function caching(filesToCache, setup) {
    const broadcast = new BroadcastChannel(setup.channel);
    try {
        const cache = await caches.open(cacheName);
        const total = filesToCache.length;
        let processed = 0;

        if (total === 0) {
            log('No files to cache.');
            return;
        }

        log(`Starting caching for ${total} files.`);

        // Функция для обработки одного батча (остается без изменений)
        const batch = async (files) => {
            const batchPromises = files.map(async (file) => {
                let success = true;
                try {
                    await cache.add(file);
                } catch (err) {
                    success = false;
                    console.error(`[SW]: Failed to cache ${file}`, err);
                }

                processed++;
                const percent = ((processed / total) * 100).toFixed(2);
                broadcast.postMessage({
                    type: 'CACHE_PROGRESS',
                    payload: { total, processed, percent, file, success }
                });

                return { file, success };
            });
            await Promise.allSettled(batchPromises);
        };

        // Разбиваем файлы на батчи (остается без изменений)
        for (let i = 0; i < total; i += setup.batchSize) {
            const batchFiles = filesToCache.slice(i, i + setup.batchSize);
            await batch(batchFiles);
        }

        log('Caching complete.');
        broadcast.postMessage({ type: 'CACHE_COMPLETE', payload: { version, cacheName } });
    } catch (error) {
        log(`Failed to start caching: ${error}`);
        broadcast.postMessage({ type: 'CACHE_ERROR', payload: { error: error.message } });

    }
}

(() => {
    worker.addEventListener('fetch', event => {
        event.respondWith((async () => {
            const url = new URL(event.request.url);
            try {
                if (servers.some(s => url.href.startsWith(s))) {
                    return fetch(new Request(event.request, {
                        ...event.request,
                        headers: new Headers({
                            ...Object.fromEntries(event.request.headers),
                            Authorization: (event.request.headers.get('Authorization') || '') + version
                        })
                    }));
                }

                if (url.pathname.startsWith('/javascript/pages/anime/')) {
                    const response = await fetch(event.request);
                    if (response.status !== 404) return response;

                    return fetch('/javascript/pages/anime/default.js');
                }

                if (worker.location.hostname !== url.hostname) {
                    return fetch(event.request);
                }

                const cached = await caches.match(event.request);
                if (cached) return cached;

                if (url.pathname === "/") {
                    return (await caches.match('/index.html')) || fetch(event.request);
                }

                return (await caches.match(url.pathname)) || fetch(event.request);
            } catch (e) {
                log(`fetch error ${e}`)
                return fetch(event.request);
            }
        })());
    });
})(log('fetch event support enabled'));

(() => {
    const methods = {
        'ACTIVATE': () => {
            worker.skipWaiting();
            return { complete: true };
        },
        'META': async () => {
            const source = await settings.getValue('source', 'worker');
            return { version, hash, source };
        },
        'SETUP': async (payload) => {
            await settings.update(payload);
            return { value: await settings.get() };
        },
        'SETUP_CLEAR': async () => {
            return { complete: await settings.clear() };
        },
        'GET_SETUP': async ({ key = 'install', defaultValue = { batchSize: 2, activate: true, channel: 'sw-update', install: true } }) => {
            return settings.getValue(key, defaultValue);
        },
        'RECACHE': async (payload) => {
            if (!payload?.channel) return { error: 'channel unset' };

            new BroadcastChannel(payload.channel).postMessage({
                type: 'NEW_VERSION',
                payload: { version, hash, cacheName }
            });

            await caches.delete(cacheName);

            const setup = await settings.getValue('install', { activate: true, batchSize: 2 });

            caching(appShellFilesToCache, { ...setup, ...payload });
            return { process: true };
        }
    }

    worker.addEventListener('message', async ({ source: client, data }) => {
        const { type, payload } = data;

        if (!methods[type])
            return client.postMessage(JSON.stringify({ type }));
        const value = await methods[type](payload);

        client.postMessage(JSON.stringify({ type, payload: value }));
    });
})(log('message system ready'));