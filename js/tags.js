/* =========================================================================
 * Home Manager — tags.js
 *
 * Attachments are stored permanently **in Eagle's tag system**.
 *
 * Every record (task / bill / water meter) gets a stable short code, and each
 * attached library item is tagged with:
 *
 *     hm:t7     the record this item belongs to  (t = task, b = bill, m = meter)
 *     hm:todo   the record is still open          (state tag)
 *     hm:done   the record is completed / paid    (state tag)
 *
 * Because the link lives on the Eagle item itself, Home Manager can rebuild
 * its attachments from the library on every load — the tags are the durable
 * record, data.json is just a cache. Search `hm:` in Eagle's search bar to see
 * every item Home Manager is tracking.
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});
    const store = () => HM.store;

    const KIND_LETTER = { task: 't', bill: 'b', meter: 'm' };

    const tags = {
        PREFIX: 'hm:',
        TODO: 'hm:todo',
        DONE: 'hm:done',

        /**
         * True when we can actually read and write tags in Eagle.
         * Never throws: before Eagle's plugin-create event the host refuses
         * API calls, and this must simply report "not available" rather than
         * escalating into an unhandled rejection.
         */
        enabled() {
            try {
                return !!(HM.bridge && typeof HM.bridge.isAvailable === 'function' && HM.bridge.isAvailable());
            } catch (_) {
                return false;
            }
        },

        /* ---------------------------------------------------------------
         * Tag names
         * ------------------------------------------------------------- */

        /** Stable identity tag for a record, e.g. 'hm:t7'. '' when it has no code yet. */
        identityTag(record) {
            if (!record) return '';
            const letter = KIND_LETTER[record.kind];
            if (!letter || !record.tagCode) return '';
            return `${this.PREFIX}${letter}${record.tagCode}`;
        },

        /**
         * The open/closed state tag.
         * Tasks are done/not done, bills are paid/unpaid. Water meters have no
         * done state, so they get no state tag.
         */
        stateTag(record) {
            if (!record) return '';
            if (record.kind === 'task') return record.done ? this.DONE : this.TODO;
            if (record.kind === 'bill') return record.paid ? this.DONE : this.TODO;
            return '';
        },

        /** Every tag the record's items should carry. */
        tagsFor(record) {
            const identity = this.identityTag(record);
            if (!identity) return [];
            const state = this.stateTag(record);
            return state ? [identity, state] : [identity];
        },

        /** Allocate (once) and return the record's numeric tag code. */
        ensureCode(record) {
            if (!record || !KIND_LETTER[record.kind]) return 0;
            if (!record.tagCode) {
                const meta = store().state.meta;
                meta.tagSeq = (Number(meta.tagSeq) || 0) + 1;
                record.tagCode = meta.tagSeq;
                store().saveSoon();
            }
            return record.tagCode;
        },

        /**
         * Recover a record's tag code from the tags actually sitting on its
         * attached Eagle items.
         *
         * This heals records whose code went missing — most importantly a record
         * that was created *after* items were attached in the editor: the tags
         * were written while it was still an unsaved draft, so unless the code
         * is carried across on save the identity tag becomes an orphan that
         * nothing can ever remove again.
         *
         * @returns {Promise<string>} the identity tag, or '' if none was found
         */
        async adoptCode(record) {
            if (!record) return '';
            if (record.tagCode) return this.identityTag(record);
            const letter = KIND_LETTER[record.kind];
            if (!letter) return '';

            for (const att of (record.attachments || [])) {
                let tags = att.tag ? [att.tag] : null;
                if (!tags) {
                    tags = await HM.bridge.itemTags(att.itemId);
                }
                const match = (tags || [])
                    .map((tag) => this.parse(tag))
                    .find((parsed) => parsed && parsed.kind === record.kind);
                if (!match) continue;

                record.tagCode = match.code;
                const meta = store().state.meta;
                meta.tagSeq = Math.max(Number(meta.tagSeq) || 0, match.code);
                store().saveSoon();
                HM.log.info('recovered tag code for', record.kind, record.id, '→', this.identityTag(record));
                return this.identityTag(record);
            }
            return '';
        },

        /** Human-readable tag for display, allocating the code if needed. */
        label(record, allocate) {
            if (!record) return '';
            if (allocate) this.ensureCode(record);
            return this.identityTag(record);
        },

        /** Parse a tag name back into { kind, code } or null. */
        parse(tagName) {
            const match = /^hm:([tbm])(\d+)$/.exec(String(tagName || ''));
            if (!match) return null;
            const kind = { t: 'task', b: 'bill', m: 'meter' }[match[1]];
            return { kind: kind, code: Number(match[2]) };
        },

        /* ---------------------------------------------------------------
         * Writing tags
         * ------------------------------------------------------------- */

        /**
         * Tag the given Eagle items as belonging to this record, and stamp the
         * current todo/done state.
         * @returns {Promise<{tagged:number, failed:number}>}
         */
        async applyTo(record, refs) {
            if (!this.enabled() || !refs || !refs.length) return { tagged: 0, failed: 0 };
            this.ensureCode(record);

            const identity = this.identityTag(record);
            const keep = this.tagsFor(record);
            const drop = [this.TODO, this.DONE].filter((tag) => keep.indexOf(tag) === -1);

            let failed = 0;
            const taggedIds = new Set();
            for (const ref of refs) {
                const ok = await HM.bridge.setItemTags(ref.itemId, keep, drop);
                if (ok) taggedIds.add(ref.itemId);
                else failed += 1;
            }

            (record.attachments || []).forEach((att) => {
                if (taggedIds.has(att.itemId)) {
                    att.tagged = true;
                    // Remember which tag we wrote, so detaching can remove it
                    // even if the record's own code is ever lost.
                    att.tag = identity;
                } else if (failed) {
                    att.tagged = false;
                }
            });
            store().saveSoon();
            return { tagged: taggedIds.size, failed: failed };
        },

        /**
         * Refresh the todo/done tag on every item attached to this record.
         * Called when a task is completed/reopened or a bill is paid.
         */
        async syncState(record) {
            if (!this.enabled() || !record) return 0;
            const identity = this.identityTag(record);
            if (!identity) return 0;

            const state = this.stateTag(record);
            const keep = state ? [identity, state] : [identity];
            const drop = [this.TODO, this.DONE].filter((tag) => keep.indexOf(tag) === -1);

            let updated = 0;
            for (const att of (record.attachments || [])) {
                if (await HM.bridge.setItemTags(att.itemId, keep, drop)) {
                    att.tagged = true;
                    updated += 1;
                }
            }
            store().saveSoon();
            return updated;
        },

        /**
         * Strip Home Manager's tags from an item that is being detached.
         *
         * Which identity tag to remove is resolved in order of reliability:
         *   1. the tag we recorded on the attachment when we wrote it,
         *   2. the record's own code,
         *   3. whatever `hm:<kind><n>` tag the item is actually carrying.
         *
         * Step 3 matters: relying on the record's code alone is what used to
         * leave a stranded `hm:b1` behind, because a record that lost its code
         * produced an empty identity and only the state tag got removed.
         *
         * The todo/done state tag is only removed when no other record still
         * owns the item — an item can legitimately be attached to more than one.
         *
         * @returns {Promise<{ok:boolean, identity:string, removed:string[]}>}
         */
        async detach(record, itemId, attachment) {
            const result = { ok: false, identity: '', removed: [] };
            if (!this.enabled() || !itemId) return result;

            let identity = (attachment && attachment.tag) || this.identityTag(record);

            if (!identity) {
                // Recover it from the item itself, and heal the record while
                // we are here.
                const tags = await HM.bridge.itemTags(itemId);
                const letter = record ? KIND_LETTER[record.kind] : '';
                const found = (tags || []).find((tag) => {
                    const parsed = this.parse(tag);
                    return parsed && (!letter || parsed.kind === letter);
                });
                if (found) {
                    identity = found;
                    const parsed = this.parse(found);
                    if (record && parsed && !record.tagCode) {
                        record.tagCode = parsed.code;
                        store().state.meta.tagSeq = Math.max(Number(store().state.meta.tagSeq) || 0, parsed.code);
                    }
                }
            }

            if (!identity) {
                HM.log.warn('detach: could not determine the identity tag for', itemId);
                return result;
            }

            // Keep the state tag if another record still points at this item.
            const current = await HM.bridge.itemTags(itemId);
            const stillOwned = (current || []).some((tag) => {
                const parsed = this.parse(tag);
                return parsed && tag !== identity;
            });

            const remove = [identity];
            if (!stillOwned) remove.push(this.TODO, this.DONE);

            result.identity = identity;
            result.ok = await HM.bridge.setItemTags(itemId, [], remove);
            if (result.ok) result.removed = remove;
            store().saveSoon();
            return result;
        },

        /* ---------------------------------------------------------------
         * Reading tags back
         * ------------------------------------------------------------- */

        /**
         * Ask Eagle which items carry this record's tag and adopt any we do not
         * already know about. This is what makes attachments survive a lost or
         * wiped data file.
         * @returns {Promise<number>} how many attachments were recovered
         */
        async reconcileRecord(record) {
            if (!this.enabled() || !record) return 0;

            // A record that lost its code (for example one created after its
            // items were already tagged) recovers it from the items themselves.
            const identity = await this.adoptCode(record);
            if (!identity) return 0;

            const refs = await HM.bridge.queryByTag([identity]);
            if (!refs.length) return 0;

            const before = (record.attachments || []).length;
            store().addAttachments(record, refs.map(function (ref) {
                return {
                    itemId: ref.itemId,
                    name: ref.name,
                    ext: ref.ext,
                    width: ref.width,
                    height: ref.height,
                    size: ref.size,
                    libraryPath: ref.libraryPath || HM.bridge.library.path
                };
            }));

            // Anything Eagle returned demonstrably carries the tag.
            const found = new Set(refs.map(function (ref) { return ref.itemId; }));
            (record.attachments || []).forEach(function (att) {
                if (found.has(att.itemId)) att.tagged = true;
            });

            // Normalise the state tag (covers a task completed while closed).
            await this.syncState(record);
            return (record.attachments || []).length - before;
        },

        /**
         * Reconcile every record. Run on load and when the Eagle library
         * changes, so the plugin always reflects what is tagged in Eagle.
         * @returns {Promise<{records:number, recovered:number, failed:number}>}
         */
        async reconcileAll() {
            const result = { records: 0, recovered: 0, failed: 0 };
            if (!this.enabled()) return result;

            const records = [].concat(store().bills(), store().tasks(), store().meters());

            if (!store().state.meta.tagSeq) {
                // First run against an existing data file: derive the sequence
                // from any codes already in use so new records cannot collide.
                let max = 0;
                records.forEach(function (record) {
                    const code = Number(record.tagCode) || 0;
                    if (code > max) max = code;
                });
                store().state.meta.tagSeq = max;
            }

            for (const record of records) {
                if (!record.tagCode && !(record.attachments || []).length) continue;
                try {
                    result.records += 1;
                    result.recovered += await this.reconcileRecord(record);
                } catch (err) {
                    HM.log.warn('reconcile failed for', record.id, err && err.message);
                    result.failed += 1;
                }
            }

            if (result.recovered) await store().save();
            return result;
        },

        /* ---------------------------------------------------------------
         * Reporting
         * ------------------------------------------------------------- */
        stats() {
            const records = [].concat(store().bills(), store().tasks(), store().meters());
            let taggedRecords = 0;
            let total = 0;
            let tagged = 0;

            records.forEach(function (record) {
                if (record.tagCode) taggedRecords += 1;
                (record.attachments || []).forEach(function (att) {
                    total += 1;
                    if (att.tagged !== false) tagged += 1;
                });
            });

            return {
                records: records.length,
                taggedRecords: taggedRecords,
                attachments: total,
                tagged: tagged,
                untagged: total - tagged,
                nextCode: Number(store().state.meta.tagSeq) || 0
            };
        }
    };

    HM.tags = tags;
})(window);
