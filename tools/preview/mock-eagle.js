/* =========================================================================
 * Mock Eagle plugin API + preview harness.
 *
 * Injected into a throwaway copy of the plugin by tools/make-preview.js so the
 * real index.html and the real js/*.js can be rendered in a plain browser for
 * visual checks and runtime-error capture. This file is NOT part of the
 * shipped plugin.
 * ========================================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * Optional strict gate.
     *
     * Eagle throws
     *   "This method can only be used after the `plugin-create` event is
     *    triggered."
     * if a plugin calls the API too early. Adding `latecreate` to the URL hash
     * makes this mock behave the same way and delays the create event, so the
     * "opened the plugin and immediately got an error" bug has a regression
     * test instead of relying on timing luck in the real host.
     * ------------------------------------------------------------------- */
    const MISS_CREATE = /missedcreate/.test(decodeURIComponent(location.hash || ''));
    const LATE_CREATE = /latecreate/.test(decodeURIComponent(location.hash || ''));
    const HOST_NOISE = /hostnoise/.test(decodeURIComponent(location.hash || ''));
    const ENFORCE_GATE = MISS_CREATE || LATE_CREATE || HOST_NOISE;
    const CREATE_DELAY_MS = LATE_CREATE ? 2200 : (HOST_NOISE ? 1200 : 200);
    let pluginCreateFired = false;

    const GUARD_MESSAGE = 'This method can only be used after the `plugin-create` event is triggered. '
        + 'Please refer to the API Document: https://developer.eagle.cool/plugin-api/api/event#gylpl';

    function gate(method) {
        if (!ENFORCE_GATE || pluginCreateFired) return;
        // Exactly what Eagle does: reject a promise with a plain string.
        throw new Error(GUARD_MESSAGE + (method ? ` (called ${method})` : ''));
    }

    // Screenshots must be deterministic: the browser build falls back to
    // localStorage, which would otherwise carry state between headless runs.
    try { window.localStorage.clear(); } catch (_) { /* ignore */ }

    const LOG = { info: function () { }, warn: function () { }, error: function () { } };

    /* ------------------------------------------------------- fake thumbnails */
    const PALETTES = [
        ['#5b6cf2', '#12c2b0'], ['#ef7d4e', '#f5b53d'], ['#3fb6f0', '#5b8def'],
        ['#9b7ef0', '#e0645f'], ['#4cc0a5', '#12c2b0'], ['#f0a63d', '#ef5f5f'],
        ['#7d8cf5', '#3fb6f0'], ['#5fbf6b', '#12c2b0'], ['#b98cd8', '#7d8cf5'],
        ['#ef5f5f', '#f0a63d'], ['#2fa98b', '#5b6cf2'], ['#f2c14e', '#ef7d4e']
    ];

    function makeThumb(index, label) {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');
        const pal = PALETTES[index % PALETTES.length];
        const grad = ctx.createLinearGradient(0, 0, 320, 320);
        grad.addColorStop(0, pal[0]);
        grad.addColorStop(1, pal[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 320, 320);
        // A few shapes so the thumbnails read as photos, not flat colour.
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 5; i += 1) {
            ctx.beginPath();
            ctx.arc(40 + ((index * 37 + i * 61) % 260), 60 + ((index * 53 + i * 43) % 220), 22 + (i * 9), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.font = '700 76px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), 160, 150);
        ctx.font = '600 26px "Segoe UI", sans-serif';
        ctx.fillText(label.slice(0, 12), 160, 212);
        return canvas.toDataURL('image/png');
    }

    const NAMES = [
        'electricity-invoice', 'gas-meter-photo', 'kitchen-meter', 'bathroom-meter',
        'water-bill-scan', 'receipt-january', 'boiler-service', 'insurance-policy',
        'kitchen-sink', 'bathroom-tiles', 'pipes-detail', 'heating-controls',
        'utility-room', 'meter-closeup', 'old-invoice', 'payment-confirmation',
        'gas-boiler', 'radiator', 'water-filter', 'floor-plan'
    ];

    const folders = [
        { id: 'f_home', name: 'Home', parent: null, iconColor: 'blue' },
        { id: 'f_bills', name: 'Bills & invoices', parent: 'f_home', iconColor: 'orange' },
        { id: 'f_meters', name: 'Meter photos', parent: 'f_home', iconColor: 'aqua' },
        { id: 'f_receipts', name: 'Receipts', parent: null, iconColor: 'green' },
        { id: 'f_refs', name: 'Reference', parent: null, iconColor: 'purple' }
    ];

    const items = NAMES.map(function (name, index) {
        const ext = index % 7 === 3 ? 'jpg' : 'png';
        return {
            id: 'ITEM' + String(index + 1).padStart(3, '0'),
            name: name + '.' + ext,
            ext: ext,
            width: 1600,
            height: 1200,
            size: 240000 + index * 1234,
            url: '',
            tags: [index % 2 ? 'home' : 'utilities', 'eagle-demo'],
            folders: [folders[(index % 4) + 1].id],
            annotation: '',
            importedAt: Date.now() - index * 86400000,
            modifiedAt: Date.now() - index * 3600000,
            thumbnailPath: 'C:\\Fake\\Library\\images\\' + name + '.info\\thumbnail.png',
            thumbnailURL: makeThumb(index, name),
            filePath: 'C:\\Fake\\Library\\images\\' + name + '.info\\' + name + '.' + ext,
            isDeleted: false,
            noThumbnail: false,
            noPreview: false,
            star: 0,
            palettes: [],
            comments: []
        };
    });

    let createdCounter = 0;

    function clone(item) {
        const copy = Object.assign({}, item);
        // save() must genuinely persist back into the master list, otherwise
        // tag writes would vanish and the tag tests would prove nothing.
        copy.save = function () {
            const master = items.find(function (i) { return i.id === copy.id; });
            if (master) {
                master.tags = (copy.tags || []).slice();
                master.name = copy.name;
                master.annotation = copy.annotation;
                master.folders = (copy.folders || []).slice();
                master.modifiedAt = Date.now();
            }
            return Promise.resolve(true);
        };
        copy.replaceFile = function () { return Promise.resolve(true); };
        copy.refreshThumbnail = function () { return Promise.resolve(true); };
        copy.setCustomThumbnail = function () { return Promise.resolve(true); };
        copy.moveToTrash = function () { return Promise.resolve(true); };
        copy.open = function () { return Promise.resolve(true); };
        copy.select = function () { return Promise.resolve(true); };
        copy.addComment = function () { return Promise.resolve({ id: 'c1' }); };
        return copy;
    }

    const listeners = {};

    window.eagle = {
        app: {
            version: '4.0',
            build: 22,
            platform: 'win32',
            arch: 'x64',
            locale: 'en',
            theme: 'DARK',
            userDataPath: 'C:\\Users\\demo\\AppData\\Roaming\\Eagle',
            isDarkColors: function () { return true; },
            isWindows: true,
            isMac: false,
            getPath: function () { return Promise.resolve('C:\\Users\\demo\\Downloads'); },
            getFileIcon: function () { return Promise.resolve(null); },
            show: function () { return Promise.resolve(true); }
        },
        library: {
            name: 'Design Library',
            path: 'C:\\Users\\demo\\Pictures\\Design.library',
            modificationTime: Date.now()
        },
        item: {
            get: function (query) {
                let out = items.slice();
                if (query && query.keywords && query.keywords.length) {
                    const needle = String(query.keywords[0]).toLowerCase();
                    out = out.filter(function (i) { return i.name.toLowerCase().indexOf(needle) !== -1; });
                }
                if (query && query.folders && query.folders.length) {
                    out = out.filter(function (i) { return (i.folders || []).indexOf(query.folders[0]) !== -1; });
                }
                // Tag queries must contain every requested tag, mirroring Eagle.
                if (query && query.tags && query.tags.length) {
                    out = out.filter(function (i) {
                        const tags = i.tags || [];
                        return query.tags.every(function (t) { return tags.indexOf(t) !== -1; });
                    });
                }
                return Promise.resolve(out.map(clone));
            },
            getByIds: function (ids) {
                return Promise.resolve(items.filter(function (i) { return ids.indexOf(i.id) !== -1; }).map(clone));
            },
            getById: function (id) {
                const found = items.find(function (i) { return i.id === id; });
                return Promise.resolve(found ? clone(found) : null);
            },
            getSelected: function () {
                return Promise.resolve([items[1], items[3]].map(clone));
            },
            countAll: function () { return Promise.resolve(items.length); },
            count: function () { return Promise.resolve(items.length); },
            countSelected: function () { return Promise.resolve(2); },
            select: function () { return Promise.resolve(true); },
            open: function () { return Promise.resolve(true); },
            addFromBase64: function (dataUrl, options) {
                createdCounter += 1;
                const id = 'NEWITEM' + String(createdCounter).padStart(3, '0');
                items.push({
                    id: id,
                    name: (options && options.name) || 'Generated card',
                    ext: 'png',
                    width: 2800,
                    height: 1800,
                    size: dataUrl.length,
                    tags: (options && options.tags) || [],
                    folders: (options && options.folders) || [],
                    annotation: (options && options.annotation) || '',
                    importedAt: Date.now(),
                    modifiedAt: Date.now(),
                    thumbnailPath: '',
                    thumbnailURL: dataUrl,
                    filePath: '',
                    isDeleted: false,
                    star: 0,
                    palettes: [],
                    comments: []
                });
                return Promise.resolve(id);
            },
            addFromURL: function () { return Promise.resolve('NEWURL'); },
            addFromPath: function () { return Promise.resolve('NEWPATH'); },
            addBookmark: function () { return Promise.resolve('NEWBOOK'); }
        },
        folder: {
            getAll: function () { return Promise.resolve(folders.map(function (f) { return Object.assign({}, f, { description: '', icon: '', children: [] }); })); },
            getById: function (id) { return Promise.resolve(folders.find(function (f) { return f.id === id; })); },
            getSelected: function () { return Promise.resolve([folders[1]]); },
            getRecents: function () { return Promise.resolve(folders.slice(0, 2)); },
            create: function (options) {
                const folder = { id: 'f_new_' + Date.now(), name: options.name, parent: options.parent || null, iconColor: '' };
                folders.push(folder);
                return Promise.resolve(Object.assign({ save: function () { return Promise.resolve(); }, open: function () { return Promise.resolve(); } }, folder));
            }
        },
        notification: {
            show: function (options) {
                LOG.info('notification', options && options.title);
                window.__mockNotifications = window.__mockNotifications || [];
                window.__mockNotifications.push(options);
                return Promise.resolve();
            }
        },
        dialog: {
            showMessageBox: function () { return Promise.resolve({ response: 0 }); },
            showOpenDialog: function () { return Promise.resolve({ canceled: true, filePaths: [] }); },
            showSaveDialog: function () { return Promise.resolve({ canceled: true }); },
            showErrorBox: function () { return Promise.resolve(); }
        },
        os: {
            tmpdir: function () { return 'C:\\Users\\demo\\AppData\\Local\\Temp'; },
            homedir: function () { return 'C:\\Users\\demo'; },
            type: function () { return 'Windows_NT'; }
        },
        window: {
            show: function () { return Promise.resolve(); },
            hide: function () { return Promise.resolve(); },
            setTitle: function () { return Promise.resolve(); },
            capturePage: function () { return Promise.resolve(null); }
        },
        log: LOG,
        onPluginCreate: function (callback) {
            listeners.create = callback;

            if (MISS_CREATE) {
                // Model the real failure: the host had already fired the event
                // by the time we registered, so the handler is accepted but never
                // invoked. The API still becomes callable — the plugin has to
                // work that out for itself.
                window.__createDropped = true;
                setTimeout(function () { pluginCreateFired = true; }, CREATE_DELAY_MS);
                return;
            }

            setTimeout(function () {
                pluginCreateFired = true;
                callback({
                    path: 'C:\\Fake\\Eagle\\plugins\\todo-bills-manager',
                    manifest: { id: 'todo-bills-manager', name: 'Home Manager', version: '1.0.2', logo: '/logo.png' }
                });
            }, CREATE_DELAY_MS);
        },
        onPluginRun: function (callback) { listeners.run = callback; },
        onPluginShow: function (callback) { listeners.show = callback; },
        onPluginHide: function (callback) { listeners.hide = callback; },
        onPluginBeforeExit: function (callback) { listeners.exit = callback; },
        onLibraryChanged: function (callback) { listeners.library = callback; },
        onThemeChanged: function (callback) { listeners.theme = callback; }
    };

    /* --------------------------------------------------- strict gate ---- *
     * Wrap the API surface so every call throws before plugin-create, the
     * way the real host does.                                            */
    if (ENFORCE_GATE) {
        const METHOD_GROUPS = {
            'item': ['get', 'getByIds', 'getById', 'getSelected', 'countAll', 'countSelected',
                'count', 'select', 'open', 'addFromBase64', 'addFromURL', 'addFromPath', 'addBookmark'],
            'folder': ['getAll', 'getById', 'getSelected', 'getRecents', 'create'],
            'notification': ['show'],
            'dialog': ['showMessageBox', 'showOpenDialog', 'showSaveDialog', 'showErrorBox'],
            'app': ['isDarkColors', 'getPath'],
            'os': ['tmpdir']
        };

        Object.keys(METHOD_GROUPS).forEach(function (moduleName) {
            const module = window.eagle[moduleName];
            if (!module) return;
            METHOD_GROUPS[moduleName].forEach(function (methodName) {
                const original = module[methodName];
                if (typeof original !== 'function') return;
                module[methodName] = function () {
                    gate(moduleName + '.' + methodName);
                    return original.apply(this, arguments);
                };
            });
        });
    }

    /* --------------------------------------------------- error capture ---- */
    const errors = [];

    function report(kind, message, stack) {
        errors.push({ kind: kind, message: String(message), stack: stack || '' });
        renderOverlay();
    }

    window.addEventListener('error', function (event) {
        report('error', (event.message || 'unknown') + ' @ ' + (event.filename || '') + ':' + (event.lineno || 0), event.error && event.error.stack);
    });
    window.addEventListener('unhandledrejection', function (event) {
        const reason = event && event.reason;
        const text = (reason && reason.message) || String(reason);
        // In hostnoise mode we deliberately create an unowned rejection that
        // looks exactly like Eagle's own pre-readiness one; the harness must not
        // count it as a plugin failure.
        if (HOST_NOISE && String(text).indexOf('plugin-create` event is triggered') !== -1) {
            window.__hostNoiseSeen = (window.__hostNoiseSeen || 0) + 1;
            return;
        }
        report('promise', text, reason && reason.stack);
    });

    const nativeError = console.error;
    console.error = function () {
        report('console', Array.prototype.join.call(arguments, ' '));
        nativeError.apply(console, arguments);
    };
    const nativeWarn = console.warn;
    console.warn = function () {
        nativeWarn.apply(console, arguments);
    };

    function renderOverlay() {
        let host = document.getElementById('__previewErrors');
        if (!host) {
            host = document.createElement('div');
            host.id = '__previewErrors';
            host.style.cssText = [
                'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:9999',
                'background:rgba(140,20,20,0.96)', 'color:#fff', 'font:12px/1.5 Consolas,monospace',
                'padding:10px 14px', 'max-height:42vh', 'overflow:auto',
                'border-top:3px solid #ff6b6b', 'white-space:pre-wrap'
            ].join(';');
            document.body.appendChild(host);
        }
        host.textContent = '⚠ ' + errors.length + ' runtime error(s)\n\n'
            + errors.slice(0, 12).map(function (e, i) {
                return (i + 1) + ') [' + e.kind + '] ' + e.message;
            }).join('\n\n');
        document.title = 'ERRORS:' + errors.length;

        // A loud top bar whenever the app threw, so a contact sheet of every
        // view makes failures impossible to miss.
        let bar = document.getElementById('__previewBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = '__previewBar';
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:8px;z-index:10000;';
            document.body.appendChild(bar);
        }
        bar.style.background = '#ff3b3b';
    }

    /** Thin green bar = the harness loaded and the plugin never threw. */
    function renderOkBar() {
        if (document.getElementById('__previewBar')) return;
        const bar = document.createElement('div');
        bar.id = '__previewBar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:8px;z-index:10000;background:#22c55e;';
        document.body.appendChild(bar);
        document.title = 'OK';
    }

    window.__previewErrors = errors;

    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const assert = function (condition, message) { if (!condition) throw new Error(message); };

    /** Drives the real editor + picker to prove attachments persist. */
    async function runAttachFlow() {
        const store = window.HM.store;
        const bill = store.bills()[0];
        const diag = [];

        // Trace the store call the UI is supposed to make.
        const originalAdd = store.addAttachments.bind(store);
        store.addAttachments = function (target, refs) {
            diag.push('addAttachments(target=' + (target && target.id)
                + ' isStoredRecord=' + (target === store.get(bill.id))
                + ' refs=' + ((refs && refs.length) || 0) + ')');
            return originalAdd(target, refs);
        };

        // Start from a clean slate: the picker offers Eagle's current selection,
        // and picking an already-attached item is (correctly) a no-op.
        store.get(bill.id).attachments = [];
        const before = 0;

        window.HM.app.navigate('bills');
        window.HM.views.openEditor(store.get(bill.id), window.HM.app.ctx);
        await wait(320);

        const titleInput = document.querySelector('#drawerBody input[type="text"]');
        assert(titleInput, 'editor title input not found');
        const typed = 'EDITED TITLE 123';
        titleInput.value = typed;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));

        const addButton = document.querySelector('#drawerBody .attach-add');
        assert(addButton, '“From Eagle” attach button not found in the editor');
        addButton.click();
        await wait(600);

        const tiles = document.querySelectorAll('#modalBackdrop .item-tile');
        diag.push('pickerTiles=' + tiles.length);
        assert(tiles.length, 'picker showed no item tiles');
        tiles[0].click();
        await wait(150);
        diag.push('selected=' + document.querySelectorAll('#modalBackdrop .item-tile.selected').length);

        const attachButton = Array.prototype.slice
            .call(document.querySelectorAll('#modalBackdrop .modal-foot button'))
            .find(function (b) { return /^Attach/.test(b.textContent.trim()); });
        assert(attachButton, 'picker “Attach selected” button not found');
        attachButton.click();
        await wait(700);

        const stored = store.get(bill.id);
        const titleAfter = document.querySelector('#drawerBody input[type="text"]');
        diag.push('afterAttachments=' + stored.attachments.length);
        diag.push('typedPreserved=' + (titleAfter ? titleAfter.value === typed : 'input-gone'));

        store.addAttachments = originalAdd;

        assert(stored.attachments.length === before + 1,
            'attachment not persisted [' + diag.join(', ') + ']');
        assert(titleAfter && titleAfter.value === typed,
            `form input was reset by the attachment refresh [${diag.join(', ')}]`);

        // Re-picking the same item must not duplicate it.
        const again = stored.attachments[0].itemId;
        originalAdd(stored, [{ itemId: again, name: 'dupe' }]);
        assert(store.get(bill.id).attachments.length === 1, 'duplicate attachment was added');

        // Surface the outcome in the drawer so the screenshot shows it.
        const drawer = document.getElementById('drawerBody');
        const banner = document.createElement('div');
        banner.style.cssText = 'margin-top:16px;padding:12px 14px;border-radius:12px;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.5);color:#86efac;font-weight:700;font-size:13px';
        banner.textContent = `✓ attach flow passed — attachment persisted (${stored.attachments.length}), duplicates rejected, typed title preserved`;
        if (drawer) drawer.appendChild(banner);
    }

    /**
     * The core promise of the tag design, driven through the real UI:
     *   attach -> item carries hm:tN + hm:todo
     *   complete the task -> tag flips to hm:done
     *   lose the local data -> attachment is recovered from the tag alone
     *   detach -> tags are removed from the item
     */
    async function runTagFlow() {
        const store = window.HM.store;
        const tags = window.HM.tags;
        const diag = [];

        // Use a dedicated one-off task. A recurring task deliberately stays
        // open when completed (it rolls to the next occurrence), so it would
        // never flip to hm:done.
        const task = store.add(window.HM.model.newTask({
            title: 'TAG FLOW TASK',
            dueDate: window.HM.util.todayISO(),
            repeat: 'none'
        }));
        assert(task && task.id, 'could not create a task for the tag flow');

        // Clean slate for this task.
        const start = store.get(task.id);
        start.attachments = [];
        start.tagCode = 0;
        if (start.done) store.toggleTask(start.id);
        tags.ensureCode(store.get(task.id));            // allocates the numeric code
        const identity = tags.identityTag(store.get(task.id));   // e.g. 'hm:t1'
        assert(identity, 'could not allocate an identity tag');
        diag.push('identity=' + identity);

        // 1. Attach through the real picker in the real editor.
        window.HM.app.navigate('tasks');
        window.HM.views.openEditor(store.get(task.id), window.HM.app.ctx);
        await wait(320);

        const addButton = document.querySelector('#drawerBody .attach-add');
        assert(addButton, 'attach button missing in the editor');
        addButton.click();
        await wait(600);
        const tiles = document.querySelectorAll('#modalBackdrop .item-tile');
        assert(tiles.length, 'picker showed no tiles');
        // Take the last tile: the earlier ones are already attached to the
        // seeded records, and an item shared between two open records would
        // carry both todo state tags, which muddies the assertions below.
        tiles[tiles.length - 1].click();
        await wait(120);
        const attachButton = Array.prototype.slice
            .call(document.querySelectorAll('#modalBackdrop .modal-foot button'))
            .find(function (b) { return /^Attach/.test(b.textContent.trim()); });
        assert(attachButton, 'picker attach button missing');
        attachButton.click();
        await wait(800);

        const stored = store.get(task.id);
        assert(stored.attachments.length === 1, 'attachment was not stored on the task');
        const itemId = stored.attachments[0].itemId;

        let itemTags = await window.HM.bridge.itemTags(itemId);
        diag.push('afterAttach=' + JSON.stringify(itemTags));
        assert(itemTags.indexOf(identity) !== -1,
            `identity tag ${identity} was not written to the Eagle item [${diag.join(' ')}]`);
        assert(itemTags.indexOf('hm:todo') !== -1,
            `hm:todo was not written to the Eagle item [${diag.join(' ')}]`);

        // 2. Complete the task through the row checkbox -> tag becomes hm:done.
        window.HM.ui.closeDrawer();
        const row = Array.prototype.slice.call(document.querySelectorAll('.task-row')).find(function (r) {
            const title = r.querySelector('.task-title');
            return title && title.textContent.trim() === (task.title || 'Untitled task');
        });
        assert(row, 'could not find the task row in the list');
        row.querySelector('.check').click();
        await wait(900);

        itemTags = await window.HM.bridge.itemTags(itemId);
        diag.push('afterComplete=' + JSON.stringify(itemTags));
        assert(itemTags.indexOf('hm:done') !== -1,
            `hm:done was not written after completing the task [${diag.join(' ')}]`);
        assert(itemTags.indexOf('hm:todo') === -1,
            `hm:todo was not removed after completing the task [${diag.join(' ')}]`);

        // 3. Wipe the local link and rebuild it purely from the Eagle tag.
        store.get(task.id).attachments = [];
        await store.save();
        const reconciled = await tags.reconcileAll();
        const recovered = store.get(task.id);
        diag.push('recovered=' + reconciled.recovered);
        assert(recovered.attachments.length === 1,
            `attachment was not recovered from the Eagle tag [${diag.join(' ')}]`);
        assert(recovered.attachments[0].itemId === itemId,
            'recovered the wrong item from the tag');

        // 4. Detach and confirm the tags are gone from the item.
        await tags.detach(recovered, itemId);
        store.removeAttachment(recovered.id, itemId);
        itemTags = await window.HM.bridge.itemTags(itemId);
        diag.push('afterDetach=' + JSON.stringify(itemTags));
        assert(itemTags.indexOf(identity) === -1, `identity tag survived detach [${diag.join(' ')}]`);
        assert(itemTags.indexOf('hm:todo') === -1 && itemTags.indexOf('hm:done') === -1,
            `state tag survived detach [${diag.join(' ')}]`);

        window.HM.app.render();
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:9998;'
            + 'padding:12px 18px;border-radius:12px;background:rgba(34,197,94,0.18);'
            + 'border:1px solid rgba(34,197,94,0.55);color:#86efac;font-weight:700;font-size:13px;max-width:90vw';
        banner.textContent = `✓ tag flow passed — ${identity} + hm:todo written, flipped to hm:done on completion, `
            + 'recovered from the tag after local data loss, and stripped on detach';
        document.body.appendChild(banner);
    }

    /**
     * Regression test for the reported bug: attach an Eagle item while creating
     * a NEW record, save it, then detach.
     *
     * Attaching writes two tags (the identity tag plus the todo/done state tag).
     * Detaching must remove BOTH. It used to leave the identity tag stranded,
     * because the tag code was allocated on the editor's unsaved draft and was
     * not carried across on save — so the record no longer knew which tag was
     * its own and only the state tag got stripped.
     */
    async function runNewAttachFlow() {
        const store = window.HM.store;
        const tags = window.HM.tags;
        const bridge = window.HM.bridge;
        const diag = [];

        window.HM.app.navigate('bills');
        window.HM.views.openEditor(null, window.HM.app.ctx, 'bill');
        await wait(350);

        const titleInput = document.querySelector('#drawerBody input[type="text"]');
        assert(titleInput, 'new-bill title input missing');
        titleInput.value = 'TAG NEW BILL';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Attach BEFORE the record is saved — the case that used to lose the code.
        const addButton = document.querySelector('#drawerBody .attach-add');
        assert(addButton, 'attach button missing');
        addButton.click();
        await wait(600);
        const tiles = document.querySelectorAll('#modalBackdrop .item-tile');
        assert(tiles.length, 'picker showed no tiles');
        tiles[tiles.length - 1].click();
        await wait(120);
        const attachButton = Array.prototype.slice
            .call(document.querySelectorAll('#modalBackdrop .modal-foot button'))
            .find(function (b) { return /^Attach/.test(b.textContent.trim()); });
        assert(attachButton, 'picker attach button missing');
        attachButton.click();
        await wait(800);

        const createButton = Array.prototype.slice
            .call(document.querySelectorAll('#drawerFoot button'))
            .find(function (b) { return /^Create/.test(b.textContent.trim()); });
        assert(createButton, 'Create button missing in the drawer footer');
        createButton.click();
        await wait(600);

        const bill = store.bills().find(function (b) { return b.title === 'TAG NEW BILL'; });
        assert(bill, 'the new bill was not created');
        diag.push('tagCode=' + bill.tagCode);
        assert(bill.tagCode, `the created bill has no tag code [${diag.join(' ')}]`);
        assert(bill.attachments.length === 1, 'the attachment was not carried onto the created bill');

        const identity = tags.identityTag(bill);
        const itemId = bill.attachments[0].itemId;

        // 1. Attaching writes exactly two tags: identity + state.
        let itemTags = await bridge.itemTags(itemId);
        diag.push('afterAttach=' + JSON.stringify(itemTags));
        assert(itemTags.indexOf(identity) !== -1,
            `identity tag ${identity} missing after attach [${diag.join(' ')}]`);
        assert(itemTags.indexOf('hm:todo') !== -1,
            `hm:todo missing after attach [${diag.join(' ')}]`);

        // 2. Detaching removes BOTH. This is the reported failure.
        const result = await tags.detach(bill, itemId, bill.attachments[0]);
        store.removeAttachment(bill.id, itemId);
        itemTags = await bridge.itemTags(itemId);
        diag.push('afterDetach=' + JSON.stringify(itemTags) + ' removed=' + JSON.stringify(result.removed));
        assert(itemTags.every(function (t) { return !/^hm:/.test(t); }),
            `hm: tags survived detach [${diag.join(' ')}]`);

        // 3. Healing: a record that already lost its code recovers it from the
        //    tags on its items, so an already-stranded tag can be cleaned up.
        await bridge.setItemTags(itemId, [identity, 'hm:todo'], ['hm:done']);
        bill.tagCode = 0;
        bill.attachments = [{ itemId: itemId, name: 'stranded', ext: 'png' }];
        const recovered = await tags.adoptCode(bill);
        diag.push('adopted=' + recovered);
        assert(recovered === identity,
            `adoptCode did not recover ${identity} from the item [${diag.join(' ')}]`);
        assert(bill.tagCode, 'the record code was not healed');

        const healed = await tags.detach(bill, itemId, null);
        itemTags = await bridge.itemTags(itemId);
        diag.push('afterHealDetach=' + JSON.stringify(itemTags));
        assert(healed.ok, `detach after healing failed [${diag.join(' ')}]`);
        assert(itemTags.every(function (t) { return !/^hm:/.test(t); }),
            `the stranded tag was not cleaned up [${diag.join(' ')}]`);

        window.HM.app.render();
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:9998;'
            + 'padding:12px 18px;border-radius:12px;background:rgba(34,197,94,0.18);'
            + 'border:1px solid rgba(34,197,94,0.55);color:#86efac;font-weight:700;font-size:13px;max-width:92vw';
        banner.textContent = `✓ new-record attach/detach passed — ${identity} + hm:todo written on attach, `
            + 'both removed on detach, and a record that lost its code healed itself from the tag';
        document.body.appendChild(banner);
    }

    /* ------------------------------------------- drive the plugin for shots */    window.addEventListener('load', function () {
        // In hostnoise mode, emit an unowned rejection that mirrors Eagle's own
        // pre-readiness one — before the plugin's window id exists.
        if (HOST_NOISE) {
            setTimeout(function () {
                Promise.reject(GUARD_MESSAGE);
            }, 300);
        }

        setTimeout(async function () {
            const raw = decodeURIComponent((location.hash || '#dashboard').slice(1));
            const parts = raw.split(':');
            const view = parts[0] || 'dashboard';
            const action = parts[1] || '';

            if (!window.HM || !window.HM.app) return;

            // Attach a few Eagle items so the attachment UI has content.
            try {
                const store = window.HM.store;
                const refs = items.slice(0, 4).map(function (i) {
                    return { itemId: i.id, name: i.name, ext: i.ext, libraryPath: window.eagle.library.path };
                });
                const bill = store.bills()[0];
                if (bill) store.addAttachments(bill, refs.slice(0, 3));
                const meter = store.meters()[0];
                if (meter) {
                    store.addAttachments(meter, refs.slice(1, 2));
                    store.addReading(meter.id, { date: '2026-07-05', value: 1210.4 });
                    store.addReading(meter.id, { date: '2026-08-04', value: 1226.9, note: 'after holiday' });
                    store.addReading(meter.id, { date: '2026-09-03', value: 1241.2 });
                }
                const meter2 = store.meters()[1];
                if (meter2) {
                    store.addReading(meter2.id, { date: '2026-08-02', value: 640 });
                    store.addReading(meter2.id, { date: '2026-09-02', value: 651.5 });
                }
                // A paid bill, so payment history has something to show.
                const second = store.bills()[1];
                if (second) store.markPaid(second.id, { amount: 44.9, note: 'paid by card' });
                // A completed task, for the done-state styling.
                const task = store.tasks()[0];
                if (task && !task.done) store.toggleTask(task.id);
                // Attach tagged items to an open task, which is the main flow:
                // the items get hm:tN + hm:todo written onto them. In the gated
                // "latecreate" test the host refuses API calls at this point, so
                // this is retried once the create event has arrived.
                const openTask = store.tasks().find(function (t) { return !t.done; });
                if (openTask) store.addAttachments(openTask, refs.slice(0, 2));

                const applySeedTags = async function () {
                    try {
                        const target = store.tasks().find(function (t) { return (t.attachments || []).length; });
                        if (!target) return;
                        await window.HM.tags.applyTo(store.get(target.id), refs.slice(0, 2));
                    } catch (_) { /* host not ready yet (only in the gated test) */ }
                };
                await applySeedTags();
                // Only the gated test needs the retry (the host rejects calls
                // before plugin-create). Retrying unconditionally would re-tag
                // seeded items in the middle of the tag-flow assertions.
                if (ENFORCE_GATE) setTimeout(applySeedTags, 2700);
                // Give a task a checklist so the editor shows one.
                const other = store.tasks()[1];
                if (other) {
                    store.update(other.id, {
                        checklist: [
                            { text: 'Open the windows', done: true },
                            { text: 'Press and hold the test button', done: false },
                            { text: 'Log the result in Eagle', done: false }
                        ]
                    });
                }
            } catch (err) {
                report('seed', (err && err.message) || err, err && err.stack);
            }

            if (window.HM.views && window.HM.views.viewMeta[view]) {
                window.HM.app.navigate(view);
            }

            try {
                if (action === 'editor') {
                    const store = window.HM.store;
                    const record = view === 'tasks' ? store.tasks()[1]
                        : view === 'water' ? store.meters()[0]
                            : store.bills()[0];
                    if (record) window.HM.views.openEditor(record, window.HM.app.ctx);
                } else if (action === 'new') {
                    const kind = view === 'tasks' ? 'task' : view === 'water' ? 'meter' : 'bill';
                    window.HM.views.openEditor(null, window.HM.app.ctx, kind);
                } else if (action === 'paid') {
                    const bill = window.HM.store.bills().find(function (b) { return !b.paid; });
                    if (bill) window.HM.views.markPaid(bill, window.HM.app.ctx);
                } else if (action === 'picker') {
                    window.HM.ui.pickEagleItems({ multiple: true, title: 'Attach Eagle items' });
                } else if (action === 'menu') {
                    // The real click path on the toolbar button.
                    const button = document.getElementById('newButton');
                    assert(button, '#newButton is missing from the topbar');
                    button.click();
                    await wait(350);
                    const cards = document.querySelectorAll('#modalBackdrop .create-card');
                    assert(cards.length === 3, `create dialog showed ${cards.length} choices, expected 3`);
                } else if (action === 'attachflow') {
                    // End-to-end check of the editor attachment flow: open the
                    // editor, type into a field, attach an Eagle item through
                    // the real picker, and assert BOTH that the attachment was
                    // persisted to the stored record and that the typed value
                    // survived the strip refresh.
                    await runAttachFlow();
                } else if (action === 'tagflow') {
                    // The core promise: attachments are permanent because they
                    // live as tags on the Eagle items.
                    await runTagFlow();
                } else if (action === 'newattach') {
                    // Regression test for the stranded hm: tag on detach.
                    await runNewAttachFlow();
                } else if (action === 'latecreate') {
                    // Regression test: Eagle refuses API calls until its
                    // plugin-create event fires. Right now (t≈700ms) it has NOT
                    // fired, so the plugin must be completely inert instead of
                    // throwing "This method can only be used after the
                    // plugin-create event is triggered."
                    const bridge = window.HM.bridge;
                    assert(!bridge.isCreated(), 'create event already fired; the test timing is wrong');
                    assert(!bridge.isAvailable(), 'bridge reports available before plugin-create');
                    assert(window.__previewErrors.length === 0,
                        `the plugin threw before plugin-create: ${JSON.stringify(window.__previewErrors)}`);

                    await wait(2800);   // past the delayed create event

                    assert(bridge.isCreated(), 'plugin-create never reached the bridge');
                    assert(bridge.isAvailable(), 'Eagle API not usable after plugin-create');

                    const task = window.HM.store.tasks().find(function (t) {
                        return (t.attachments || []).length;
                    });
                    assert(task, 'no task carried seeded attachments');
                    const itemTags = await bridge.itemTags(task.attachments[0].itemId);
                    assert(itemTags.some(function (t) { return /^hm:t\d+$/.test(t); }),
                        `tags were not written once the host was ready: ${JSON.stringify(itemTags)}`);
                } else if (action === 'hostnoise') {
                    // Eagle's own preload rejects with the guard string before the
                    // plugin has a window id. That is expected host noise and must
                    // NOT be reported to the user as a failure.
                    await wait(900);
                    const alarms = Array.prototype.slice.call(document.querySelectorAll('.toast'))
                        .filter(function (t) { return /Something went wrong/.test(t.textContent); });
                    assert(window.__hostNoiseSeen >= 1,
                        'harness did not inject the unowned pre-readiness rejection');
                    assert(alarms.length === 0,
                        `the plugin alarmed the user about Eagle's own pre-readiness rejection: ${alarms.map(function (t) { return t.textContent; }).join(' | ')}`);
                } else if (action === 'missedcreate') {
                    // The host never delivers plugin-create at all. The plugin
                    // must still come alive by proving usability itself, and must
                    // never have thrown on the way there.
                    const bridge = window.HM.bridge;
                    assert(window.__createDropped, 'harness did not simulate a dropped create event');
                    assert(!bridge.isCreated(), 'create event should never have arrived');
                    assert(window.__previewErrors.length === 0,
                        `the plugin threw while the host stayed silent: ${JSON.stringify(window.__previewErrors)}`);

                    await wait(2200);   // API becomes callable; probing should notice

                    assert(bridge.isAvailable(),
                        'the plugin never became usable even though the Eagle API was callable');
                    assert(!bridge.isCreated(), 'pluginCreated should still be false — no event was sent');

                    const task = window.HM.store.tasks().find(function (t) {
                        return (t.attachments || []).length;
                    });
                    assert(task, 'no task carried seeded attachments');
                    const itemTags = await bridge.itemTags(task.attachments[0].itemId);
                    assert(itemTags.some(function (t) { return /^hm:t\d+$/.test(t); }),
                        `tags were not written after self-detecting readiness: ${JSON.stringify(itemTags)}`);
                    assert(!window.__previewErrors.length, 'errors appeared during the silent-host run');
                }
            } catch (err) {
                report('action', (err && err.message) || err, err && err.stack);
            }

            if (!errors.length) renderOkBar();
        }, 700);
    });
})();
