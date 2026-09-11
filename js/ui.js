/* =========================================================================
 * Home Manager — ui.js
 * Reusable interface primitives: toasts, modal/drawer plumbing, the Eagle
 * library item picker, and the attachment strip used by every editor.
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});
    const U = HM.util;

    const thumbCache = new Map();
    const inflight = new Map();

    /* ---------------------------------------------------------------------
     * Toasts
     * ------------------------------------------------------------------- */
    const ICONS = { ok: '✅', err: '⚠️', warn: '⏰', info: 'ℹ️' };

    function toast(title, text, kind, timeout) {
        const host = document.getElementById('toasts');
        if (!host) return;
        const node = U.el('div', { class: `toast ${kind || 'info'}` }, [
            U.el('div', { class: 'toast-icon', text: ICONS[kind] || ICONS.info }),
            U.el('div', { class: 'toast-body' }, [
                U.el('div', { class: 'toast-title', text: title || '' }),
                text ? U.el('div', { class: 'toast-text', text: text }) : null
            ])
        ]);
        host.appendChild(node);
        const life = timeout || (kind === 'err' ? 6500 : 3400);
        setTimeout(function () {
            node.classList.add('leaving');
            setTimeout(function () { node.remove(); }, 240);
        }, life);
        return node;
    }

    /* ---------------------------------------------------------------------
     * Modal
     * ------------------------------------------------------------------- */
    let modalState = null;

    function openModal(opts) {
        const options = opts || {};
        const backdrop = document.getElementById('modalBackdrop');
        backdrop.innerHTML = '';

        const head = U.el('div', { class: 'modal-head' }, [
            U.el('h3', { class: 'modal-title', text: options.title || '' }),
            U.el('button', {
                class: 'btn btn-ghost btn-icon', title: 'Close (Esc)', text: '✕',
                onclick: function () { closeModal(); }
            })
        ]);

        const body = U.el('div', { class: 'modal-body' }, options.body || '');
        const modal = U.el('div', { class: `modal${options.narrow ? ' narrow' : ''}` }, [head, body]);

        if (options.footer) {
            modal.appendChild(U.el('div', { class: 'modal-foot' }, options.footer));
        }

        backdrop.appendChild(modal);
        backdrop.classList.add('open');

        modalState = {
            onClose: options.onClose || null,
            element: modal,
            body: body
        };

        // Autofocus the first useful control.
        const focusTarget = modal.querySelector('[data-autofocus]')
            || modal.querySelector('input:not([type=hidden]), textarea, select');
        if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 60);

        return modalState;
    }

    function closeModal() {
        const backdrop = document.getElementById('modalBackdrop');
        if (!backdrop.classList.contains('open')) return;
        backdrop.classList.remove('open');
        const state = modalState;
        modalState = null;
        setTimeout(function () {
            backdrop.innerHTML = '';
            if (state && state.onClose) state.onClose();
        }, 210);
    }

    function modalOpen() {
        const backdrop = document.getElementById('modalBackdrop');
        return !!(backdrop && backdrop.classList.contains('open'));
    }

    /* ---------------------------------------------------------------------
     * Confirm
     * ------------------------------------------------------------------- */
    function confirmDialog(opts) {
        const options = opts || {};
        return new Promise(function (resolve) {
            let settled = false;
            const finish = function (value) {
                if (settled) return;
                settled = true;
                closeModal();
                resolve(value);
            };

            openModal({
                title: options.title || 'Are you sure?',
                narrow: true,
                onClose: function () { finish(false); },
                body: [
                    U.el('p', { style: { margin: '0 0 6px', fontSize: '14px' }, text: options.message || '' }),
                    options.detail ? U.el('p', { class: 'hint', text: options.detail }) : null
                ],
                footer: [
                    U.el('div', { class: 'spacer' }),
                    U.el('button', {
                        class: 'btn', text: options.cancelLabel || 'Cancel',
                        onclick: function () { finish(false); }
                    }),
                    U.el('button', {
                        class: `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`, 'data-autofocus': 'true',
                        text: options.confirmLabel || 'Confirm',
                        onclick: function () { finish(true); }
                    })
                ]
            });
        });
    }

    /* ---------------------------------------------------------------------
     * Drawer
     * ------------------------------------------------------------------- */
    let drawerOpenFlag = false;

    function openDrawer(opts) {
        const options = opts || {};
        const backdrop = document.getElementById('drawerBackdrop');
        const drawer = document.getElementById('drawer');
        const head = document.getElementById('drawerHead');
        const body = document.getElementById('drawerBody');
        const foot = document.getElementById('drawerFoot');

        head.innerHTML = '';
        body.innerHTML = '';
        foot.innerHTML = '';

        head.appendChild(U.el('div', { class: 'drawer-title-wrap' }, [
            options.eyebrow ? U.el('div', { class: 'drawer-eyebrow', text: options.eyebrow }) : null,
            U.el('h2', { class: 'drawer-title', text: options.title || '' })
        ]));
        head.appendChild(U.el('button', {
            class: 'btn btn-ghost btn-icon', title: 'Close (Esc)', text: '✕',
            onclick: function () { closeDrawer(); }
        }));

        if (options.body) {
            const list = Array.isArray(options.body) ? options.body : [options.body];
            list.forEach(function (node) { if (node) body.appendChild(node); });
        }
        if (options.footer) {
            const list = Array.isArray(options.footer) ? options.footer : [options.footer];
            list.forEach(function (node) { if (node) foot.appendChild(node); });
        }

        backdrop.classList.add('open');
        drawer.classList.add('open');
        drawerOpenFlag = true;
        body.scrollTop = 0;
        return { head: head, body: body, foot: foot };
    }

    function closeDrawer() {
        const backdrop = document.getElementById('drawerBackdrop');
        const drawer = document.getElementById('drawer');
        backdrop.classList.remove('open');
        drawer.classList.remove('open');
        drawerOpenFlag = false;
    }

    function drawerIsOpen() { return drawerOpenFlag; }

    /* ---------------------------------------------------------------------
     * Thumbnails
     * ------------------------------------------------------------------- */
    function thumb(itemId) {
        if (!itemId) return Promise.resolve('');
        if (thumbCache.has(itemId)) return Promise.resolve(thumbCache.get(itemId));
        if (inflight.has(itemId)) return inflight.get(itemId);
        const promise = HM.bridge.thumbnailDataURL(itemId).then(function (url) {
            thumbCache.set(itemId, url || '');
            inflight.delete(itemId);
            return url || '';
        }).catch(function () {
            inflight.delete(itemId);
            thumbCache.set(itemId, '');
            return '';
        });
        inflight.set(itemId, promise);
        return promise;
    }

    /** Fill an <img>/fallback tile once the thumbnail resolves. */
    function applyThumb(host, itemId, ref) {
        thumb(itemId).then(function (url) {
            if (!host.isConnected) return;
            host.innerHTML = '';
            if (url) {
                host.appendChild(U.el('img', { src: url, alt: (ref && ref.name) || '', loading: 'lazy' }));
            } else {
                host.appendChild(U.el('div', { class: 'fallback', text: (ref && ref.isImage === false) ? '📄' : '🖼' }));
            }
        });
    }

    /* ---------------------------------------------------------------------
     * Eagle library item picker
     * ------------------------------------------------------------------- */

    /**
     * Modal picker for choosing one or more Eagle library items.
     * Resolves to an array of item refs (empty when cancelled).
     */
    function pickEagleItems(opts) {
        const options = opts || {};
        const multiple = options.multiple !== false;

        return new Promise(function (resolve) {
            let settled = false;
            const selected = new Map();
            let currentFolderId = '';
            let currentQuery = '';
            let includeNonImages = false;
            let lastResults = [];

            const finish = function (refs) {
                if (settled) return;
                settled = true;
                closeModal();
                resolve(refs || []);
            };

            /* --- sidebar ------------------------------------------------- */
            const sideHost = U.el('div', { class: 'picker-side' });
            const resultsHost = U.el('div', { class: 'picker-results' });
            const countLabel = U.el('span', { class: 'panel-hint' });
            const actionsHost = U.el('div', { class: 'modal-foot' });

            const searchInput = U.el('input', {
                type: 'text',
                placeholder: 'Search your Eagle library…',
                'data-autofocus': 'true'
            });
            const searchWrap = U.el('div', { class: 'search', style: { width: '100%', flex: '1', minWidth: '180px' } }, [
                U.el('span', { class: 'search-icon', text: '🔍' }),
                searchInput,
                U.el('button', {
                    class: 'search-clear', text: '✕', title: 'Clear',
                    onclick: function () { searchInput.value = ''; onQuery(''); }
                })
            ]);

            const typeToggle = U.el('button', {
                class: 'btn btn-sm', title: 'Toggle whether non-image files are listed',
                text: 'Images only',
                onclick: function () {
                    includeNonImages = !includeNonImages;
                    typeToggle.textContent = includeNonImages ? 'All file types' : 'Images only';
                    typeToggle.classList.toggle('btn-primary', includeNonImages);
                    runSearch();
                }
            });

            const selectionButton = U.el('button', {
                class: 'btn btn-sm',
                title: 'Use whatever is selected in Eagle right now',
                text: '⬅ Use current Eagle selection',
                onclick: async function () {
                    const refs = await HM.bridge.getSelection();
                    if (!refs.length) {
                        toast('Nothing selected', 'Select one or more items in Eagle first.', 'warn');
                        return;
                    }
                    if (!multiple) return finish([refs[0]]);
                    refs.forEach(function (ref) { selected.set(ref.itemId, ref); });
                    renderResults(lastResults);
                    updateCount();
                    toast('Selection added', `${refs.length} item${refs.length === 1 ? '' : 's'} added to the attachment list.`, 'ok');
                }
            });

            const clearSelection = U.el('button', {
                class: 'btn btn-sm', text: 'Clear', title: 'Clear the selection',
                onclick: function () { selected.clear(); renderResults(lastResults); updateCount(); }
            });

            /* --- behaviour ---------------------------------------------- */
            const onQuery = U.debounce(function (value) {
                currentQuery = value;
                searchWrap.classList.toggle('has-value', !!value);
                runSearch();
            }, 260);

            searchInput.addEventListener('input', function () { onQuery(searchInput.value); });
            searchInput.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    onQuery(searchInput.value);
                }
            });

            function updateCount() {
                countLabel.textContent = selected.size
                    ? `${selected.size} selected`
                    : 'Nothing selected yet';
            }

            function renderSidebar() {
                sideHost.innerHTML = '';
                const allButton = U.el('button', {
                    class: `folder-item${currentFolderId ? '' : ' active'}`,
                    onclick: function () {
                        currentFolderId = '';
                        renderSidebar();
                        runSearch();
                    }
                }, [
                    U.el('span', { text: '🗂' }),
                    U.el('span', { class: 'folder-name', text: 'All folders' })
                ]);
                sideHost.appendChild(allButton);

                const libraryLabel = HM.bridge.library.name || 'Eagle library';
                sideHost.appendChild(U.el('div', {
                    class: 'panel-hint',
                    style: { padding: '12px 10px 4px', borderTop: '1px solid var(--border)', marginTop: '8px' },
                    text: `Library: ${libraryLabel}`
                }));

                const tree = HM.bridge.folderTree();
                if (!tree.length) {
                    sideHost.appendChild(U.el('div', { class: 'panel-hint', style: { padding: '10px' }, text: 'No folders found in this library.' }));
                    return;
                }

                const renderNodes = function (nodes, depth) {
                    nodes.forEach(function (node) {
                        const button = U.el('button', {
                            class: `folder-item${currentFolderId === node.id ? ' active' : ''}`,
                            style: { paddingLeft: `${9 + depth * 13}px` },
                            onclick: function () {
                                currentFolderId = node.id;
                                renderSidebar();
                                runSearch();
                            }
                        }, [
                            U.el('span', { text: depth === 0 ? '📁' : '↳' }),
                            U.el('span', { class: 'folder-name', text: node.name })
                        ]);
                        sideHost.appendChild(button);
                        if (node.children && node.children.length) renderNodes(node.children, depth + 1);
                    });
                };
                renderNodes(tree, 0);
            }

            function renderResults(refs, loading) {
                resultsHost.innerHTML = '';
                if (loading) {
                    resultsHost.appendChild(U.el('div', { class: 'loading' }, [
                        U.el('div', { class: 'spinner' }),
                        U.el('span', { text: 'Reading your Eagle library…' })
                    ]));
                    return;
                }
                if (!refs.length) {
                    resultsHost.appendChild(U.el('div', { class: 'empty' }, [
                        U.el('span', { class: 'empty-icon', text: '🖼' }),
                        U.el('div', { class: 'empty-title', text: 'Nothing to show yet' }),
                        U.el('div', {
                            class: 'empty-text',
                            text: currentQuery || currentFolderId
                                ? 'No matching items. Try a different search term or folder.'
                                : 'Search your library or pick a folder on the left. Tip: you can also attach whatever is selected in Eagle right now.'
                        })
                    ]));
                    return;
                }

                const grid = U.el('div', { class: 'item-grid' });
                refs.forEach(function (ref) {
                    const isSelected = selected.has(ref.itemId);
                    const tile = U.el('div', {
                        class: `item-tile${isSelected ? ' selected' : ''}`,
                        title: `${ref.name}\n${ref.ext ? ref.ext.toUpperCase() + ' · ' : ''}${ref.width && ref.height ? ref.width + '×' + ref.height : ''}`,
                        onclick: function () {
                            if (!multiple) return finish([ref]);
                            if (selected.has(ref.itemId)) selected.delete(ref.itemId);
                            else selected.set(ref.itemId, ref);
                            tile.classList.toggle('selected', selected.has(ref.itemId));
                            updateCount();
                        }
                    }, [
                        U.el('div', { class: 'tile-fallback', text: ref.isImage ? '🖼' : '📄' }),
                        U.el('div', { class: 'tile-check', text: '✓' }),
                        U.el('div', { class: 'tile-name', text: ref.name })
                    ]);
                    grid.appendChild(tile);

                    // Swap the placeholder for the real thumbnail as it loads.
                    const imageHost = tile.firstChild;
                    thumb(ref.itemId).then(function (url) {
                        if (!tile.isConnected) return;
                        if (url) {
                            imageHost.replaceWith(U.el('img', { src: url, alt: ref.name, loading: 'lazy' }));
                        } else {
                            imageHost.textContent = ref.isImage ? '🖼' : '📄';
                        }
                    });
                });
                resultsHost.appendChild(grid);
            }

            let searchToken = 0;
            async function runSearch() {
                const token = ++searchToken;
                renderResults([], true);
                let refs = [];
                try {
                    refs = await HM.bridge.queryItems({
                        query: currentQuery,
                        folderId: currentFolderId,
                        imagesOnly: !includeNonImages,
                        limit: 300
                    });
                } catch (err) {
                    HM.log.warn('picker query failed', err);
                }
                if (token !== searchToken) return;   // a newer search won
                lastResults = refs;
                renderResults(refs);
            }

            /* --- assemble ----------------------------------------------- */
            const toolbar = U.el('div', { class: 'picker-toolbar' }, [
                searchWrap,
                typeToggle,
                selectionButton
            ]);

            const picker = U.el('div', { class: 'picker' }, [
                sideHost,
                U.el('div', { class: 'picker-main' }, [toolbar, resultsHost])
            ]);

            actionsHost.appendChild(countLabel);
            actionsHost.appendChild(U.el('div', { class: 'spacer' }));
            actionsHost.appendChild(clearSelection);
            actionsHost.appendChild(U.el('button', {
                class: 'btn', text: 'Cancel', onclick: function () { finish([]); }
            }));
            actionsHost.appendChild(U.el('button', {
                class: 'btn btn-primary',
                text: multiple ? 'Attach selected' : 'Attach',
                onclick: function () {
                    const refs = Array.from(selected.values());
                    if (!refs.length) {
                        toast('Nothing selected', 'Choose at least one item, or use the current Eagle selection.', 'warn');
                        return;
                    }
                    finish(refs);
                }
            }));

            openModal({
                title: options.title || 'Attach Eagle items',
                onClose: function () { if (!settled) { settled = true; resolve([]); } },
                body: [picker],
                footer: [actionsHost]
            });
            // The picker body should not add its own padding.
            modalState.body.style.padding = '0';

            renderSidebar();
            updateCount();
            runSearch();
        });
    }

    /* ---------------------------------------------------------------------
     * Attachment strip (shared by every editor)
     * ------------------------------------------------------------------- */
    /**
     * Renders the attachments of a record plus an "attach" tile.
     *
     * @param {Object} options
     *   record      - the bill/task/meter (or reading) that owns the attachments
     *   meterId     - when the owner is a reading, its meter id
     *   readingId   - when the owner is a reading, its id
     *   onChange    - called after any change so the caller can re-render
     *   compact     - hide the header text
     */
    function attachmentStrip(options) {
        const opts = options || {};
        const record = opts.record;
        const list = (record && record.attachments) || [];
        const wrap = U.el('div');

        // For a reading the tags belong to the parent meter, so resolve the
        // record that actually carries the tag before showing or stamping it.
        const tagOwner = (opts.readingId && opts.meterId)
            ? (HM.store.getMeter(opts.meterId) || record)
            : record;

        if (!opts.compact) {
            const header = U.el('div', { class: 'lbl' }, [
                U.el('span', { text: `Attached Eagle items${list.length ? ` · ${list.length}` : ''}` })
            ]);
            if (list.length && HM.tags.identityTag(tagOwner)) {
                header.appendChild(U.el('span', {
                    class: 'tag-pill tooltip',
                    'data-tip': 'Search this tag in Eagle to find every item attached to this record',
                    text: HM.tags.identityTag(tagOwner)
                }));
            }
            wrap.appendChild(header);
        }

        const strip = U.el('div', { class: 'attach-strip' });

        list.forEach(function (att) {
            const inOtherLibrary = att.libraryPath && HM.bridge.library.path && att.libraryPath !== HM.bridge.library.path;
            const untagged = att.tagged === false;
            const notes = [
                att.name,
                inOtherLibrary ? 'Stored in another Eagle library' : '',
                untagged ? 'Not tagged yet — open that library and sync tags' : '',
                'Click to open in Eagle'
            ].filter(Boolean).join('\n');

            const tile = U.el('div', {
                class: `attach-tile${inOtherLibrary ? ' other-library' : ''}${untagged ? ' untagged' : ''}`,
                title: notes,
                onclick: function (event) {
                    if (event.target.closest('.remove')) return;
                    HM.bridge.openItem(att.itemId, { window: false }).then(function (ok) {
                        if (!ok) toast('Could not open', 'This item is not in the active Eagle library.', 'warn');
                    });
                }
            }, [
                U.el('div', { class: 'fallback', text: '🖼' }),
                att.ext ? U.el('span', { class: 'ext-badge', text: String(att.ext).slice(0, 4) }) : null,
                U.el('button', {
                    class: 'remove', text: '✕', title: 'Detach (also removes the tags from the Eagle item)',
                    onclick: async function (event) {
                        event.stopPropagation();
                        const ok = await confirmDialog({
                            title: 'Detach this item?',
                            message: `Remove “${att.name}” from this record?`,
                            detail: 'Home Manager\'s tags are removed from the Eagle item too. The item itself stays untouched in your library.',
                            confirmLabel: 'Detach',
                            danger: true
                        });
                        if (!ok) return;

                        const result = await HM.tags.detach(tagOwner, att.itemId, att);
                        HM.store.removeAttachment(opts.meterId || record.id, att.itemId, opts.readingId);
                        toast(
                            result.ok ? 'Detached' : 'Detached locally',
                            result.ok
                                ? `Removed ${result.removed.join(', ')} from the Eagle item.`
                                : 'The link was removed, but the tags could not be cleaned up — is the item in the active library?',
                            result.ok ? 'ok' : 'warn'
                        );
                        if (opts.onChange) opts.onChange();
                    }
                })
            ]);
            strip.appendChild(tile);

            const host = tile.firstChild;
            thumb(att.itemId).then(function (url) {
                if (!tile.isConnected) return;
                if (url) host.replaceWith(U.el('img', { src: url, alt: att.name, loading: 'lazy' }));
                else host.textContent = inOtherLibrary ? '🔒' : '🖼';
            });
        });

        strip.appendChild(U.el('button', {
            class: 'attach-add',
            title: 'Attach one or more items from your Eagle library. They get tagged permanently.',
            onclick: async function () {
                const refs = await pickEagleItems({
                    multiple: true,
                    title: 'Attach items to this record'
                });
                if (!refs.length) return;

                if (opts.readingId && opts.meterId) {
                    const meter = HM.store.getMeter(opts.meterId);
                    const reading = meter && meter.readings.find(function (r) { return r.id === opts.readingId; });
                    if (reading) {
                        reading.attachments = reading.attachments || [];
                        const existing = new Set(reading.attachments.map(function (a) { return a.itemId; }));
                        refs.forEach(function (ref) {
                            if (existing.has(ref.itemId)) return;
                            existing.add(ref.itemId);
                            reading.attachments.push(toAttachment(ref));
                        });
                        HM.store.saveSoon();
                    }
                } else {
                    HM.store.addAttachments(record, refs.map(toAttachment));
                }

                // Stamp the Eagle items with this record's tag + state tag. This
                // is what makes the attachment permanent and re-discoverable.
                const result = await HM.tags.applyTo(tagOwner, refs);

                toast(
                    'Attached',
                    result.failed
                        ? `${U.pluralize(refs.length, 'Eagle item')} linked; ${result.failed} could not be tagged in the active library.`
                        : `${U.pluralize(refs.length, 'Eagle item')} linked and tagged ${HM.tags.identityTag(tagOwner)} · ${HM.tags.stateTag(tagOwner)}.`,
                    result.failed ? 'warn' : 'ok'
                );
                if (opts.onChange) opts.onChange();
            }
        }, [
            U.el('span', { class: 'plus', text: '+' }),
            U.el('span', { text: 'From Eagle' })
        ]));

        wrap.appendChild(strip);
        return wrap;
    }

    function toAttachment(ref) {
        return {
            itemId: ref.itemId,
            name: ref.name,
            ext: ref.ext,
            width: ref.width,
            height: ref.height,
            size: ref.size,
            libraryPath: ref.libraryPath || HM.bridge.library.path || '',
            addedAt: new Date().toISOString(),
            tagged: null   // set once we know whether the Eagle tag was written
        };
    }

    /**
     * Compact, read-only thumbnail row for list rows and cards, so attached
     * Eagle items are visible without opening the editor.
     * Returns null when there is nothing attached.
     */
    function thumbStrip(record, ctx, opts) {
        const options = opts || {};
        const list = (record && record.attachments) || [];
        if (!list.length) return null;

        const size = options.size || 40;
        const shown = list.slice(0, options.limit || 5);
        const row = U.el('div', { class: 'thumb-strip' });

        shown.forEach(function (att) {
            const inOtherLibrary = att.libraryPath && HM.bridge.library.path && att.libraryPath !== HM.bridge.library.path;
            const tile = U.el('div', {
                class: `thumb-mini${inOtherLibrary ? ' other-library' : ''}${att.tagged === false ? ' untagged' : ''}`,
                style: { width: size + 'px', height: size + 'px' },
                title: `${att.name}${inOtherLibrary ? '\nStored in another Eagle library' : ''}\nClick to open in Eagle`,
                onclick: function (event) {
                    event.stopPropagation();
                    HM.bridge.openItem(att.itemId, { window: false });
                }
            }, [U.el('div', { class: 'fallback', text: '🖼' })]);

            row.appendChild(tile);
            const host = tile.firstChild;
            thumb(att.itemId).then(function (url) {
                if (!tile.isConnected) return;
                if (url) host.replaceWith(U.el('img', { src: url, alt: att.name, loading: 'lazy' }));
                else host.textContent = inOtherLibrary ? '🔒' : '🖼';
            });
        });

        if (list.length > shown.length) {
            row.appendChild(U.el('span', { class: 'thumb-more', text: `+${list.length - shown.length}` }));
        }
        return row;
    }

    /* ---------------------------------------------------------------------
     * Small form helpers
     * ------------------------------------------------------------------- */
    function field(label, control, hint) {
        return U.el('div', { class: 'field' }, [
            U.el('label', { class: 'lbl', text: label }),
            control,
            hint ? U.el('div', { class: 'hint', text: hint }) : null
        ]);
    }

    function input(attrs) { return U.el('input', Object.assign({ class: 'input' }, attrs || {})); }

    function select(options, value, attrs) {
        const node = U.el('select', Object.assign({ class: 'select' }, attrs || {}));
        options.forEach(function (option) {
            node.appendChild(U.el('option', {
                value: option.value === undefined ? option.id : option.value,
                text: option.label,
                selected: String(option.value === undefined ? option.id : option.value) === String(value === null || value === undefined ? '' : value)
            }));
        });
        return node;
    }

    function textarea(attrs) { return U.el('textarea', Object.assign({ class: 'textarea' }, attrs || {})); }

    function switchRow(title, description, on, onToggle) {
        const button = U.el('button', {
            class: `switch${on ? ' on' : ''}`,
            'aria-pressed': on ? 'true' : 'false',
            onclick: function () {
                const next = !button.classList.contains('on');
                button.classList.toggle('on', next);
                button.setAttribute('aria-pressed', next ? 'true' : 'false');
                onToggle(next);
            }
        });
        return U.el('div', { class: 'switch-row' }, [
            U.el('div', { class: 'switch-text' }, [
                U.el('div', { class: 'switch-title', text: title }),
                description ? U.el('div', { class: 'switch-desc', text: description }) : null
            ]),
            button
        ]);
    }

    function seg(items, activeId, onPick) {
        const host = U.el('div', { class: 'seg' });
        items.forEach(function (item) {
            host.appendChild(U.el('button', {
                class: item.id === activeId ? 'active' : '',
                text: item.label,
                onclick: function () { onPick(item.id); }
            }));
        });
        return host;
    }

    function notice(text, kind, icon) {
        return U.el('div', { class: `notice${kind ? ' ' + kind : ''}` }, [
            U.el('span', { class: 'notice-icon', text: icon || '💡' }),
            U.el('div', { text: text })
        ]);
    }

    function emptyState(icon, title, text, action) {
        return U.el('div', { class: 'empty' }, [
            U.el('span', { class: 'empty-icon', text: icon }),
            U.el('div', { class: 'empty-title', text: title }),
            U.el('div', { class: 'empty-text', text: text }),
            action || null
        ]);
    }

    HM.ui = {
        toast,
        openModal, closeModal, modalOpen,
        confirmDialog,
        openDrawer, closeDrawer, drawerIsOpen,
        thumb, applyThumb,
        pickEagleItems,
        attachmentStrip, toAttachment, thumbStrip,
        field, input, select, textarea, switchRow, seg, notice, emptyState,
        clearThumbCache: function () { thumbCache.clear(); }
    };
})(window);
