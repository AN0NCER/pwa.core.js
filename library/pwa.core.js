const sw = navigator.serviceWorker;

const log = console.log.bind(console, '[pwa] ->');
const err = console.error.bind(console, `[pwa] ->`);
const warn = console.warn.bind(console, `[pwa] ->`);

const storage = class {
    #value = undefined;

    constructor(type) {
        /**@type {Storage} */
        this.storage = type;
    }

    getItem(key) {
        if (this.#value) return this.#value;
        this.#value = JSON.parse(this.storage.getItem(key));
        return this.#value;
    }

    setItem(key, value) {
        this.#value = value;
        this.storage.setItem(key, JSON.stringify(this.#value));
    }

    destroy() {
        this.#value = undefined;
    }
}

class Session {
    static key = 'pwa-session';

    #load() {
        // Получаем sessionID из localStorage
        this.sessionID = this.storage.getItem(Session.key);
        if (!this.sessionID) {
            this.#createNewSession();
        }
    }

    #createNewSession() {
        this.sessionID = this.#generateSessionID();
        this.storage.setItem(Session.key, this.sessionID);

        // Синхронизируем с service worker (без ожидания результата)
        this.#syncWithServiceWorker();

        log(`New session created: ${this.sessionID}`);
    }

    #syncWithServiceWorker() {
        // Отправляем sessionID в service worker, но не ждем результат
        this.pwa.message.NEW_SESSION(this.sessionID).catch((error) => {
            warn(`Failed to sync session with service worker: ${error}`);
        })
    }

    #generateSessionID() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    constructor(pwa) {
        /**@type {$PWA} */
        this.pwa = pwa;
        this.storage = new storage(sessionStorage);
        this.#load();

        // Подписываемся на события обновления для создания новой сессии
        this.pwa.events.on('update', () => {
            this.newSession();
        });
    }

    /**
     * Создает новую сессию
     */
    newSession() {
        this.#createNewSession();
        return this.sessionID;
    }
}

class Core {
    static key = 'pwa-core';
    /**@type {Core} */
    static instance;

    #load() {
        /**@type {{version:string, hash:string, date:string} | {}} */
        this.new = {};
        /**@type {{version:string, hash:string, date:string} | {}} */
        this.old = {};
        try {
            const saved = this.storage.getItem(Core.key);

            for (const key in saved) {
                if (Object.prototype.hasOwnProperty.call(saved, key)) {
                    this[key] = saved[key];
                }
            }
        } catch (e) {
            warn(`Ошибка чтения Storage ${e}`);
        }
    }

    #update() {
        this.update = new class {
            #update = false;
            #content = null;

            constructor(core) {
                /**@type {Core} */
                this.core = core;
            }

            get has() {
                return this.#update;
            }

            get type() {
                return this.#content;
            }

            on() {
                this.#update = (() => {
                    if (!this.core.new || !this.core.old) return false;
                    return this.core.new.version !== this.core.old.version || this.core.new.hash !== this.core.old.hash;
                })();
                this.#content = (() => {
                    if (!this.#update) return null;
                    if (this.core.new.version !== this.core.old.version) return this.core.new.version;
                    if (this.core.new.hash !== this.core.old.hash) return this.core.old.hash;
                    return null;
                })();
            }

            reload() {
                this.core.old = {};
                const value = { new: this.core.new };
                this.core.storage.setItem(Core.key, value);
            }
        }(this);
    }

    constructor(pwa, { onreload = true } = {}) {
        if (Core.instance) return Core.instance;
        Core.instance = this;

        /**@type {$PWA} */
        this.pwa = pwa;
        /**@type {boolean} */
        this.reload = onreload;

        this.storage = new storage(sessionStorage);
        this.#update();
        this.#load();
    }

    set({ version, hash, source } = {}) {
        const save = () => {
            if (version === this.new?.version && hash === this.new?.hash) return;
            const date = new Date().toISOString();

            this.old = this.new;
            this.new = { version, hash, date };

            const value = { new: this.new, old: this.old };
            this.storage.setItem(Core.key, value);
            this.update.on();
        }

        this.pwa.meta.set({ version, hash, source: { file: source, path: window.location.pathname } });
        save();
    }
}

class Meta {
    static key = 'meta-pwa';

    #load() {
        /**
         * Версия приложения
         * @type {string}
         */
        this.version = undefined;
        /**
         * Хэш приложения
         * @type {string}
         */
        this.hash = undefined;
        /**
         * Дата обновления в ISO
         * @type {string}
         */
        this.date = undefined;
        this.source = undefined;

        try {
            const saved = this.storage.getItem(Meta.key);
            const { new: { version, hash, date, source } = {} } = saved || {};

            this.version = version || undefined;
            this.hash = hash || undefined;
            this.date = date || undefined;
            this.source = source || undefined;
        } catch (e) {
            warn(`Ошибка чтение ${e}`);
        }
    }

    #update() {
        this.update = new class {
            constructor(meta) {
                /**@type {Meta} */
                this.meta = meta;
            }

            get has() {
                try {
                    const saved = this.meta.storage.getItem(Meta.key);
                    if (!saved || !saved.new || !saved.old) return false;

                    const { new: newVer, old: oldVer } = saved;
                    return newVer.version !== oldVer.version;
                } catch (e) {
                    err(`Ошибка при проверке обновления ${e}`);
                    return false;
                }
            }

            remove() {
                try {
                    const saved = this.meta.storage.getItem(Meta.key);
                    if (!saved.old) return;
                    delete saved.old;
                    this.meta.storage.setItem(Meta.key, saved);
                } catch (e) {
                    err(`Ошибка при удаление старого обновления ${e}`);
                }
            }
        }(this);
    }

    constructor(pwa) {
        /**@type {$PWA} */
        this.pwa = pwa;

        this.storage = new storage(localStorage);
        this.#load();
        this.#update();
    }

    set({ version, hash, source } = {}) {
        if (version == this.version && hash == this.hash) return;
        const date = new Date().toISOString();

        const old = { version: this.version, hash: this.hash, source: this.source, date: this.date }

        this.version = version;
        this.hash = hash;
        this.source = source;
        this.date = date;

        const data = { new: { version, hash, source, date } };
        if (old.version && old.hash) data.old = old;

        this.storage.setItem(Meta.key, data);
    }
}

class Controll {
    constructor(pwa) {
        /**@type {$PWA} */
        this.pwa = pwa;
    }

    async register() {
        try {
            await sw.register(this.pwa.file, { scope: '/' });
            log('registered successfully');
        } catch (error) {
            err(`registration failed ${error}`);
        }
    }
}

class Message {
    static META(payload) {
        return new Message().on('META', { payload });
    }

    static SETUP(payload) {
        return new Message().on('SETUP', { payload });
    }

    static RECACHE(payload) {
        return new Message().on('RECACHE', { payload });
    }

    static SETUP_CLEAR() {
        return new Message().on('SETUP_CLEAR');
    }

    static INSTALL() {
        return new Message().on('INSTALL');
    }

    static GET_SETUP(payload) {
        return new Message().on('GET_SETUP', { payload });
    }

    static NEW_SESSION(payload) {
        return new Message().on('NEW_SESSION', { payload });
    }

    static instance;
    constructor() {
        if (Message.instance) return Message.instance;
        Message.instance = this;

        this.#pendingRequests = new Map();
        this.#requestId = 0;

        sw?.addEventListener('message', this.#handler.bind(this));
    }

    #pendingRequests;
    #requestId;

    #handler(event) {
        try {
            const { type, payload } = JSON.parse(event.data);

            //Ищем первый подходящий запрос по типу
            for (const [id, request] of this.#pendingRequests) {
                if (request.type === type) {
                    const { resolve } = request;
                    this.#pendingRequests.delete(id);
                    resolve(payload);
                    break;
                }
            }
        } catch (error) {
            // Отклоняем все pending requests с этой ошибкой
            for (const [id, request] of this.#pendingRequests) {
                request.reject(error);
                this.#pendingRequests.delete(id);
            }
        }
    }

    on(type, { timer = false, timeout = 10000, payload, controller = sw.controller } = {}) {
        return new Promise((resolve, reject) => {
            const requestId = ++this.#requestId;
            let timeoutId = null;

            //Устанавливаем таймер по необходимости
            if (timer) {
                timeoutId = setTimeout(() => {
                    if (this.#pendingRequests.has(requestId)) {
                        this.#pendingRequests.delete(requestId);
                        reject(new Error(`sw.timeout: ${type}`));
                    }
                }, timeout);
            }

            this.#pendingRequests.set(requestId, {
                type,
                resolve: (data) => {
                    clearTimeout(timeoutId);
                    resolve(data);
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });

            //Отправить сообщение
            controller?.postMessage({ type, payload });
        })
    }
}

class Events {
    #callbacks = {}
    #replayed = {};

    on(event, callback, { once = false, replay = false } = {}) {
        if (!this.#callbacks[event]) {
            this.#callbacks[event] = [];
        }

        this.#callbacks[event].push({ callback, once });

        if (replay && this.#replayed.hasOwnProperty(event)) {
            callback(...this.#replayed[event]);
            if (once) this.off(event, callback);
        }
    }

    off(event, callback) {
        if (!this.#callbacks[event]) return;

        if (!callback) {
            delete this.#callbacks[event];
        } else {
            this.#callbacks[event] = this.#callbacks[event].filter(
                listener => listener.callback !== callback
            );

            if (this.#callbacks[event].length === 0) {
                delete this.#callbacks[event];
            }
        }
    }

    trigger(event, ...argsAndOptions) {
        // Последний аргумент может быть { replay: true }
        let replayFlag = false;
        let args = argsAndOptions;

        const last = argsAndOptions[argsAndOptions.length - 1];
        if (typeof last === 'object' && last !== null && 'replay' in last) {
            replayFlag = last.replay;
            args = argsAndOptions.slice(0, -1);
        }

        if (replayFlag) {
            this.#replayed[event] = args;
        }

        const listeners = this.#callbacks[event];
        if (!listeners) return;

        for (const listener of [...listeners]) {
            listener.callback(...args);
        }

        this.#callbacks[event] = listeners.filter(l => !l.once);

        if (this.#callbacks[event].length === 0) {
            delete this.#callbacks[event];
        }
    }
}

class Update {
    static key = 'sw-update';

    #onupdate() {
        const update = ({ data: { type, payload } }) => {
            if (type !== 'NEW_VERSION') return;
            this.removeEventListener('message', update);

            const { version } = payload;
            const updateType = $PWA.meta.version === version ? "hash" : "version";
            const value = payload[updateType];

            this.storage.setItem(Update.key, { type: updateType, value, payload });
        }

        this.addEventListener('message', update);
    }

    constructor() {
        this.channel = new BroadcastChannel(Update.key);
        this.storage = new storage(sessionStorage);
        this.#onupdate();
    }

    /**
     * Appends an event listener for events whose type attribute value is type. The callback argument sets the callback that will be invoked when the event is dispatched.
     * @param {"message" | "messageerror"} type 
     * @param {Function} listener 
     */
    addEventListener(type, listener) {
        this.channel.addEventListener(type, listener);
    }

    /**
     * Removes the event listener in target's event listener list with the same type, callback, and options.
     * @param {"message" | "messageerror"} type 
     * @param {Function} listener 
     */
    removeEventListener(type, listener) {
        this.channel.removeEventListener(type, listener);
    }

    /**
     * Sends the given message to other BroadcastChannel objects set up for this channel. Messages can be structured objects, e.g. nested objects and arrays.
     */
    postMessage(message) {
        this.channel.postMessage(message);
    }
}

export const $PWA = new class {
    constructor() {
        this.file = '/worker.js';
        this.core = new Core(this);
        this.meta = new Meta(this);
        this.controll = new Controll(this);
        this.message = Message;
        this.events = new Events();
        this.update = new Update();
        this.session = new Session(this);
    }

    #enabled = sw ? true : false;

    get enabled() {
        return this.#enabled;
    }
}();

(async () => {
    if (!$PWA.enabled) return err(`(service worker) unavailable -> https://developer.mozilla.org/ru/docs/Web/API/Navigator/serviceWorker`);

    const controllchange = async () => {
        $PWA.core.set(await $PWA.message.META());
        log(`loaded v:${$PWA.meta.version} h:${$PWA.meta.hash}`);
        $PWA.events.trigger('load', $PWA, { replay: true });

        if ($PWA.core.update.has) {
            $PWA.events.trigger('update', $PWA);
            if (!$PWA.core.reload) return;
            $PWA.core.update.reload();
            window.location.reload();
        }
    }

    sw.addEventListener('controllerchange', controllchange);

    await $PWA.controll.register();

    if (!sw.controller) {
        await $PWA.controll.register();
    }

    if (sw.controller) {
        controllchange();
    }
})(log('module connected'));

$PWA.update.addEventListener('message', ({ data: { type } }) => {
    if (type === 'INSTALL_PERMISSION_REQUEST') {
        $PWA.update.postMessage({ type: 'INSTALL_RECEIVED' });
    }
});