/* =========================================================================
 * Home Manager — bridge.js
 * Everything that talks to Eagle: the plugin lifecycle, libraries and
 * folders, browsing/reading library items, thumbnails, and reading/writing
 * the tags that make attachments permanent.
 *
 * IMPORTANT: Eagle refuses most API calls until its `plugin-create` event has
 * fired — calling one too early throws
 *   "This method can only be used after the `plugin-create` event is triggered."
 * So every method here is inert until that event arrives, and every probe of
 * the `eagle` object is wrapped: a premature call degrades to "no data"
 * instead of throwing.
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});
    const U = HM.util;

    const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tiff', 'tif', 'heic', 'jfif', 'ico'];

    /** True once we know Eagle will accept API calls (event, or a live probe). */
    let pluginCreated = false;
    /** Set when a real API call has actually succeeded. */
    let apiReady = false;
    /** True once the "created" lifecycle event has been announced to listeners. */
    let announced = false;
    /** Payload from the create event, when we were lucky enough to get one. */
    let createPayload = null;
    /** True when `eagle` looks like a real host object. */
    let hostPresent = false;
    let probeTimer = null;

    function api() {
        try {
            return (typeof global.eagle !== 'undefined' && global.eagle) ? global.eagle : null;
        } catch (_) {
            return null;   // a throwing host proxy must never escape
        }
    }

    /**
     * True when the Eagle item API is both present AND safe to call.
     *
     * NOTE: this deliberately does *not* require the plugin-create event. Eagle
     * only delivers that event to handlers registered while the page is loading,
     * so a plugin that waits for it before doing anything can end up waiting
     * forever. Readiness is therefore established by whichever comes first: the
     * event, or a probe that proves calls actually work.
     */
    function available() {
        if (!pluginCreated && !apiReady) return false;
        try {
            const eagle = global.eagle;
            return !!(eagle && eagle.item && typeof eagle.item.get === 'function');
        } catch (_) {
            return false;
        }
    }

    /** Is this specific Eagle sub-module present? Never throws. */
    function has(path) {
        try {
            let node = global.eagle;
            if (!node) return false;
            const parts = String(path).split('.');
            for (const part of parts) {
                if (node === null || node === undefined) return false;
                node = node[part];
            }
            return typeof node === 'function';
        } catch (_) {
            return false;
        }
    }

    function announce() {
        if (announced) return;
        announced = true;
        bridge.ready = true;
        bridge.emit('created', createPayload);
    }

    /** Called by the host when the plugin window is created. */
    function onHostCreate(plugin) {
        pluginCreated = true;
        apiReady = true;
        createPayload = plugin || null;
        bridge.manifest = (plugin && plugin.manifest) || null;
        bridge.pluginPath = (plugin && plugin.path) || '';
        HM.diag.write('readiness', 'plugin-create-event', `path=${bridge.pluginPath || '(none)'}`);
        announce();
    }

    /**
     * Prove usability by actually calling something harmless.
     *
     * Before the create event every Eagle call throws, so this is wrapped and
     * simply reports "not yet". Retried on a timer, it lets the plugin come
     * alive even when the create event never reaches us.
     */
    async function probeOnce() {
        try {
            const eagle = global.eagle;
            if (!eagle || !eagle.item) return false;
            if (typeof eagle.item.countAll === 'function') {
                await eagle.item.countAll();
                return true;
            }
            if (typeof eagle.item.getSelected === 'function') {
                await eagle.item.getSelected();
                return true;
            }
        } catch (_) {
            return false;
        }
        return false;
    }

    function startProbe() {
        if (probeTimer || apiReady) return;
        let attempts = 0;

        const tick = async function () {
            attempts += 1;
            const ok = await probeOnce();
            if (ok) {
                clearInterval(probeTimer);
                probeTimer = null;
                if (!apiReady) {
                    apiReady = true;
                    HM.log.info('Eagle API became callable after', attempts, 'probe attempt(s) — the plugin-create event was not received');
                    HM.diag.write('readiness', 'api-callable-by-probe', `attempts=${attempts} pluginCreated=${pluginCreated}`);
                    announce();
                }
                return;
            }
            if (attempts >= 40) {
                clearInterval(probeTimer);
                probeTimer = null;
                HM.log.warn('Eagle API never became callable after', attempts, 'attempts');
                HM.diag.write('readiness', 'never-callable', `attempts=${attempts}`);
            }
        };

        // Delayed rather than immediate: calling before Eagle has a window id
        // just gets rejected, and this keeps that to a minimum.
        setTimeout(tick, 150);
        probeTimer = setInterval(tick, 400);
    }

    /**
     * Register the create handler at script-evaluation time. Eagle only honours
     * handlers registered during page load; registering later (for example after
     * an `await`) can miss the event entirely, leaving the plugin convinced the
     * API will never be usable.
     */
    function registerEarlyCreateHook() {
        try {
            const eagle = global.eagle;
            hostPresent = !!eagle;
            if (!eagle) return;
            if (typeof eagle.onPluginCreate === 'function') {
                eagle.onPluginCreate(onHostCreate);
            } else {
                HM.log.warn('this Eagle build exposes no onPluginCreate — relying on API probing');
            }
        } catch (err) {
            HM.log.warn('early plugin-create registration failed:', err && err.message);
        }
        // Whether or not the hook took, start proving readiness.
        startProbe();
    }

    function isImage(item) {
        const ext = String((item && item.ext) || '').toLowerCase();
        return IMAGE_EXTS.indexOf(ext) !== -1;
    }

    const bridge = {
        ready: false,
        pluginPath: '',
        manifest: null,
        library: { path: '', name: '' },
        folders: [],
        _fs: null,
        _path: null,
        _thumbCache: new Map(),
        _itemCache: new Map(),
        _listeners: {},

        /* ---------------------------------------------------------------
         * Lifecycle
         * ------------------------------------------------------------- */
        on(event, handler) {
            (this._listeners[event] = this._listeners[event] || []).push(handler);
            // Replay a lifecycle event that has already happened, so listeners
            // registered afterwards still get their first-load work done.
            if (event === 'created' && announced) {
                setTimeout(function () {
                    try { handler(createPayload); } catch (err) { HM.log.error('listener failed', event, err); }
                }, 0);
            }
        },

        /** True when the Eagle item API is reachable AND usable right now. */
        isAvailable() {
            return available();
        },

        /** True once Eagle has fired plugin-create (not required for usability). */
        isCreated() {
            return pluginCreated;
        },

        /** True when any Eagle host object exists at all. */
        hasHost() {
            return hostPresent;
        },

        emit(event, payload) {
            (this._listeners[event] || []).forEach(function (handler) {
                try { handler(payload); } catch (err) { HM.log.error('listener failed', event, err); }
            });
        },

        /**
         * Wire up Eagle lifecycle callbacks. Resolves once the plugin-create
         * event has fired and the library has been read, or after a short
         * timeout when running outside Eagle.
         */
        /**
         * Resolve once the Eagle API is usable — which happens on whichever
         * comes first: the plugin-create event, or a successful probe.
         *
         * Code should not depend on the create event arriving; it is registered
         * at script-evaluation time (registerEarlyCreateHook) precisely because
         * a late registration can miss it.
         */
        init() {
            const self = this;
            try {
                this._fs = require('fs');
                this._path = require('path');
            } catch (_) { /* browser preview */ }

            const eagle = api();
            hostPresent = !!eagle;
            if (!eagle) {
                this.ready = false;
                return Promise.resolve(false);
            }

            return new Promise(function (resolve) {
                let settled = false;
                const finish = function (value) {
                    if (settled) return;
                    settled = true;
                    self.ready = true;
                    resolve(value);
                };

                // Readiness may already have been established while the script
                // was loading, in which case 'created' has been announced and
                // this listener fires on the next tick.
                self.on('created', function () {
                    self.refreshLibrary().then(function () { finish(true); });
                });

                if (announced) finish(true);

                // Keep proving usability in the background; this is what saves
                // us when the create event never arrives.
                startProbe();

                // Safety net: never leave the UI waiting forever.
                setTimeout(function () { finish(available()); }, 2500);

                if (has('onLibraryChanged')) {
                    try {
                        eagle.onLibraryChanged(function (libraryPath) {
                            self.library.path = libraryPath || '';
                            self._thumbCache.clear();
                            self._itemCache.clear();
                            self.refreshLibrary().then(function () { self.emit('library', self.library); });
                        });
                    } catch (err) { HM.log.warn('onLibraryChanged registration failed:', err && err.message); }
                }
                if (has('onThemeChanged')) {
                    try {
                        eagle.onThemeChanged(function (theme) { self.emit('theme', theme); });
                    } catch (err) { HM.log.warn('onThemeChanged registration failed:', err && err.message); }
                }
                if (has('onPluginShow')) {
                    try {
                        eagle.onPluginShow(function () { self.emit('show'); });
                    } catch (err) { HM.log.warn('onPluginShow registration failed:', err && err.message); }
                }
            });
        },

        /* ---------------------------------------------------------------
         * Library & folders
         * ------------------------------------------------------------- */
        async refreshLibrary() {
            const eagle = api();
            this.library = { path: '', name: '' };
            this.folders = [];
            if (!eagle || !available()) return this.library;
            try {
                if (eagle.library) {
                    this.library.path = eagle.library.path || '';
                    this.library.name = eagle.library.name || '';
                }
                if (has('folder.getAll')) {
                    const raw = await eagle.folder.getAll();
                    this.folders = (raw || []).map(function (folder) {
                        return {
                            id: folder.id,
                            name: folder.name || 'Untitled folder',
                            parent: folder.parent || null,
                            icon: folder.icon || '',
                            iconColor: folder.iconColor || ''
                        };
                    });
                }
            } catch (err) {
                HM.log.warn('refreshLibrary failed:', err && err.message);
            }
            return this.library;
        },

        /** Folders arranged as a depth-first tree for the picker sidebar. */
        folderTree() {
            const byId = new Map();
            this.folders.forEach(function (folder) { byId.set(folder.id, Object.assign({}, folder, { children: [] })); });
            const roots = [];
            byId.forEach(function (folder) {
                if (folder.parent && byId.has(folder.parent)) byId.get(folder.parent).children.push(folder);
                else roots.push(folder);
            });
            const sortRec = function (list) {
                list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
                list.forEach(function (f) { sortRec(f.children); });
            };
            sortRec(roots);
            return roots;
        },

        /** Find a root folder by name, creating it when missing. */
        async ensureFolder(name) {
            if (!available() || !name) return null;
            const direct = this.folders.find(function (f) {
                return !f.parent && String(f.name).toLowerCase() === String(name).toLowerCase();
            });
            if (direct) return direct.id;
            try {
                const created = await api().folder.create({ name: name, description: 'Created by Home Manager' });
                this.folders.push({ id: created.id, name: created.name, parent: created.parent || null });
                return created.id;
            } catch (err) {
                HM.log.warn('ensureFolder failed:', err && err.message);
                return null;
            }
        },

        /* ---------------------------------------------------------------
         * Items
         * ------------------------------------------------------------- */
        async countAll() {
            if (!available() || !has('item.countAll')) return null;
            try { return await api().item.countAll(); } catch (_) { return null; }
        },

        /**
         * Query library items for the picker.
         * Only sends the filters that are actually set so Eagle's search does
         * the heavy lifting instead of us pulling the whole library.
         */
        async queryItems(opts) {
            const eagle = api();
            const options = opts || {};
            if (!available()) return [];
            const query = {};

            const keyword = String(options.query || '').trim();
            if (keyword) query.keywords = [keyword];
            if (options.folderId) query.folders = [options.folderId];

            // Without any filter, Eagle would return the entire library. Fall
            // back to the current selection / recents instead of stalling.
            if (!keyword && !options.folderId) {
                const selected = await this.getSelection();
                if (selected.length) return this._decorate(selected, options);
                return [];
            }

            let items = [];
            try {
                items = await eagle.item.get(query);
            } catch (err) {
                HM.log.warn('item.get failed:', err && err.message);
                return [];
            }
            return this._decorate(items || [], options);
        },

        _decorate(items, options) {
            const limit = (options && options.limit) || 300;
            const imagesOnly = !options || options.imagesOnly !== false;
            let list = Array.isArray(items) ? items : [];
            if (imagesOnly) list = list.filter(isImage);
            list.sort(function (a, b) { return (b.modifiedAt || b.importedAt || 0) - (a.modifiedAt || a.importedAt || 0); });
            return list.slice(0, limit).map(function (item) { return bridge.toRef(item); });
        },

        /**
         * Normalise an Eagle item instance into the small shape the UI stores.
         *
         * Idempotent: an already-normalised ref (it has `itemId` and no raw
         * `id`) is returned unchanged. This matters because getSelection()
         * already yields refs, and queryItems() feeds its results back through
         * the decorator — without this guard the refs would be re-converted as
         * if they were raw Eagle items and their `itemId` would be lost.
         */
        toRef(item) {
            if (!item) return null;
            if (item.itemId && item.id === undefined) {
                return Object.assign({}, item, {
                    libraryPath: item.libraryPath || bridge.library.path
                });
            }
            return {
                itemId: item.id,
                name: item.name || item.id,
                ext: item.ext || '',
                width: item.width || null,
                height: item.height || null,
                size: item.size || null,
                url: item.url || '',
                tags: item.tags || [],
                folders: item.folders || [],
                annotation: item.annotation || '',
                importedAt: item.importedAt || null,
                modifiedAt: item.modifiedAt || null,
                thumbnailPath: item.thumbnailPath || '',
                // Kept so thumbnailDataURL() can fall back to Eagle's own
                // file:// URL when the thumbnail bytes cannot be read directly.
                thumbnailURL: item.thumbnailURL || '',
                filePath: item.filePath || '',
                fileURL: item.fileURL || '',
                isImage: isImage(item),
                libraryPath: bridge.library.path
            };
        },

        async getSelection() {
            const eagle = api();
            if (!available() || !has('item.getSelected')) return [];
            try {
                const items = await eagle.item.getSelected();
                return (items || []).map(function (item) { return bridge.toRef(item); });
            } catch (err) {
                HM.log.warn('getSelected failed:', err && err.message);
                return [];
            }
        },

        async getByIds(ids) {
            const eagle = api();
            if (!available() || !ids || !ids.length) return [];
            try {
                const items = await eagle.item.getByIds(ids);
                return (items || []).map(function (item) { return bridge.toRef(item); });
            } catch (err) {
                HM.log.warn('getByIds failed:', err && err.message);
                return [];
            }
        },

        /** Select the given items inside Eagle's main window. */
        async selectItems(ids) {
            const eagle = api();
            if (!available() || !has('item.select')) return false;
            try { return await eagle.item.select(ids); } catch (_) { return false; }
        },

        /** Open an item in Eagle (optionally in its own window). */
        async openItem(itemId, options) {
            const eagle = api();
            if (!available() || !has('item.open')) return false;
            try { await eagle.item.open(itemId, options || {}); return true; } catch (err) {
                HM.log.warn('openItem failed:', err && err.message);
                return false;
            }
        },

        /* ---------------------------------------------------------------
         * Tags
         *
         * Tags are what make an attachment permanent. Home Manager writes a
         * stable identity tag (plus a todo/done state tag) onto every attached
         * Eagle item, so it can rediscover its own attachments from the library
         * itself even if the local data file is lost.
         * ------------------------------------------------------------- */

        /** All items in the active library carrying the given tag(s). */
        async queryByTag(tags, opts) {
            const eagle = api();
            if (!available()) return [];
            const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
            if (!list.length) return [];
            try {
                const items = await eagle.item.get({ tags: list });
                // Tag queries return few items, so non-image files are kept.
                return this._decorate(items || [], Object.assign({ imagesOnly: false }, opts || {}));
            } catch (err) {
                HM.log.warn('item.get by tag failed:', err && err.message);
                return [];
            }
        },

        /**
         * Add and/or remove tags on a single library item.
         * Returns true only when the item was found and saved.
         */
        async setItemTags(itemId, addTags, removeTags) {
            const eagle = api();
            if (!available() || !itemId) return false;
            if (!has('item.getById')) return false;

            const add = (addTags || []).filter(Boolean);
            const remove = (removeTags || []).filter(Boolean);
            if (!add.length && !remove.length) return true;

            try {
                const item = await eagle.item.getById(itemId);
                if (!item) return false;   // not in the active library

                const current = item.tags || [];
                const next = current.slice();
                let changed = false;

                add.forEach(function (tag) {
                    if (next.indexOf(tag) === -1) { next.push(tag); changed = true; }
                });
                remove.forEach(function (tag) {
                    const index = next.indexOf(tag);
                    if (index !== -1) { next.splice(index, 1); changed = true; }
                });

                if (!changed) return true;
                if (typeof item.save !== 'function') return false;

                item.tags = next;
                await item.save();
                this._itemCache.delete(itemId);
                return true;
            } catch (err) {
                HM.log.warn('setItemTags failed for', itemId, err && err.message);
                return false;
            }
        },

        /** Current tag list of a library item (empty when unavailable). */
        async itemTags(itemId) {
            const eagle = api();
            if (!available() || !itemId || !has('item.getById')) return [];
            try {
                const item = await eagle.item.getById(itemId);
                return (item && item.tags) || [];
            } catch (_) {
                return [];
            }
        },

        /* ---------------------------------------------------------------
         * Thumbnails
         * ------------------------------------------------------------- */
        /**
         * Resolve a library item's thumbnail as a data URL.
         *
         * The bytes are read with Node's fs (and the original file as a last
         * resort) so the resulting image never taints a canvas — that is what
         * lets the card renderer compose thumbnails into an exported PNG.
         */
        async thumbnailDataURL(itemId, opts) {
            const options = opts || {};
            if (!itemId) return '';
            if (!options.noCache && this._thumbCache.has(itemId)) return this._thumbCache.get(itemId);

            let item = this._itemCache.get(itemId);
            if (!item) {
                const found = await this.getByIds([itemId]);
                item = found[0] || null;
                if (item) this._itemCache.set(itemId, item);
            }
            if (!item) return '';

            const candidates = [item.thumbnailPath, item.filePath].filter(Boolean);
            for (const filePath of candidates) {
                const dataUrl = this._readAsDataURL(filePath);
                if (dataUrl) {
                    if (!options.noCache) this._thumbCache.set(itemId, dataUrl);
                    return dataUrl;
                }
            }
            // Fall back to Eagle's own file:// URL (fine for <img>, not canvas).
            const fallback = item.thumbnailURL || '';
            if (fallback) this._thumbCache.set(itemId, fallback);
            return fallback;
        },

        _readAsDataURL(filePath) {
            if (!this._fs || !filePath) return '';
            try {
                if (!this._fs.existsSync(filePath)) return '';
                const buffer = this._fs.readFileSync(filePath);
                const ext = String(this._path.extname(filePath) || '').toLowerCase().replace('.', '');
                const mime = {
                    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
                    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
                    tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon'
                }[ext];
                if (!mime) return '';
                return `data:${mime};base64,${buffer.toString('base64')}`;
            } catch (err) {
                HM.log.warn('thumbnail read failed:', filePath, err && err.message);
                return '';
            }
        },

        /**
         * Batch-resolve thumbnails for a list of item ids.
         * Returns a plain object map so it can be cached by callers.
         */
        async thumbnailMap(itemIds) {
            const ids = Array.from(new Set((itemIds || []).filter(Boolean)));
            const out = {};
            // Resolve the item metadata in one round-trip where possible.
            const missing = ids.filter((id) => !this._itemCache.has(id));
            if (missing.length) {
                const refs = await this.getByIds(missing);
                refs.forEach(function (ref) { bridge._itemCache.set(ref.itemId, ref); });
            }
            for (const id of ids) {
                const dataUrl = await this.thumbnailDataURL(id);
                if (dataUrl) out[id] = dataUrl;
            }
            return out;
        },

        /* ---------------------------------------------------------------
         * Notifications & dialogs
         * ------------------------------------------------------------- */
        async notify(title, body, opts) {
            const options = opts || {};
            if (!available() || !has('notification.show')) return false;
            try {
                await api().notification.show({
                    title: title,
                    body: body,
                    mute: options.mute !== undefined ? options.mute : !HM.store.state.settings.sound,
                    duration: options.duration || 6000,
                    icon: options.icon || ''
                });
                return true;
            } catch (err) {
                HM.log.warn('notification failed:', err && err.message);
                return false;
            }
        },

        async confirm(message, detail, buttons) {
            const labels = buttons || ['OK', 'Cancel'];
            if (!available() || !has('dialog.showMessageBox')) {
                // Native fallback works in a plain browser too.
                return global.confirm(detail ? `${message}\n\n${detail}` : message) ? 0 : 1;
            }
            try {
                const result = await api().dialog.showMessageBox({
                    title: 'Home Manager',
                    message: message,
                    detail: detail || '',
                    buttons: labels,
                    type: 'question'
                });
                return result && typeof result.response === 'number' ? result.response : 1;
            } catch (_) {
                return 1;
            }
        },

        async saveFileDialog(defaultName, filters) {
            if (!available() || !has('dialog.showSaveDialog')) return '';
            try {
                const result = await api().dialog.showSaveDialog({
                    title: 'Save file',
                    defaultPath: defaultName,
                    filters: filters || [{ name: 'JSON', extensions: ['json'] }]
                });
                if (!result || result.canceled) return '';
                return result.filePath || '';
            } catch (_) { return ''; }
        },

        async openFileDialog(filters) {
            if (!available() || !has('dialog.showOpenDialog')) return '';
            try {
                const result = await api().dialog.showOpenDialog({
                    title: 'Open file',
                    properties: ['openFile'],
                    filters: filters || [{ name: 'JSON', extensions: ['json'] }]
                });
                if (!result || result.canceled || !result.filePaths || !result.filePaths.length) return '';
                return result.filePaths[0];
            } catch (_) { return ''; }
        },

        /**
         * Write a text file to the user's Downloads folder without a dialog.
         * Used for the "export backup" shortcut.
         */
        writeDownloads(filename, text) {
            if (!this._fs) return '';
            let dir = '';
            try {
                if (pluginCreated && has('app.getPath')) dir = api().app.getPath('downloads');
            } catch (_) { /* ignore */ }
            if (!dir) return '';
            return Promise.resolve(dir).then((resolved) => {
                const dirPath = resolved || dir;
                const target = this._path.join(dirPath, filename);
                this._fs.writeFileSync(target, text, 'utf8');
                return target;
            });
        },

        readTextFile(filePath) {
            if (!this._fs || !filePath) return '';
            try { return this._fs.readFileSync(filePath, 'utf8'); } catch (err) {
                HM.log.warn('readTextFile failed:', err && err.message);
                return '';
            }
        },

        /* ---------------------------------------------------------------
         * Display helpers
         * ------------------------------------------------------------- */
        theme() {
            // Only ask Eagle once the plugin-create event has happened.
            if (pluginCreated || apiReady) {
                try {
                    if (has('app.isDarkColors') && global.eagle.app.isDarkColors()) return 'dark';
                    const name = String(global.eagle.app.theme || '').toUpperCase();
                    if (name === 'DARK') return 'dark';
                } catch (_) { /* fall through to the system preference */ }
            }
            return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        },

        appInfo() {
            const out = { version: '', build: '', platform: '', arch: '', locale: '', created: pluginCreated };
            if (!pluginCreated && !apiReady) return out;
            try {
                const eagle = global.eagle;
                if (eagle && eagle.app) {
                    out.version = eagle.app.version || '';
                    out.build = eagle.app.build || '';
                    out.platform = eagle.app.platform || '';
                    out.arch = eagle.app.arch || '';
                    out.locale = eagle.app.locale || '';
                }
            } catch (_) { /* ignore */ }
            return out;
        }
    };

    HM.bridge = bridge;
    HM.IMAGE_EXTS = IMAGE_EXTS;

    // Register with the host *now*, while the page is still loading. Doing this
    // later (for example after an `await`) risks missing the plugin-create event
    // entirely, which would leave the plugin waiting forever.
    registerEarlyCreateHook();
})(window);
