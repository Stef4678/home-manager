/* =========================================================================
 * Home Manager — util.js
 * Small, dependency-free helpers: ids, local-date math, money/number
 * formatting, DOM building and event delegation.
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});

    /**
     * Baked-in plugin version.
     *
     * The manifest arrives with Eagle's plugin-create event, and if that event
     * is ever missed there would be no version to report — which is exactly when
     * you most need to know which build is running. `tools/package.ps1` fails the
     * build if this drifts from manifest.json.
     */
    HM.VERSION = '1.0.4';

    /* ---------------------------------------------------------------------
     * ids
     * ------------------------------------------------------------------- */
    let idCounter = 0;
    function uid(prefix) {
        idCounter += 1;
        const rand = Math.random().toString(36).slice(2, 8);
        return `${prefix || 'id'}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
    }

    /* ---------------------------------------------------------------------
     * Local-date helpers
     *
     * Every date in this plugin is stored as a *local* `YYYY-MM-DD` string and
     * every date-time as a local `YYYY-MM-DDTHH:mm` string. This avoids the
     * classic UTC off-by-one-day bug where a bill due "today" shows as
     * yesterday for users east of UTC.
     * ------------------------------------------------------------------- */
    const MS_DAY = 86400000;

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    /** Date -> local 'YYYY-MM-DD' */
    function toISODate(date) {
        if (!date || isNaN(date.getTime())) return '';
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    /** Date -> local 'YYYY-MM-DDTHH:mm' */
    function toISODateTime(date) {
        if (!date || isNaN(date.getTime())) return '';
        return `${toISODate(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    /** 'YYYY-MM-DD' -> Date at local midnight (never shifts the calendar day) */
    function parseDate(iso) {
        if (!iso) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
    }

    /** 'YYYY-MM-DDTHH:mm' (or full ISO) -> Date */
    function parseDateTime(value) {
        if (!value) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value));
        if (m) {
            return new Date(
                Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0, 0
            );
        }
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    function todayISO() {
        return toISODate(new Date());
    }

    /**
     * ISO timestamp -> local 'YYYY-MM-DD'.
     *
     * Timestamps are stored as UTC ISO strings, so `stamp.slice(0, 10)` yields
     * the *UTC* calendar day. For anyone east of UTC that shows the wrong day
     * late in the evening, and the wrong month on the 1st — this converts via
     * the local clock instead.
     */
    function localDateOf(stamp) {
        if (!stamp) return '';
        const d = new Date(stamp);
        return isNaN(d.getTime()) ? '' : toISODate(d);
    }

    function addDays(iso, days) {
        const d = parseDate(iso);
        if (!d) return '';
        d.setDate(d.getDate() + Number(days || 0));
        return toISODate(d);
    }

    function addMonths(iso, months) {
        const d = parseDate(iso);
        if (!d) return '';
        const day = d.getDate();
        const target = new Date(d.getFullYear(), d.getMonth() + Number(months || 0), 1);
        const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        target.setDate(Math.min(day, lastDay));
        return toISODate(target);
    }

    /** Whole days from `fromISO` to `toISO` (positive = the future). */
    function daysBetween(fromISO, toISO) {
        const a = parseDate(fromISO);
        const b = parseDate(toISO);
        if (!a || !b) return null;
        return Math.round((b.getTime() - a.getTime()) / MS_DAY);
    }

    function daysUntil(iso) {
        return daysBetween(todayISO(), iso);
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function fmtDate(iso, style) {
        const d = parseDate(iso);
        if (!d) return '—';
        const y = d.getFullYear();
        switch (style) {
            case 'long': return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${y}`;
            case 'weekday': return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
            case 'medium': return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${y}`;
            case 'monthDay': return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
            default: return iso;
        }
    }

    function fmtDateTime(value) {
        const d = parseDateTime(value);
        if (!d) return '—';
        return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    function fmtTime(value) {
        const d = parseDateTime(value);
        if (!d) return '—';
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    /** Human phrasing for a due date: "Today", "in 3 days", "5 days overdue". */
    function describeDue(iso, opts) {
        const days = daysUntil(iso);
        if (days === null) return { text: 'No date', tone: 'none', days: null };
        const short = opts && opts.short;
        if (days === 0) return { text: 'Today', tone: 'today', days };
        if (days === 1) return { text: 'Tomorrow', tone: 'soon', days };
        if (days === -1) return { text: '1 day overdue', tone: 'overdue', days };
        if (days < 0) return { text: `${Math.abs(days)} days overdue`, tone: 'overdue', days };
        if (days <= 7) return { text: short ? `in ${days}d` : `in ${days} days`, tone: 'soon', days };
        if (days <= 31) return { text: short ? `in ${days}d` : `in ${days} days`, tone: 'upcoming', days };
        return { text: fmtDate(iso, 'medium'), tone: 'upcoming', days };
    }

    /* ---------------------------------------------------------------------
     * Numbers & money
     * ------------------------------------------------------------------- */
    function fmtMoney(value, currency) {
        if (value === null || value === undefined || value === '') return '—';
        const n = Number(value);
        if (!isFinite(n)) return '—';
        const cur = (currency || '').trim();
        if (/^[A-Za-z]{3}$/.test(cur)) {
            try {
                return new Intl.NumberFormat(undefined, {
                    style: 'currency', currency: cur.toUpperCase(),
                    minimumFractionDigits: 2, maximumFractionDigits: 2
                }).format(n);
            } catch (_) { /* fall through to symbol rendering */ }
        }
        const body = new Intl.NumberFormat(undefined, {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(n);
        return cur ? `${cur}${body}` : body;
    }

    function fmtNumber(value, digits) {
        if (value === null || value === undefined || value === '') return '—';
        const n = Number(value);
        if (!isFinite(n)) return '—';
        const d = digits === undefined ? 2 : digits;
        return new Intl.NumberFormat(undefined, {
            minimumFractionDigits: 0, maximumFractionDigits: d
        }).format(n);
    }

    function num(value, fallback) {
        if (value === null || value === undefined || value === '') return fallback === undefined ? null : fallback;
        const n = Number(String(value).replace(',', '.'));
        return isFinite(n) ? n : (fallback === undefined ? null : fallback);
    }

    /* ---------------------------------------------------------------------
     * DOM
     * ------------------------------------------------------------------- */
    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function qs(sel, root) {
        return (root || document).querySelector(sel);
    }

    function qsa(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    /**
     * Build an element: el('div', { class: 'x', html: '...' }, [child, 'text'])
     * `html` is injected raw (callers must escape untrusted values themselves).
     */
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const key of Object.keys(attrs)) {
                const val = attrs[key];
                if (val === null || val === undefined || val === false) continue;
                if (key === 'class' || key === 'className') node.className = val;
                else if (key === 'html') node.innerHTML = val;
                else if (key === 'text') node.textContent = val;
                else if (key === 'dataset') { for (const d of Object.keys(val)) node.dataset[d] = val[d]; }
                else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
                else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
                else node.setAttribute(key, val === true ? '' : val);
            }
        }
        if (children !== null && children !== undefined) {
            const list = Array.isArray(children) ? children : [children];
            for (const child of list) {
                if (child === null || child === undefined || child === false) continue;
                node.appendChild(typeof child === 'string' || typeof child === 'number'
                    ? document.createTextNode(String(child))
                    : child);
            }
        }
        return node;
    }

    /** Event delegation: on(root, 'click', '[data-act]', handler). */
    function on(root, type, selector, handler) {
        root.addEventListener(type, function (event) {
            const target = event.target.closest(selector);
            if (target && root.contains(target)) handler(event, target);
        });
    }

    function debounce(fn, wait) {
        let timer = null;
        return function () {
            const args = arguments;
            const self = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(self, args); }, wait || 200);
        };
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function deepClone(value) {
        return value === undefined ? value : JSON.parse(JSON.stringify(value));
    }

    function groupBy(list, keyFn) {
        const out = new Map();
        for (const item of list) {
            const key = keyFn(item);
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(item);
        }
        return out;
    }

    function sum(list, keyFn) {
        return list.reduce(function (acc, item) {
            const v = Number(keyFn(item));
            return acc + (isFinite(v) ? v : 0);
        }, 0);
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /** "1 item" / "3 items" */
    function pluralize(count, singular, plural) {
        return `${count} ${count === 1 ? singular : (plural || singular + 's')}`;
    }

    /* ---------------------------------------------------------------------
     * Logging — mirrors to the Eagle log when available, always to the console.
     *
     * Eagle's log keeps only the *first* argument passed to its log methods, so
     * everything is flattened into a single string here. Without that, every
     * line in %APPDATA%\Eagle\log.log reads just "[Home Manager]" with no
     * message — which makes real-host debugging painful.
     * ------------------------------------------------------------------- */
    function flatten(args) {
        return Array.prototype.slice.call(args).map(function (value) {
            if (value instanceof Error) return (value && value.message) || String(value);
            if (value && typeof value === 'object') {
                try { return JSON.stringify(value); } catch (_) { return String(value); }
            }
            return String(value);
        }).join(' ');
    }

    function emit(level, args) {
        const line = '[Home Manager] ' + flatten(args);
        try { (console[level] || console.log)(line); } catch (_) { /* ignore */ }
        try {
            const eagleLog = global.eagle && global.eagle.log;
            if (!eagleLog) return;
            const fn = typeof eagleLog[level] === 'function' ? eagleLog[level]
                : (typeof eagleLog === 'function' ? eagleLog : null);
            if (fn) fn.call(eagleLog, line);
        } catch (_) { /* never let logging break the app */ }
    }

    const log = {
        info: function () { emit('log', Array.prototype.slice.call(arguments)); },
        warn: function () { emit('warn', Array.prototype.slice.call(arguments)); },
        error: function () { emit('error', Array.prototype.slice.call(arguments)); }
    };

    HM.log = log;

    /* ---------------------------------------------------------------------
     * Diagnostics file.
     *
     * Eagle does not reliably forward a plugin's console output into
     * %APPDATA%\Eagle\log.log, and its API rejects with plain strings (no
     * stack), so a failure can be very hard to trace from the outside. This
     * writes a small, bounded log next to data.json that can be read directly.
     * ------------------------------------------------------------------- */
    const diag = {
        _path: '',
        _fs: null,
        _disabled: false,

        init(dataPath) {
            try {
                if (!dataPath) return;
                this._fs = this._fs || require('fs');
                this._path = String(dataPath).replace(/data\.json$/i, 'diagnostics.log');
            } catch (_) {
                this._disabled = true;
            }
        },

        path() {
            return this._path;
        },

        write(kind, message, detail) {
            const line = `${new Date().toISOString()}\t${kind}\t${flatten([message])}`
                + (detail ? `\t${flatten([detail])}` : '') + '\n';
            try { console.log('[Home Manager diag]', line.trim()); } catch (_) { /* ignore */ }
            if (this._disabled || !this._path || !this._fs) return;
            try {
                // Keep it bounded: start over past ~200 KB.
                if (this._fs.existsSync(this._path) && this._fs.statSync(this._path).size > 200000) {
                    this._fs.writeFileSync(this._path, '');
                }
                this._fs.appendFileSync(this._path, line);
            } catch (_) { /* diagnostics must never break anything */ }
        }
    };

    HM.diag = diag;

    HM.util = {
        uid, pad2,
        toISODate, toISODateTime, parseDate, parseDateTime, todayISO, localDateOf,
        addDays, addMonths, daysBetween, daysUntil,
        fmtDate, fmtDateTime, fmtTime, describeDue,
        fmtMoney, fmtNumber, num,
        esc, qs, qsa, el, on, debounce, clamp, deepClone, groupBy, sum, sleep, pluralize,
        MONTHS, MONTHS_LONG, WEEKDAYS, MS_DAY
    };
})(window);
