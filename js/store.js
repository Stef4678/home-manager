/* =========================================================================
 * Home Manager — store.js
 * The single source of truth: data model, persistence, recurrence rules and
 * everything derived from them (statuses, alerts, totals).
 *
 * Persistence strategy
 *  1. <Eagle userData>/plugin-data/todo-bills-manager/data.json   (preferred)
 *  2. localStorage                                                (fallback)
 *  3. in-memory only                                              (last resort)
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});
    const U = HM.util;

    const DATA_FILE = 'data.json';
    const DATA_DIR = 'todo-bills-manager';
    const SCHEMA_VERSION = 1;

    /* =====================================================================
     * Definitions
     * =================================================================== */

    const BILL_CATEGORIES = [
        { id: 'electricity', label: 'Electricity', icon: '⚡', color: '#f5b53d' },
        { id: 'gas', label: 'Gas', icon: '🔥', color: '#ef7d4e' },
        { id: 'water', label: 'Water', icon: '🚰', color: '#3fb6f0' },
        { id: 'heating', label: 'Heating', icon: '♨️', color: '#e0645f' },
        { id: 'internet', label: 'Internet / Phone', icon: '📶', color: '#7d8cf5' },
        { id: 'rent', label: 'Rent / Mortgage', icon: '🏠', color: '#9b7ef0' },
        { id: 'insurance', label: 'Insurance', icon: '🛡️', color: '#4cc0a5' },
        { id: 'waste', label: 'Waste / Recycling', icon: '♻️', color: '#5fbf6b' },
        { id: 'tax', label: 'Taxes / Fees', icon: '🏛️', color: '#b98cd8' },
        { id: 'other', label: 'Other', icon: '🧾', color: '#8b97a8' }
    ];

    const REPEATS = [
        { id: 'none', label: 'Does not repeat', months: 0 },
        { id: 'weekly', label: 'Every week', days: 7 },
        { id: 'biweekly', label: 'Every 2 weeks', days: 14 },
        { id: 'monthly', label: 'Every month', months: 1 },
        { id: 'bimonthly', label: 'Every 2 months', months: 2 },
        { id: 'quarterly', label: 'Every 3 months', months: 3 },
        { id: 'semiannual', label: 'Every 6 months', months: 6 },
        { id: 'yearly', label: 'Every year', months: 12 }
    ];

    const PRIORITIES = [
        { id: 'low', label: 'Low', color: '#6b7a8d' },
        { id: 'normal', label: 'Normal', color: '#5b8def' },
        { id: 'high', label: 'High', color: '#f0a63d' },
        { id: 'urgent', label: 'Urgent', color: '#ef5f5f' }
    ];

    /** Recurrence presets that make sense for a water-meter reading cycle. */
    const READING_CYCLES = [
        { id: 'monthly', label: 'Monthly (every month)', months: 1 },
        { id: 'bimonthly', label: 'Every 2 months', months: 2 },
        { id: 'quarterly', label: 'Every 3 months', months: 3 },
        { id: 'semiannual', label: 'Every 6 months', months: 6 },
        { id: 'yearly', label: 'Once a year', months: 12 },
        { id: 'custom', label: 'Custom interval…', months: 0 }
    ];

    function category(id) {
        return BILL_CATEGORIES.find(function (c) { return c.id === id; }) || BILL_CATEGORIES[BILL_CATEGORIES.length - 1];
    }

    function repeat(id) {
        return REPEATS.find(function (r) { return r.id === id; }) || REPEATS[0];
    }

    function priority(id) {
        return PRIORITIES.find(function (p) { return p.id === id; }) || PRIORITIES[1];
    }

    /* =====================================================================
     * Default state / seeds
     * =================================================================== */

    function defaultSettings() {
        return {
            currency: '€',
            remindDaysBefore: 3,
            remindTime: '09:00',
            notifyBills: true,
            notifyTasks: true,
            notifyMeters: true,
            markPaidRollsForward: true,
            syncTagsOnLoad: true,
            sound: false
        };
    }

    function blankState() {
        return {
            version: SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            settings: defaultSettings(),
            items: [],
            meters: [],
            // tagSeq allocates the short codes behind the Eagle tags (hm:t1, hm:b2 …)
            meta: { seeded: false, notified: {}, lastDigest: '', tagSeq: 0 }
        };
    }

    function newBill(patch) {
        const now = new Date().toISOString();
        return Object.assign({
            id: U.uid('bill'),
            kind: 'bill',
            title: '',
            category: 'electricity',
            provider: '',
            accountNumber: '',
            amount: null,
            currency: '',
            consumption: null,
            consumptionUnit: '',
            dueDate: U.todayISO(),
            remindDaysBefore: null,   // null = use global default
            remindAt: '',
            repeat: 'monthly',
            autoRoll: true,
            paid: false,
            paidAt: null,
            notes: '',
            priority: 'normal',
            payments: [],
            attachments: [],
            // tagCode ties this record to its Eagle tag (hm:b7). Allocated on
            // first attachment; 0 means "no tag yet".
            tagCode: 0,
            createdAt: now,
            updatedAt: now
        }, patch || {});
    }

    function newTask(patch) {
        const now = new Date().toISOString();
        return Object.assign({
            id: U.uid('task'),
            kind: 'task',
            title: '',
            notes: '',
            category: 'home',
            dueDate: '',
            dueTime: '',
            remindAt: '',
            remindDaysBefore: null,
            repeat: 'none',
            priority: 'normal',
            done: false,
            doneAt: null,
            completions: [],
            checklist: [],
            attachments: [],
            tagCode: 0,
            createdAt: now,
            updatedAt: now
        }, patch || {});
    }

    function newMeter(patch) {
        const now = new Date().toISOString();
        return Object.assign({
            id: U.uid('meter'),
            kind: 'meter',
            room: 'Kitchen',
            icon: '💧',
            unit: 'm³',
            nextDue: U.addDays(U.todayISO(), 30),
            cycle: 'monthly',
            customCycleDays: null,
            remindDaysBefore: null,
            remindAt: '',
            notes: '',
            readings: [],
            attachments: [],
            tagCode: 0,
            createdAt: now,
            updatedAt: now
        }, patch || {});
    }

    function newReading(patch) {
        return Object.assign({
            id: U.uid('read'),
            date: U.todayISO(),
            value: null,
            note: '',
            attachments: [],
            createdAt: new Date().toISOString()
        }, patch || {});
    }

    /**
     * First-run content: the recurring household costs most people track, plus
     * two water meters and a couple of starter tasks. Everything is editable
     * and deletable — it exists so the plugin is useful the moment it opens.
     */
    function seedState(state) {
        const today = U.todayISO();

        state.items.push(newBill({
            title: 'Electricity bill',
            category: 'electricity',
            provider: 'Power company',
            amount: 78,
            consumption: null,
            consumptionUnit: 'kWh',
            dueDate: U.addDays(today, 12),
            repeat: 'monthly',
            notes: 'Meter reading is taken a few days before the due date.'
        }));

        state.items.push(newBill({
            title: 'Gas bill',
            category: 'gas',
            provider: 'Gas supplier',
            amount: 42,
            consumption: null,
            consumptionUnit: 'm³',
            dueDate: U.addDays(today, 19),
            repeat: 'bimonthly',
            notes: ''
        }));

        state.meters.push(newMeter({
            room: 'Kitchen',
            icon: '💧',
            unit: 'm³',
            nextDue: U.addDays(today, 28),
            cycle: 'monthly',
            notes: 'Read the black digits only; ignore the red decimals.'
        }));

        state.meters.push(newMeter({
            room: 'Bathroom',
            icon: '💧',
            unit: 'm³',
            nextDue: U.addDays(today, 28),
            cycle: 'monthly',
            notes: ''
        }));

        state.items.push(newTask({
            title: 'Replace the water filter',
            category: 'maintenance',
            dueDate: U.addDays(today, 9),
            repeat: 'semiannual',
            priority: 'normal'
        }));

        state.items.push(newTask({
            title: 'Test the smoke detectors',
            category: 'safety',
            dueDate: U.addDays(today, 4),
            repeat: 'semiannual',
            priority: 'high'
        }));

        state.meta.seeded = true;
        return state;
    }

    /* =====================================================================
     * Store
     * =================================================================== */

    const store = {
        state: blankState(),
        backend: 'memory',
        dataPath: '',
        _saveTimer: null,
        _fs: null,
        _path: null,

        /* ---------------------------------------------------------------
         * Persistence
         * ------------------------------------------------------------- */
        _resolveFs: function () {
            if (this._fs) return true;
            try {
                // Node is available inside Eagle plugin windows.
                this._fs = require('fs');
                this._path = require('path');
                return true;
            } catch (err) {
                HM.log && HM.log.warn('fs unavailable, falling back to localStorage:', err && err.message);
                return false;
            }
        },

        _resolveDataPath: function () {
            let base = '';
            try {
                const eagle = global.eagle;
                // `userDataPath` is a plain property; getPath() is the fallback
                // but it is a *method* and returns a Promise, so both the call
                // and its result are treated defensively.
                if (eagle && eagle.app) {
                    if (typeof eagle.app.userDataPath === 'string' && eagle.app.userDataPath) {
                        base = eagle.app.userDataPath;
                    } else if (typeof eagle.app.getPath === 'function') {
                        const resolved = eagle.app.getPath('userData');
                        if (typeof resolved === 'string') base = resolved;
                    }
                }
            } catch (err) {
                HM.log && HM.log.warn('could not read the Eagle user-data path:', err && err.message);
            }

            if (typeof base !== 'string' || !base) return '';
            try {
                return this._path.join(base, 'plugin-data', DATA_DIR, DATA_FILE);
            } catch (err) {
                HM.log && HM.log.warn('could not build the data file path:', err && err.message);
                return '';
            }
        },

        /**
         * Move storage onto disk once Eagle is ready.
         *
         * The data path comes from `eagle.app.userDataPath`, and Eagle refuses
         * API access until the plugin is created — so a path resolved during
         * start-up is often empty and the plugin silently falls back to
         * localStorage. This re-resolves it after readiness and migrates.
         *
         * @returns {Promise<'migrated'|'loaded'|'none'>}
         */
        async upgradeBackend() {
            if (!this._resolveFs()) return 'none';
            if (this.backend === 'file' && this.dataPath) return 'none';

            const path = this._resolveDataPath();
            if (!path) return 'none';

            const isNewFile = !this._fs.existsSync(path);
            this.dataPath = path;
            if (window.HM && window.HM.diag) window.HM.diag.init(path);

            if (isNewFile) {
                // Nothing on disk yet: migrate whatever we loaded from
                // localStorage so the user does not lose their records.
                this.backend = 'file';
                await this.save();
                HM.log.info('storage upgraded to a file:', path);
                if (window.HM && window.HM.diag) {
                    window.HM.diag.write('storage', 'migrated to file', `${path} records=${this.state.items.length + this.state.meters.length}`);
                }
                return 'migrated';
            }

            try {
                const raw = this._fs.readFileSync(path, 'utf8');
                const parsed = JSON.parse(raw);
                const mine = this.state.items.length + this.state.meters.length;
                const theirs = (parsed.items || []).length + (parsed.meters || []).length;

                // A fresh seed must never overwrite a real data file, no matter
                // how the record counts compare.
                const cameFrom = this.loadedFrom;
                const prefersFile = cameFrom === 'seed' ? theirs > 0 : theirs >= mine;

                if (prefersFile) {
                    this.state = this._migrate(parsed);
                    this.backend = 'file';
                    this.loadedFrom = 'file';
                    HM.log.info('loaded data file:', path);
                    if (window.HM && window.HM.diag) {
                        window.HM.diag.write('storage', 'loaded file', `${path} records=${theirs} (memory had ${mine} from ${cameFrom})`);
                    }
                    return 'loaded';
                }

                // Our in-memory state is richer; keep it and rewrite the file.
                this.backend = 'file';
                await this.save();
                HM.log.info('kept in-memory state and wrote it to:', path);
                if (window.HM && window.HM.diag) window.HM.diag.write('storage', 'kept memory, wrote file', `${path} records=${mine} vs file ${theirs}`);
                return 'migrated';
            } catch (err) {
                HM.log.warn('could not adopt the data file:', err && err.message);
                this.backend = 'file';
                await this.save();
                return 'migrated';
            }
        },

        async init() {
            let loaded = null;
            this.loadedFrom = 'seed';

            if (this._resolveFs()) {
                this.dataPath = this._resolveDataPath();
                if (window.HM && window.HM.diag) window.HM.diag.init(this.dataPath);
                if (this.dataPath) {
                    try {
                        if (this._fs.existsSync(this.dataPath)) {
                            const raw = this._fs.readFileSync(this.dataPath, 'utf8');
                            loaded = JSON.parse(raw);
                            this.backend = 'file';
                        } else {
                            this.backend = 'file';
                        }
                    } catch (err) {
                        HM.log && HM.log.warn('Could not read data file, trying localStorage:', err && err.message);
                    }
                }
            }

            if (!loaded) {
                try {
                    const raw = global.localStorage.getItem('hm.todo.data');
                    if (raw) { loaded = JSON.parse(raw); this.backend = 'localStorage'; }
                } catch (_) { /* ignore */ }
            }

            // Remember where the data came from. If it is only a fresh seed, an
            // existing data file must always win in upgradeBackend() — otherwise
            // a first run could overwrite real records with the example data.
            this.loadedFrom = loaded ? (this.backend === 'file' ? 'file' : 'localStorage') : 'seed';

            this.state = this._migrate(loaded || blankState());

            if (!this.state.meta.seeded && this.state.items.length === 0 && this.state.meters.length === 0) {
                seedState(this.state);
                await this.save();
            }
            return this.state;
        },

        _migrate: function (raw) {
            const base = blankState();
            const state = Object.assign(base, raw || {});
            state.settings = Object.assign(defaultSettings(), raw && raw.settings ? raw.settings : {});
            state.meta = Object.assign({ seeded: false, notified: {}, lastDigest: '', tagSeq: 0 }, raw && raw.meta ? raw.meta : {});
            state.items = Array.isArray(state.items) ? state.items : [];
            state.meters = Array.isArray(state.meters) ? state.meters : [];
            state.version = SCHEMA_VERSION;

            // Backfill fields added after a data file was first written.
            state.items = state.items.map(function (item) {
                const filled = item.kind === 'bill' ? newBill(item) : newTask(item);
                filled.attachments = Array.isArray(filled.attachments) ? filled.attachments : [];
                filled.payments = Array.isArray(filled.payments) ? filled.payments : [];
                filled.completions = Array.isArray(filled.completions) ? filled.completions : [];
                filled.checklist = Array.isArray(filled.checklist) ? filled.checklist : [];
                return filled;
            });
            state.meters = state.meters.map(function (meter) {
                const filled = newMeter(meter);
                filled.readings = (Array.isArray(filled.readings) ? filled.readings : []).map(function (r) {
                    return Object.assign(newReading(r), r, {
                        attachments: Array.isArray(r.attachments) ? r.attachments : []
                    });
                });
                filled.attachments = Array.isArray(filled.attachments) ? filled.attachments : [];
                return filled;
            });
            return state;
        },

        async save() {
            const json = JSON.stringify(this.state, null, 2);
            let wrote = false;

            if (this.backend === 'file' && this.dataPath && this._fs) {
                try {
                    const dir = this._path.dirname(this.dataPath);
                    if (!this._fs.existsSync(dir)) this._fs.mkdirSync(dir, { recursive: true });
                    const tmp = `${this.dataPath}.tmp`;
                    this._fs.writeFileSync(tmp, json, 'utf8');
                    this._fs.renameSync(tmp, this.dataPath);
                    wrote = true;
                } catch (err) {
                    HM.log && HM.log.warn('Data file write failed:', err && err.message);
                }
            }

            if (!wrote) {
                try {
                    global.localStorage.setItem('hm.todo.data', json);
                    this.backend = 'localStorage';
                    wrote = true;
                } catch (err) {
                    HM.log && HM.log.warn('localStorage write failed:', err && err.message);
                }
            }

            if (!wrote) this.backend = 'memory';
            return wrote;
        },

        /** Coalesce bursts of edits (typing in a form) into one disk write. */
        saveSoon() {
            clearTimeout(this._saveTimer);
            const self = this;
            this._saveTimer = setTimeout(function () { self.save(); }, 350);
        },

        /* ---------------------------------------------------------------
         * Reading data
         * ------------------------------------------------------------- */
        bills() { return this.state.items.filter(function (i) { return i.kind === 'bill'; }); },
        tasks() { return this.state.items.filter(function (i) { return i.kind === 'task'; }); },
        meters() { return this.state.meters; },

        get(id) {
            return this.state.items.find(function (i) { return i.id === id; })
                || this.state.meters.find(function (m) { return m.id === id; })
                || null;
        },

        getBill(id) { return this.state.items.find(function (i) { return i.id === id && i.kind === 'bill'; }) || null; },
        getTask(id) { return this.state.items.find(function (i) { return i.id === id && i.kind === 'task'; }) || null; },
        getMeter(id) { return this.state.meters.find(function (m) { return m.id === id; }) || null; },

        /** Every attachment across every record, for the "attached items" browser. */
        allAttachments() {
            const out = [];
            const push = function (owner, ownerLabel, list) {
                (list || []).forEach(function (att) {
                    out.push(Object.assign({}, att, { ownerId: owner.id, ownerLabel: ownerLabel, ownerKind: owner.kind }));
                });
            };
            this.state.items.forEach(function (item) {
                push(item, item.title || 'Untitled', item.attachments);
            });
            this.state.meters.forEach(function (meter) {
                push(meter, `${meter.room} meter`, meter.attachments);
                meter.readings.forEach(function (reading) {
                    push({ id: meter.id + '/' + reading.id, kind: 'reading' },
                        `${meter.room} · ${U.fmtDate(reading.date)}`, reading.attachments);
                });
            });
            return out;
        },

        /* ---------------------------------------------------------------
         * Mutations
         * ------------------------------------------------------------- */
        add(draft) {
            const record = draft.kind === 'bill' ? newBill(draft)
                : draft.kind === 'meter' ? newMeter(draft)
                    : newTask(draft);
            if (record.kind === 'meter') this.state.meters.push(record);
            else this.state.items.push(record);
            this.saveSoon();
            return record;
        },

        update(id, patch) {
            const record = this.get(id);
            if (!record) return null;
            Object.assign(record, patch, { updatedAt: new Date().toISOString() });
            this.saveSoon();
            return record;
        },

        remove(id) {
            const before = this.state.items.length + this.state.meters.length;
            this.state.items = this.state.items.filter(function (i) { return i.id !== id; });
            this.state.meters = this.state.meters.filter(function (m) { return m.id !== id; });
            const after = this.state.items.length + this.state.meters.length;
            if (after !== before) { this.saveSoon(); return true; }
            return false;
        },

        /* ---------------------------------------------------------------
         * Bills
         * ------------------------------------------------------------- */
        /**
         * Advance a due date by one recurrence interval.
         * Returns '' when the item does not repeat.
         */
        nextDueDate(fromISO, repeatId) {
            const rule = repeat(repeatId);
            if (!rule || rule.id === 'none') return '';
            const base = fromISO || U.todayISO();
            if (rule.days) return U.addDays(base, rule.days);
            return U.addMonths(base, rule.months);
        },

        /**
         * Mark a bill paid.
         *  - always appends to `payments` (the payment history)
         *  - when the bill repeats and settings.markPaidRollsForward is on, the
         *    due date rolls to the next period so it is ready for next time
         *  - otherwise the bill simply stays flagged as paid
         */
        markPaid(id, opts) {
            const bill = this.getBill(id);
            if (!bill) return null;
            const options = opts || {};
            const now = new Date().toISOString();
            const rolls = options.rollForward !== undefined
                ? options.rollForward
                : (bill.repeat !== 'none' && bill.autoRoll && this.state.settings.markPaidRollsForward);

            bill.payments = bill.payments || [];
            bill.payments.unshift({
                id: U.uid('pay'),
                paidAt: options.paidAt || now,
                amount: options.amount !== undefined && options.amount !== null ? U.num(options.amount) : bill.amount,
                forDueDate: bill.dueDate,
                note: options.note || ''
            });

            if (rolls) {
                const next = this.nextDueDate(bill.dueDate, bill.repeat);
                // Guard against rolling into the past if a bill was paid late
                // several periods in a row: keep advancing until it is future.
                let candidate = next;
                let guard = 0;
                while (candidate && U.daysUntil(candidate) < 0 && guard < 240) {
                    candidate = this.nextDueDate(candidate, bill.repeat);
                    guard += 1;
                }
                bill.dueDate = candidate || next || bill.dueDate;
                bill.paid = false;
                bill.paidAt = null;
                clearNotification(bill.id);
            } else {
                bill.paid = true;
                bill.paidAt = options.paidAt || now;
                clearNotification(bill.id);
            }

            bill.updatedAt = now;
            this.saveSoon();
            return bill;
        },

        /** Undo "paid": clears the flag and pops the newest payment entry. */
        markUnpaid(id, opts) {
            const bill = this.getBill(id);
            if (!bill) return null;
            const options = opts || {};
            if (bill.paid) {
                bill.paid = false;
                bill.paidAt = null;
            } else if (bill.payments && bill.payments.length && options.dropLastPayment) {
                const last = bill.payments.shift();
                if (last && last.forDueDate) bill.dueDate = last.forDueDate;
            }
            bill.updatedAt = new Date().toISOString();
            this.saveSoon();
            return bill;
        },

        /* ---------------------------------------------------------------
         * Tasks
         * ------------------------------------------------------------- */
        toggleTask(id) {
            const task = this.getTask(id);
            if (!task) return null;
            const now = new Date().toISOString();

            if (!task.done) {
                task.completions = task.completions || [];
                task.completions.unshift(now);
                if (task.repeat && task.repeat !== 'none' && task.dueDate) {
                    // Recurring chores stay open and jump to the next occurrence.
                    let next = this.nextDueDate(task.dueDate, task.repeat);
                    let guard = 0;
                    while (next && U.daysUntil(next) < 0 && guard < 240) {
                        next = this.nextDueDate(next, task.repeat);
                        guard += 1;
                    }
                    task.dueDate = next || task.dueDate;
                    task.done = false;
                    task.doneAt = null;
                    task.remindAt = '';
                } else {
                    task.done = true;
                    task.doneAt = now;
                }
                clearNotification(task.id);
            } else {
                task.done = false;
                task.doneAt = null;
                if (task.completions.length) task.completions.shift();
            }

            task.updatedAt = now;
            this.saveSoon();
            return task;
        },

        /* ---------------------------------------------------------------
         * Water meters
         * ------------------------------------------------------------- */
        addReading(meterId, reading) {
            const meter = this.getMeter(meterId);
            if (!meter) return null;
            const record = newReading(reading);
            meter.readings.push(record);
            this.sortReadings(meter);
            this.rollMeterDue(meter);
            meter.updatedAt = new Date().toISOString();
            this.saveSoon();
            return record;
        },

        updateReading(meterId, readingId, patch) {
            const meter = this.getMeter(meterId);
            if (!meter) return null;
            const reading = meter.readings.find(function (r) { return r.id === readingId; });
            if (!reading) return null;
            Object.assign(reading, patch);
            this.sortReadings(meter);
            this.rollMeterDue(meter);
            meter.updatedAt = new Date().toISOString();
            this.saveSoon();
            return reading;
        },

        removeReading(meterId, readingId) {
            const meter = this.getMeter(meterId);
            if (!meter) return false;
            const before = meter.readings.length;
            meter.readings = meter.readings.filter(function (r) { return r.id !== readingId; });
            if (meter.readings.length === before) return false;
            this.rollMeterDue(meter);
            meter.updatedAt = new Date().toISOString();
            this.saveSoon();
            return true;
        },

        sortReadings(meter) {
            meter.readings.sort(function (a, b) {
                const da = U.parseDate(a.date);
                const db = U.parseDate(b.date);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });
        },

        /** Consumption = this reading minus the previous one (never negative). */
        consumption(meter, index) {
            const readings = meter.readings;
            if (!readings || index <= 0 || index >= readings.length) return null;
            const prev = U.num(readings[index - 1].value);
            const curr = U.num(readings[index].value);
            if (prev === null || curr === null) return null;
            const diff = curr - prev;
            return diff < 0 ? null : diff;   // a negative diff means the meter was replaced/reset
        },

        /** Latest reading entry with its computed consumption. */
        latestReading(meter) {
            if (!meter.readings.length) return null;
            const index = meter.readings.length - 1;
            const reading = meter.readings[index];
            return {
                reading,
                index,
                value: U.num(reading.value),
                consumption: this.consumption(meter, index),
                previous: index > 0 ? U.num(meter.readings[index - 1].value) : null,
                previousDate: index > 0 ? meter.readings[index - 1].date : null
            };
        },

        /** After logging a reading, push the next reading date forward. */
        rollMeterDue(meter) {
            const latest = meter.readings.length ? meter.readings[meter.readings.length - 1] : null;
            const base = latest ? latest.date : U.todayISO();
            let next = '';
            if (meter.cycle === 'custom') {
                next = U.addDays(base, meter.customCycleDays || 30);
            } else {
                next = this.nextDueDate(base, meter.cycle) || U.addDays(base, 30);
            }
            if (next) meter.nextDue = next;
            clearNotification(meter.id);
        },

        /** Average consumption per day between the two most recent readings. */
        meterRate(meter) {
            const n = meter.readings.length;
            if (n < 2) return null;
            const prev = meter.readings[n - 2];
            const curr = meter.readings[n - 1];
            const consumption = this.consumption(meter, n - 1);
            if (consumption === null) return null;
            const days = U.daysBetween(prev.date, curr.date);
            if (!days || days <= 0) return null;
            return { perDay: consumption / days, days, consumption };
        },

        /* ---------------------------------------------------------------
         * Attachments
         * ------------------------------------------------------------- */
        /**
         * Attach one or more Eagle image items to a record.
         * `target` is a record (bill/task/meter) or { meter, reading }.
         */
        addAttachments(target, refs) {
            if (!target || !refs || !refs.length) return;
            target.attachments = target.attachments || [];
            const existing = new Set(target.attachments.map(function (a) { return a.itemId; }));
            refs.forEach(function (ref) {
                if (!ref || !ref.itemId || existing.has(ref.itemId)) return;
                existing.add(ref.itemId);
                target.attachments.push({
                    itemId: ref.itemId,
                    name: ref.name || 'Eagle item',
                    ext: ref.ext || '',
                    width: ref.width || null,
                    height: ref.height || null,
                    size: ref.size || null,
                    libraryPath: ref.libraryPath || '',
                    // `tag` is the identity tag written onto the Eagle item;
                    // `tagged` is null until we know whether that write worked.
                    // Both must survive this normalisation.
                    tag: ref.tag || '',
                    tagged: ref.tagged === undefined ? null : ref.tagged,
                    addedAt: new Date().toISOString()
                });
            });
            if (target.updatedAt !== undefined) target.updatedAt = new Date().toISOString();
            this.saveSoon();
        },

        removeAttachment(owner, itemId, readingId) {
            const target = readingId
                ? (function () {
                    const meter = store.getMeter(owner);
                    if (!meter) return null;
                    return meter.readings.find(function (r) { return r.id === readingId; }) || null;
                })()
                : this.get(owner);
            if (!target || !target.attachments) return false;
            const before = target.attachments.length;
            target.attachments = target.attachments.filter(function (a) { return a.itemId !== itemId; });
            if (target.attachments.length === before) return false;
            this.saveSoon();
            return true;
        },

        /* ---------------------------------------------------------------
         * Derived: statuses, alerts, reminders
         * ------------------------------------------------------------- */
        remindLead(item) {
            const value = item && item.remindDaysBefore;
            return (value === null || value === undefined || value === '')
                ? this.state.settings.remindDaysBefore
                : Number(value);
        },

        /** The effective due date across every record kind. */
        dueDateOf(record) {
            if (!record) return '';
            return record.kind === 'meter' ? (record.nextDue || '') : (record.dueDate || '');
        },

        /**
         * Status of a bill: paid / overdue / today / soon / upcoming.
         * `soon` uses the record's own reminder lead time.
         */
        billStatus(bill) {
            if (bill.paid) return { key: 'paid', label: 'Paid', tone: 'paid', days: null };
            const days = U.daysUntil(bill.dueDate);
            if (days === null) return { key: 'nodate', label: 'No due date', tone: 'none', days: null };
            const lead = this.remindLead(bill);
            if (days < 0) return { key: 'overdue', label: `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`, tone: 'overdue', days };
            if (days === 0) return { key: 'today', label: 'Due today', tone: 'today', days };
            if (days <= lead) return { key: 'soon', label: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'soon', days };
            if (days <= 31) return { key: 'upcoming', label: `Due in ${days} days`, tone: 'upcoming', days };
            return { key: 'later', label: U.fmtDate(bill.dueDate, 'medium'), tone: 'later', days };
        },

        taskStatus(task) {
            if (task.done) return { key: 'done', label: 'Done', tone: 'paid', days: null };
            const days = U.daysUntil(task.dueDate);
            if (days === null || task.dueDate === '') return { key: 'nodate', label: 'No due date', tone: 'none', days: null };
            const lead = this.remindLead(task);
            if (days < 0) return { key: 'overdue', label: `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`, tone: 'overdue', days };
            if (days === 0) return { key: 'today', label: 'Today', tone: 'today', days };
            if (days <= lead) return { key: 'soon', label: `In ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'soon', days };
            if (days <= 31) return { key: 'upcoming', label: `In ${days} days`, tone: 'upcoming', days };
            return { key: 'later', label: U.fmtDate(task.dueDate, 'medium'), tone: 'later', days };
        },

        meterStatus(meter) {
            const days = U.daysUntil(meter.nextDue);
            const lead = this.remindLead(meter);
            if (days === null) return { key: 'nodate', label: 'No next date', tone: 'none', days: null };
            if (days < 0) return { key: 'overdue', label: `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} late`, tone: 'overdue', days };
            if (days === 0) return { key: 'today', label: 'Read today', tone: 'today', days };
            if (days <= lead) return { key: 'soon', label: `Read in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'soon', days };
            if (days <= 31) return { key: 'upcoming', label: `Read in ${days} days`, tone: 'upcoming', days };
            return { key: 'later', label: U.fmtDate(meter.nextDue, 'medium'), tone: 'later', days };
        },

        statusOf(record) {
            if (record.kind === 'bill') return this.billStatus(record);
            if (record.kind === 'meter') return this.meterStatus(record);
            return this.taskStatus(record);
        },

        /** When a reminder should fire for this record (Date or null). */
        reminderAt(record) {
            if (!record) return null;
            if (record.remindAt) {
                const explicit = U.parseDateTime(record.remindAt);
                if (explicit) return explicit;
            }
            const due = this.dueDateOf(record);
            if (!due) return null;
            const time = String(this.state.settings.remindTime || '09:00').split(':');
            const fireDate = U.addDays(due, -this.remindLead(record));
            return U.parseDateTime(`${fireDate}T${U.pad2(Number(time[0]) || 9)}:${U.pad2(Number(time[1]) || 0)}`);
        },

        /**
         * Everything that wants attention, most urgent first.
         * Each entry: { record, kind, status, reminderAt, due, overdue, tone }
         */
        alerts(opts) {
            const options = opts || {};
            const out = [];
            const now = options.now || new Date();

            const consider = function (record, kind) {
                const status = store.statusOf(record);
                if (status.key === 'paid' || status.key === 'done') return;
                if (status.key === 'nodate') return;
                const reminderAt = store.reminderAt(record);
                const due = store.dueDateOf(record);
                const order = { overdue: 0, today: 1, soon: 2, upcoming: 3, later: 4, none: 5, paid: 6, done: 6 };
                out.push({
                    record,
                    kind,
                    status,
                    due,
                    reminderAt,
                    reminderDue: !!(reminderAt && reminderAt <= now),
                    order: order[status.key] === undefined ? 9 : order[status.key]
                });
            };

            this.bills().forEach(function (b) { consider(b, 'bill'); });
            this.tasks().forEach(function (t) { consider(t, 'task'); });
            this.meters().forEach(function (m) { consider(m, 'meter'); });

            out.sort(function (a, b) {
                if (a.order !== b.order) return a.order - b.order;
                return (U.parseDate(a.due) || 0) - (U.parseDate(b.due) || 0);
            });

            if (options.dueWithinDays !== undefined) {
                const limit = options.dueWithinDays;
                return out.filter(function (a) {
                    const days = U.daysUntil(a.due);
                    return days !== null && days <= limit;
                });
            }
            return out;
        },

        /** Dashboard roll-up numbers. */
        summary(now) {
            const today = U.todayISO();
            const alerts = this.alerts({ now });
            const openBills = this.bills().filter(function (b) { return !b.paid; });
            const overdue = alerts.filter(function (a) { return a.status.key === 'overdue'; });
            const dueThisWeek = alerts.filter(function (a) {
                const d = U.daysUntil(a.due);
                return d !== null && d >= 0 && d <= 7;
            });
            const monthPrefix = today.slice(0, 7);

            const paidThisMonth = [];
            this.bills().forEach(function (bill) {
                (bill.payments || []).forEach(function (payment) {
                    // Compare on the local calendar month, not the UTC one.
                    if (U.localDateOf(payment.paidAt).slice(0, 7) === monthPrefix) paidThisMonth.push(payment);
                });
            });

            const openTasks = this.tasks().filter(function (t) { return !t.done; });
            const meterAttention = this.meters().filter(function (m) {
                const s = store.meterStatus(m);
                return s.key === 'overdue' || s.key === 'today' || s.key === 'soon';
            });

            return {
                alerts,
                overdueCount: overdue.length,
                dueThisWeekCount: dueThisWeek.length,
                openBillCount: openBills.length,
                openBillsTotal: U.sum(openBills, function (b) { return b.amount; }),
                paidThisMonthTotal: U.sum(paidThisMonth, function (p) { return p.amount; }),
                paidThisMonthCount: paidThisMonth.length,
                openTaskCount: openTasks.length,
                tasksDueToday: openTasks.filter(function (t) { return U.daysUntil(t.dueDate) === 0; }).length,
                overdueTasks: openTasks.filter(function (t) { const d = U.daysUntil(t.dueDate); return d !== null && d < 0; }).length,
                meterAttention,
                nextMeter: this.meters().slice().sort(function (a, b) {
                    return (U.parseDate(a.nextDue) || 0) - (U.parseDate(b.nextDue) || 0);
                })[0] || null
            };
        },

        /* ---------------------------------------------------------------
         * Notification bookkeeping (so a reminder fires once per occurrence)
         * ------------------------------------------------------------- */
        notificationKey(record) {
            return `${this.dueDateOf(record) || 'na'}|${record.remindAt || ''}`;
        },

        hasNotified(record) {
            return this.state.meta.notified[record.id] === this.notificationKey(record);
        },

        markNotified(record) {
            this.state.meta.notified[record.id] = this.notificationKey(record);
            this.saveSoon();
        },

        /* ---------------------------------------------------------------
         * Import / export
         * ------------------------------------------------------------- */
        toJSON() {
            return JSON.stringify(this.state, null, 2);
        },

        fromJSON(text) {
            const parsed = typeof text === 'string' ? JSON.parse(text) : text;
            if (!parsed || typeof parsed !== 'object') throw new Error('Not a valid Home Manager backup.');
            if (!Array.isArray(parsed.items) && !Array.isArray(parsed.meters)) {
                throw new Error('This file does not look like a Home Manager backup.');
            }
            this.state = this._migrate(parsed);
            this.save();
            return this.state;
        },

        reset(keepSettings) {
            const settings = keepSettings ? this.state.settings : defaultSettings();
            this.state = blankState();
            this.state.settings = settings;
            this.state.meta.seeded = true;
            this.save();
            return this.state;
        }
    };

    /** Local helper so recurrence rollovers clear stale "already notified" marks. */
    function clearNotification(id) {
        if (store.state.meta.notified[id] !== undefined) {
            delete store.state.meta.notified[id];
            store.saveSoon();
        }
    }

    HM.store = store;
    HM.model = {
        BILL_CATEGORIES, REPEATS, PRIORITIES, READING_CYCLES,
        category, repeat, priority,
        newBill, newTask, newMeter, newReading, blankState, defaultSettings, seedState
    };
})(window);
