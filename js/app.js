/* =========================================================================
 * Home Manager — app.js
 * Bootstrap, routing, the sidebar/topbar chrome, keyboard shortcuts and the
 * reminder engine that turns due dates into Eagle notifications.
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});
    const U = HM.util;
    const ui = HM.ui;
    const store = () => HM.store;

    const NAV = [
        { id: 'dashboard', label: 'Dashboard', icon: '🏠', group: 'Overview' },
        { id: 'reminders', label: 'Reminders', icon: '⏰', group: 'Overview' },
        { id: 'tasks', label: 'Tasks', icon: '✅', group: 'Manage' },
        { id: 'bills', label: 'Bills', icon: '🧾', group: 'Manage' },
        { id: 'water', label: 'Water meters', icon: '💧', group: 'Manage' },
        { id: 'attached', label: 'Attached items', icon: '🖼', group: 'Eagle' },
        { id: 'settings', label: 'Settings', icon: '⚙️', group: 'Eagle' }
    ];

    const REMINDER_INTERVAL_MS = 30000;

    const app = {
        view: 'dashboard',
        search: '',
        billFilter: 'open',
        billCategory: 'all',
        taskFilter: 'open',
        libraryCount: null,
        ctx: null,
        _reminderTimer: null,
        _lastReminderSweep: 0,

        /* ---------------------------------------------------------------
         * Bootstrap
         * ------------------------------------------------------------- */
        async init() {
            this.applyTheme();

            await store().init();

            const self = this;
            this.ctx = {
                app: this,
                navigate: function (view, options) { self.navigate(view, options); },
                refresh: function () { self.render(); },
                refreshSoft: function () { self.renderChrome(); },
                libraryCount: null
            };

            this.bindChrome();
            this.bindKeyboard();
            this.startReminders();

            // Eagle lifecycle is asynchronous; render immediately with cached
            // data and again once the library is known.
            this.render();

            HM.bridge.on('library', function () {
                ui.clearThumbCache();
                self.render();
                ui.toast('Library changed', HM.bridge.library.name || 'Eagle switched libraries.', 'info');
                // Tags written for the previous library are not readable here,
                // and items tagged there may now be reachable.
                self.syncTags(true);
            });
            HM.bridge.on('theme', function () {
                self.applyTheme();
            });
            HM.bridge.on('show', function () {
                // Coming back to the window is a good moment to re-check.
                self.sweepReminders(true);
                self.render();
            });

            // Rebuild attachment links from the Eagle tags as soon as the
            // plugin-create event arrives: the tags are the durable record,
            // data.json is only a cache. Doing this on the event (rather than a
            // timer) guarantees the Eagle API is legal to call.
            HM.bridge.on('created', function () {
                if (store().state.settings.syncTagsOnLoad) self.syncTags(true);
            });

            await HM.bridge.init();

            // The data path comes from Eagle, which refuses API access until the
            // plugin is created — so a path resolved during start-up is often
            // empty and storage fell back to localStorage. Now that Eagle is
            // ready, move it to disk.
            const upgrade = await store().upgradeBackend();
            if (upgrade !== 'none') HM.log.info('storage backend:', store().backend, store().dataPath);

            this.applyTheme();
            this.refreshLibraryCount();
            this.render();

            // First reminder sweep shortly after launch, so the user is not
            // buried in notifications the instant the window opens.
            setTimeout(function () { self.sweepReminders(true); }, 4000);

            // A single, greppable startup line. The plugin version is included
            // so %APPDATA%\Eagle\log.log answers "which build is actually
            // running?" — the answer to a lot of confusing bug reports.
            const readiness = `eagleApi=${HM.bridge.isAvailable() ? 'ready' : 'not-ready'}`
                + ` pluginCreated=${HM.bridge.isCreated()} host=${HM.bridge.hasHost()}`
                + ` backend=${store().backend} data=${store().dataPath || '(localStorage)'}`;
            HM.log.info(`started v${self.version()} — ${readiness}`);
            HM.diag.write('startup', `v${self.version()}`, readiness);
        },

        /**
         * The running plugin version. Prefers the manifest from the create
         * event, but falls back to the version baked into util.js so a missed
         * event can never leave the diagnostics reporting "dev".
         */
        version() {
            return (HM.bridge.manifest && HM.bridge.manifest.version) || HM.VERSION || 'unknown';
        },

        /**
         * Re-read hm: tags from Eagle and adopt anything they point at.
         * Deliberately total: a failure here must never surface as an
         * unhandled rejection.
         */
        async syncTags(quiet) {
            let usable = false;
            try {
                usable = HM.tags.enabled();
            } catch (_) {
                usable = false;
            }
            if (!usable) {
                if (!quiet) ui.toast('Eagle not ready', 'Tag sync waits for Eagle to finish opening the plugin.', 'warn');
                return { records: 0, recovered: 0, failed: 0 };
            }
            try {
                const result = await HM.tags.reconcileAll();
                if (result.recovered) {
                    this.render();
                    if (!quiet) ui.toast('Tags synced', `${U.pluralize(result.recovered, 'attachment')} recovered from Eagle.`, 'ok');
                } else if (!quiet) {
                    ui.toast('Tags synced', `Checked ${U.pluralize(result.records, 'record')}; everything matched.`, 'ok');
                }
                return result;
            } catch (err) {
                HM.log.warn('tag sync on load failed', err);
                if (!quiet) ui.toast('Tag sync failed', (err && err.message) || 'Unknown error.', 'err');
                return { records: 0, recovered: 0, failed: 1 };
            }
        },

        applyTheme() {
            const theme = HM.bridge.ready ? HM.bridge.theme() : (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.dataset.theme = theme;
        },

        async refreshLibraryCount() {
            try {
                this.libraryCount = await HM.bridge.countAll();
                this.ctx.libraryCount = this.libraryCount;
            } catch (_) {
                this.libraryCount = null;
            }
            if (this.view === 'settings') this.render();
        },

        /* ---------------------------------------------------------------
         * Navigation & rendering
         * ------------------------------------------------------------- */
        navigate(view, options) {
            const opts = options || {};
            this.view = view;
            if (opts.filter !== undefined) this.billFilter = opts.filter;
            if (view !== 'bills' && opts.filter === undefined) this.billCategory = 'all';
            this.render();
            const content = document.getElementById('content');
            if (content) content.scrollTop = 0;

            if (opts.focusReading || opts.focusMeter) {
                setTimeout(function () {
                    const target = opts.focusMeter
                        ? document.querySelector('.meter-card')
                        : document.querySelector('.meter-card input[type="number"]');
                    if (target) {
                        if (target.tagName === 'INPUT') target.focus();
                        else target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 120);
            }
        },

        render() {
            this.renderChrome();
            const content = document.getElementById('content');
            if (!content) return;
            HM.views.render(content, this.ctx);
        },

        renderChrome() {
            this.renderSidebar();
            this.renderTopbar();
        },

        renderSidebar() {
            const host = document.getElementById('nav');
            if (!host) return;
            host.innerHTML = '';

            const summary = store().summary();
            const badges = {
                reminders: summary.overdueCount ? { text: String(summary.overdueCount), kind: 'alert' } : null,
                bills: (function () {
                    const unpaid = store().bills().filter(function (b) { return !b.paid; }).length;
                    if (!unpaid) return null;
                    return { text: String(unpaid), kind: summary.overdueCount ? 'warn' : '' };
                })(),
                tasks: (function () {
                    const open = store().tasks().filter(function (t) { return !t.done; }).length;
                    return open ? { text: String(open), kind: '' } : null;
                })(),
                water: (function () {
                    const attention = store().meters().filter(function (m) {
                        const key = store().meterStatus(m).key;
                        return key === 'overdue' || key === 'today';
                    }).length;
                    return attention ? { text: String(attention), kind: 'warn' } : null;
                })()
            };

            let lastGroup = '';
            NAV.forEach(function (item) {
                if (item.group !== lastGroup) {
                    lastGroup = item.group;
                    host.appendChild(U.el('div', { class: 'nav-group-label', text: item.group }));
                }
                const badge = badges[item.id];
                const self = app;
                host.appendChild(U.el('button', {
                    class: `nav-item${self.view === item.id ? ' active' : ''}`,
                    onclick: function () { self.navigate(item.id); }
                }, [
                    U.el('span', { class: 'nav-icon', text: item.icon }),
                    U.el('span', { class: 'nav-label', text: item.label }),
                    badge ? U.el('span', { class: `nav-badge${badge.kind ? ' ' + badge.kind : ''}`, text: badge.text }) : null
                ]));
            });

            const libraryHost = document.getElementById('libraryChip');
            if (libraryHost) {
                libraryHost.innerHTML = '';
                const library = HM.bridge.library;
                libraryHost.appendChild(U.el('div', { class: 'library-chip', title: library.path || 'No Eagle library detected' }, [
                    U.el('span', { class: 'library-icon', text: '🦅' }),
                    U.el('div', { class: 'library-meta' }, [
                        U.el('div', { class: 'library-name', text: library.name || (HM.bridge.ready ? 'Eagle library' : 'Standalone mode') }),
                        U.el('div', {
                            class: 'library-path',
                            text: library.path || (HM.bridge.ready ? 'Reading library…' : 'Eagle API not detected')
                        })
                    ])
                ]));
            }
        },

        renderTopbar() {
            const meta = HM.views.viewMeta[this.view] || { title: 'Home Manager', sub: '' };
            const titleNode = document.getElementById('pageTitle');
            const subNode = document.getElementById('pageSub');
            if (titleNode) titleNode.textContent = meta.title;

            if (subNode) {
                const summary = store().summary();
                let sub = meta.sub;
                if (this.view === 'dashboard' && summary.alerts.length) {
                    sub = `${U.pluralize(summary.alerts.length, 'open item')} tracked · ${summary.overdueCount ? summary.overdueCount + ' overdue' : 'nothing overdue'}`;
                } else if (this.view === 'bills') {
                    sub = `${U.fmtMoney(summary.openBillsTotal, store().state.settings.currency)} outstanding across ${U.pluralize(summary.openBillCount, 'open bill')}`;
                } else if (this.view === 'tasks') {
                    sub = `${U.pluralize(summary.openTaskCount, 'open task')}${summary.overdueTasks ? ` · ${summary.overdueTasks} overdue` : ''}`;
                } else if (this.view === 'water') {
                    sub = `${U.pluralize(store().meters().length, 'meter')} · ${U.pluralize(store().meters().reduce(function (acc, m) { return acc + m.readings.length; }, 0), 'reading')} logged`;
                }
                subNode.textContent = sub;
            }

            const search = document.getElementById('searchInput');
            if (search && search.value !== this.search) search.value = this.search;
        },

        /* ---------------------------------------------------------------
         * Chrome interactions
         * ------------------------------------------------------------- */
        bindChrome() {
            const self = this;

            const searchInput = document.getElementById('searchInput');
            const searchWrap = document.getElementById('searchWrap');
            const searchClear = document.getElementById('searchClear');

            const onSearch = U.debounce(function (value) {
                self.search = value;
                searchWrap.classList.toggle('has-value', !!value);
                self.render();
            }, 220);

            if (searchInput) {
                searchInput.addEventListener('input', function (event) {
                    onSearch(event.target.value);
                });
                searchInput.addEventListener('keydown', function (event) {
                    if (event.key === 'Escape') {
                        searchInput.value = '';
                        onSearch('');
                        searchInput.blur();
                    }
                });
            }
            if (searchClear) {
                searchClear.addEventListener('click', function () {
                    searchInput.value = '';
                    onSearch('');
                    searchInput.focus();
                });
            }

            const newButton = document.getElementById('newButton');
            if (newButton) {
                newButton.addEventListener('click', function (event) {
                    event.stopPropagation();
                    self.openCreateDialog();
                });
            }

            const syncTagsButton = document.getElementById('syncTagsButton');
            if (syncTagsButton) {
                syncTagsButton.addEventListener('click', function () {
                    HM.views.syncTags(self.ctx);
                });
            }

            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.addEventListener('click', function () {
                    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
                    document.documentElement.dataset.theme = next;
                    ui.toast('Theme', `Switched to ${next} mode for this session.`, 'info', 2200);
                });
            }

            const drawerBackdrop = document.getElementById('drawerBackdrop');
            if (drawerBackdrop) drawerBackdrop.addEventListener('click', function () { ui.closeDrawer(); });

            const modalBackdrop = document.getElementById('modalBackdrop');
            if (modalBackdrop) {
                modalBackdrop.addEventListener('click', function (event) {
                    if (event.target === modalBackdrop) ui.closeModal();
                });
            }
        },

        /**
         * "What do you want to create?" chooser.
         *
         * This was previously a floating dropdown whose position came from
         * getBoundingClientRect(); if that ever returned zeros the menu landed
         * off-screen and a click looked like it did nothing. A modal reuses the
         * same code path as every other dialog in the plugin, so it cannot fail
         * silently — and any error now surfaces as a toast.
         */
        openCreateDialog() {
            const self = this;
            const choices = [
                { icon: '🧾', title: 'Bill', hint: 'Electricity, gas, water, rent…', kind: 'bill' },
                { icon: '✅', title: 'Task', hint: 'Anything with a due date or reminder', kind: 'task' },
                { icon: '💧', title: 'Water meter', hint: 'Kitchen, bathroom, garden…', kind: 'meter' }
            ];

            const grid = U.el('div', { class: 'create-grid' });
            choices.forEach(function (choice) {
                grid.appendChild(U.el('button', {
                    class: 'create-card',
                    'data-autofocus': choice.kind === 'bill' ? 'true' : null,
                    onclick: function () {
                        ui.closeModal();
                        HM.views.openEditor(null, self.ctx, choice.kind);
                    }
                }, [
                    U.el('span', { class: 'create-icon', text: choice.icon }),
                    U.el('span', { class: 'create-title', text: choice.title }),
                    U.el('span', { class: 'create-hint', text: choice.hint })
                ]));
            });

            ui.openModal({
                title: 'Create new',
                narrow: true,
                body: [
                    grid,
                    U.el('p', {
                        class: 'hint',
                        style: { marginTop: '16px' },
                        text: 'Eagle items are attached from inside a record: open a task, bill or meter and use “+ From Eagle”. '
                            + 'Attached items get tagged in Eagle, so Home Manager reconnects them every time it loads.'
                    })
                ]
            });
        },

        bindKeyboard() {
            const self = this;
            document.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    if (ui.modalOpen()) { ui.closeModal(); return; }
                    if (ui.drawerIsOpen()) { ui.closeDrawer(); return; }
                }

                const target = event.target;
                const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
                    || target.tagName === 'SELECT' || target.isContentEditable);
                if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
                if (ui.modalOpen() || ui.drawerIsOpen()) return;

                if (event.key === '/') {
                    event.preventDefault();
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput) searchInput.focus();
                    return;
                }

                const key = event.key.toLowerCase();
                if (key === 'b') { event.preventDefault(); HM.views.openEditor(null, self.ctx, 'bill'); }
                else if (key === 't' || key === 'n') { event.preventDefault(); HM.views.openEditor(null, self.ctx, 'task'); }
                else if (key === 'w' || key === 'm') { event.preventDefault(); HM.views.openEditor(null, self.ctx, 'meter'); }
                else if (key === 'r') { event.preventDefault(); self.navigate('reminders'); }
                else if (key === 'd') { event.preventDefault(); self.navigate('dashboard'); }
            });
        },

        /* ---------------------------------------------------------------
         * Reminder engine
         * ------------------------------------------------------------- */
        startReminders() {
            const self = this;
            clearInterval(this._reminderTimer);
            this._reminderTimer = setInterval(function () { self.sweepReminders(false); }, REMINDER_INTERVAL_MS);
        },

        /**
         * Compute the "have we told the user about this yet" key.
         * Overdue items deliberately re-notify once per day so a missed bill
         * does not go quiet.
         */
        reminderKey(record) {
            const status = store().statusOf(record);
            if (status.key === 'overdue') {
                return `overdue|${U.todayISO()}|${store().dueDateOf(record)}`;
            }
            return store().notificationKey(record);
        },

        alreadyNotified(record) {
            return store().state.meta.notified[record.id] === this.reminderKey(record);
        },

        markNotified(record) {
            store().state.meta.notified[record.id] = this.reminderKey(record);
        },

        /**
         * Walk every open record and fire the ones whose reminder time has
         * passed. Returns the number of notifications sent.
         */
        sweepReminders(verbose) {
            const settings = store().state.settings;
            const now = new Date();
            this._lastReminderSweep = Date.now();

            const alerts = store().alerts({ now });
            let fired = 0;
            const firedRecords = [];
            const self = this;

            alerts.forEach(function (alert) {
                const record = alert.record;

                if (record.kind === 'bill' && !settings.notifyBills) return;
                if (record.kind === 'task' && !settings.notifyTasks) return;
                if (record.kind === 'meter' && !settings.notifyMeters) return;

                const reminderAt = store().reminderAt(record);
                if (!reminderAt || reminderAt > now) return;
                if (self.alreadyNotified(record)) return;

                self.markNotified(record);
                fired += 1;
                firedRecords.push(record);

                const isOverdue = alert.status.key === 'overdue';
                const title = isOverdue
                    ? (record.kind === 'bill' ? '⚠️ Bill overdue' : record.kind === 'meter' ? '⚠️ Water reading late' : '⚠️ Task overdue')
                    : (record.kind === 'bill' ? '🧾 Bill due soon' : record.kind === 'meter' ? '💧 Water reading due' : '⏰ Task reminder');

                const body = self.describeForNotification(record, alert);

                HM.bridge.notify(title, body, { duration: 8000 });
                ui.toast(title, body, isOverdue ? 'err' : 'warn', 7000);
            });

            if (fired) {
                store().save();
                this.renderChrome();
                if (verbose) HM.log.info(`Reminder sweep fired ${fired} notification(s).`);
            } else if (verbose) {
                HM.log.info('Reminder sweep: nothing due.');
            }
            return firedRecords.length;
        },

        describeForNotification(record, alert) {
            const currency = record.currency || store().state.settings.currency;
            if (record.kind === 'bill') {
                const amount = record.amount !== null && record.amount !== undefined
                    ? ` · ${U.fmtMoney(record.amount, currency)}` : '';
                return `${record.title}${amount} · ${alert.status.label} (due ${U.fmtDate(record.dueDate, 'medium')})`;
            }
            if (record.kind === 'meter') {
                const latest = store().latestReading(record);
                const last = latest && latest.value !== null ? ` · last ${U.fmtNumber(latest.value, 2)} ${record.unit}` : '';
                return `${record.room} meter${last} · ${alert.status.label} (next ${U.fmtDate(record.nextDue, 'medium')})`;
            }
            return `${record.title} · ${alert.status.label}${record.dueDate ? ` (due ${U.fmtDate(record.dueDate, 'medium')})` : ''}`;
        }
    };

    HM.app = app;

    /* ---------------------------------------------------------------------
     * Surface errors instead of failing silently.
     *
     * Without this, an exception inside a click handler looks to the user like
     * a button that simply does nothing. Now every uncaught error and rejected
     * promise produces a toast and lands in Eagle's log.
     * ------------------------------------------------------------------- */
    let errorToastShown = 0;

    /**
     * Eagle's own preload rejects with this exact string (a plain string, which
     * is why it carries no stack) whenever a renderer→renderer call is made
     * before the plugin's window id exists:
     *
     *   ipcRenderer.r2r = async (id, channel, data) => … if (id === undefined) reject('This method…')
     *
     * Those rejections can come from Eagle's own internals, not from our calls.
     * While our API is not yet usable they are expected and harmless, so they are
     * recorded rather than reported as failures.
     */
    function isHostNotReadyError(message) {
        return /plugin-create` event is triggered/.test(String(message || ''));
    }

    function reportError(kind, message, stack) {
        HM.log.error(`[${kind}]`, message, stack || '');
        HM.diag.write(kind, message, stack || '(no stack)');
        errorToastShown += 1;
        const where = stack ? ` — ${String(stack).split('\n')[0].trim()}` : '';
        const detail = `${message}${where}`
            + (errorToastShown > 1 ? ` (${errorToastShown} errors — see Eagle's log)` : '');
        try {
            // The version is in the title so a screenshot of the toast alone
            // tells you which build produced it.
            ui.toast(`Something went wrong (v${app.version()})`, String(detail).slice(0, 320), 'err', 12000);
        } catch (_) { /* the UI itself may be broken */ }
    }

    /** Log + optionally toast, depending on whether this is ours to fix. */
    function handleFailure(kind, message, stack) {
        const text = String(message === undefined || message === null ? '' : message);
        if (isHostNotReadyError(text) && !HM.bridge.isAvailable()) {
            HM.log.warn('Eagle rejected a call before the plugin was ready (expected host noise):', text);
            HM.diag.write('host-not-ready', text, stack || '(plain-string rejection, no stack)');
            return;
        }
        reportError(kind, text || 'Unknown error', stack);
    }

    global.addEventListener('error', function (event) {
        if (event && event.message && /ResizeObserver/.test(event.message)) return;   // noise
        handleFailure('error', (event && event.message) || 'Unknown error',
            `${(event && event.filename) || '?'}:${(event && event.lineno) || '?'}`);
    });

    global.addEventListener('unhandledrejection', function (event) {
        const reason = event && event.reason;
        const message = (reason && reason.message) || String(reason);
        handleFailure('promise', message, reason && reason.stack);
    });

    /* ---------------------------------------------------------------------
     * Kick everything off once the DOM is ready.
     * ------------------------------------------------------------------- */
    function boot() {
        app.init().catch(function (err) {
            HM.log.error('init failed', err);
            const content = document.getElementById('content');
            if (content) {
                content.innerHTML = '';
                content.appendChild(ui.emptyState(
                    '💥', 'Home Manager could not start',
                    (err && err.message) || 'Unknown error while starting up.',
                    U.el('button', {
                        class: 'btn', text: 'Reload window',
                        onclick: function () { global.location.reload(); }
                    })
                ));
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window);
