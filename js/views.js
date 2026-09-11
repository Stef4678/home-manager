/* =========================================================================
 * Home Manager — views.js
 * Every screen plus the editors that sit behind them.
 * ========================================================================= */
(function (global) {
    'use strict';

    const HM = (global.HM = global.HM || {});
    const U = HM.util;
    const ui = HM.ui;

    const store = () => HM.store;

    /* =====================================================================
     * Shared building blocks
     * =================================================================== */

    function pill(status) {
        return U.el('span', { class: `pill pill-${status.tone}` }, [
            U.el('span', { text: status.label })
        ]);
    }

    function categoryChip(cat, size) {
        return U.el('div', {
            class: 'cat-chip',
            style: { '--cat-color': cat.color, width: size ? size + 'px' : null, height: size ? size + 'px' : null },
            text: cat.icon
        });
    }

    function priorityDot(priorityId) {
        const prio = HM.model.priority(priorityId);
        return U.el('span', { class: 'prio-dot', style: { '--prio': prio.color }, title: `${prio.label} priority` });
    }

    /** A 0–100% bar showing how close a due date is. */
    function dueProgress(dueDate) {
        const days = U.daysUntil(dueDate);
        if (days === null) return 0;
        if (days <= 0) return 100;
        return U.clamp(Math.round(((30 - Math.min(days, 30)) / 30) * 100), 3, 100);
    }

    function toneFor(status) {
        return {
            overdue: 'var(--danger)', today: 'var(--warn)', soon: '#f2c14e',
            upcoming: 'var(--info)', later: 'var(--muted)', paid: 'var(--ok)',
            done: 'var(--ok)', none: 'var(--faint)'
        }[status.tone] || 'var(--accent)';
    }

    function attachmentsBadge(record) {
        const count = (record.attachments || []).length;
        return U.el('span', {
            class: 'attach-count',
            title: count ? `${count} Eagle item${count === 1 ? '' : 's'} attached` : 'No Eagle items attached'
        }, [
            U.el('span', { text: count ? '🖼' : '🖼' }),
            U.el('span', { text: String(count) })
        ]);
    }

    /**
     * "Attach from Eagle" plus a link to the record's tag, used on cards and
     * rows. The tag is how the attachment is made permanent, so it is worth
     * surfacing: searching it in Eagle finds every item for this record.
     */
    function attachActions(record, ctx, opts) {
        const options = opts || {};
        const nodes = [];
        const count = (record.attachments || []).length;

        nodes.push(U.el('button', {
            class: 'btn btn-sm',
            title: 'Attach one or more image items from your Eagle library',
            onclick: async function (event) {
                event.stopPropagation();
                const refs = await ui.pickEagleItems({ multiple: true, title: 'Attach Eagle items' });
                if (!refs.length) return;
                store().addAttachments(record, refs.map(ui.toAttachment));
                const result = await HM.tags.applyTo(record, refs);
                if (options.onChange) options.onChange();
                else if (ctx && ctx.refresh) ctx.refresh();
                ui.toast(
                    'Attached',
                    result.failed
                        ? `${U.pluralize(refs.length, 'item')} linked; ${result.failed} could not be tagged in the active library.`
                        : `${U.pluralize(refs.length, 'item')} linked and tagged ${HM.tags.label(record, false)}.`,
                    result.failed ? 'warn' : 'ok'
                );
            }
        }, [
            U.el('span', { text: '🖼' }),
            U.el('span', { text: count ? `Attach (${count})` : 'Attach from Eagle' })
        ]));

        if (count) {
            nodes.push(U.el('button', {
                class: 'btn btn-sm btn-ghost tooltip',
                'data-tip': `Search this tag in Eagle to find every item attached to this record`,
                onclick: async function (event) {
                    event.stopPropagation();
                    const itemIds = (record.attachments || []).map(function (att) { return att.itemId; });
                    const ok = await HM.bridge.selectItems(itemIds);
                    if (ok) ui.toast('Selected in Eagle', `${U.pluralize(itemIds.length, 'item')} selected.`, 'ok');
                    else ui.toast('Could not select', 'Eagle is not reachable.', 'warn');
                }
            }, [
                U.el('span', { text: '🎯' }),
                U.el('span', { text: HM.tags.identityTag(record) || 'tag' })
            ]));
        }

        return nodes;
    }

    function openItemInEagle(itemId) {
        HM.bridge.openItem(itemId, { window: false }).then(function (ok) {
            if (!ok) ui.toast('Not in this library', 'That item lives in a different Eagle library.', 'warn');
        });
    }

    /* =====================================================================
     * Dashboard
     * =================================================================== */
    function renderDashboard(host, ctx) {
        const state = store().state;
        const summary = store().summary();
        const settings = state.settings;

        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

        /* --- hero ------------------------------------------------------ */
        const nextUp = summary.alerts[0];
        const heroSub = summary.overdueCount
            ? `${U.pluralize(summary.overdueCount, 'item')} need attention right now${nextUp ? ` — starting with “${nextUp.record.title || nextUp.record.room}"` : ''}.`
            : nextUp
                ? `You are all caught up. Next up: “${nextUp.record.title || (nextUp.record.room + ' water meter')}” ${U.describeDue(nextUp.due).text.toLowerCase()}.`
                : 'Nothing scheduled. Add a bill or a task to get started.';

        const hero = U.el('div', { class: 'hero-strip' }, [
            U.el('h2', { text: `${greeting} 👋` }),
            U.el('p', { text: heroSub }),
            U.el('div', { class: 'hero-actions' }, [
                U.el('button', {
                    class: 'btn btn-primary',
                    onclick: function () { openEditor(null, ctx, 'bill'); }
                }, [U.el('span', { text: '＋' }), U.el('span', { text: 'New bill' })]),
                U.el('button', {
                    class: 'btn',
                    onclick: function () { openEditor(null, ctx, 'task'); }
                }, [U.el('span', { text: '＋' }), U.el('span', { text: 'New task' })]),
                U.el('button', {
                    class: 'btn',
                    onclick: function () { ctx.navigate('water', { focusReading: true }); }
                }, [U.el('span', { text: '💧' }), U.el('span', { text: 'Log meter reading' })]),
                U.el('button', {
                    class: 'btn',
                    title: 'Re-read which Eagle items are tagged as attached to your records',
                    onclick: function () { syncTags(ctx); }
                }, [U.el('span', { text: '🏷' }), U.el('span', { text: 'Sync Eagle tags' })])
            ])
        ]);
        host.appendChild(hero);

        /* --- stat tiles ------------------------------------------------ */
        const stats = [
            {
                label: 'Overdue', tone: 'var(--danger)',
                value: String(summary.overdueCount),
                meta: summary.overdueCount ? 'Needs action' : 'Nothing overdue',
                onClick: function () { ctx.navigate('reminders'); }
            },
            {
                label: 'Due in 7 days', tone: 'var(--warn)',
                value: String(summary.dueThisWeekCount),
                meta: 'Bills, tasks and readings',
                onClick: function () { ctx.navigate('reminders'); }
            },
            {
                label: 'Unpaid bills', tone: 'var(--accent)',
                value: U.fmtMoney(summary.openBillsTotal, settings.currency),
                meta: `${U.pluralize(summary.openBillCount, 'open bill')}`,
                small: true,
                onClick: function () { ctx.navigate('bills'); }
            },
            {
                label: 'Paid this month', tone: 'var(--ok)',
                value: U.fmtMoney(summary.paidThisMonthTotal, settings.currency),
                meta: `${U.pluralize(summary.paidThisMonthCount, 'payment')}`,
                small: true,
                onClick: function () { ctx.navigate('bills', { filter: 'paid' }); }
            },
            {
                label: 'Open tasks', tone: 'var(--info)',
                value: String(summary.openTaskCount),
                meta: summary.overdueTasks ? `${summary.overdueTasks} overdue` : 'All on schedule',
                onClick: function () { ctx.navigate('tasks'); }
            },
            {
                label: 'Next water reading', tone: 'var(--accent-2)',
                value: summary.nextMeter ? U.describeDue(summary.nextMeter.nextDue, { short: true }).text : '—',
                meta: summary.nextMeter ? `${summary.nextMeter.room} meter` : 'No meters configured',
                small: true,
                onClick: function () { ctx.navigate('water'); }
            }
        ];

        const statGrid = U.el('div', { class: 'stat-grid' });
        stats.forEach(function (stat) {
            statGrid.appendChild(U.el('div', {
                class: 'stat',
                style: { '--tone': stat.tone, cursor: stat.onClick ? 'pointer' : 'default' },
                onclick: stat.onClick
            }, [
                U.el('div', { class: 'stat-label', text: stat.label }),
                U.el('div', { class: `stat-value${stat.small ? ' small' : ''}`, text: stat.value }),
                U.el('div', { class: 'stat-meta', text: stat.meta })
            ]));
        });
        host.appendChild(statGrid);

        /* --- timeline + side ------------------------------------------ */
        const split = U.el('div', { class: 'split', style: { marginTop: '20px' } });

        const upcoming = summary.alerts.filter(function (a) {
            const days = U.daysUntil(a.due);
            return days !== null && days <= 21;
        }).slice(0, 12);

        const timelinePanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [
                U.el('h3', { class: 'panel-title' }, [
                    U.el('span', { text: '⏰' }),
                    U.el('span', { text: 'Next 3 weeks' }),
                    U.el('span', { class: 'count', text: String(upcoming.length) })
                ]),
                U.el('div', { class: 'spacer' }),
                U.el('button', {
                    class: 'btn btn-sm btn-ghost', text: 'All reminders',
                    onclick: function () { ctx.navigate('reminders'); }
                })
            ])
        ]);

        if (upcoming.length) {
            const list = U.el('div', { class: 'timeline' });
            upcoming.forEach(function (alert) { list.appendChild(timelineRow(alert, ctx)); });
            timelinePanel.appendChild(list);
        } else {
            timelinePanel.appendChild(ui.emptyState(
                '🎉', 'Nothing coming up',
                'No bills, tasks or meter readings are due in the next three weeks.',
                U.el('button', {
                    class: 'btn btn-primary', text: 'Add a bill',
                    onclick: function () { openEditor(null, ctx, 'bill'); }
                })
            ));
        }
        split.appendChild(timelinePanel);

        /* --- right column --------------------------------------------- */
        const rightColumn = U.el('div');

        // Water snapshot
        const waterPanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [
                U.el('h3', { class: 'panel-title' }, [U.el('span', { text: '💧' }), U.el('span', { text: 'Water meters' })]),
                U.el('div', { class: 'spacer' }),
                U.el('button', {
                    class: 'btn btn-sm btn-ghost', text: 'Manage',
                    onclick: function () { ctx.navigate('water'); }
                })
            ])
        ]);

        if (state.meters.length) {
            state.meters.forEach(function (meter) {
                const latest = store().latestReading(meter);
                const status = store().meterStatus(meter);
                waterPanel.appendChild(U.el('div', {
                    class: 'timeline-row',
                    onclick: function () { ctx.navigate('water', { focusMeter: meter.id }); }
                }, [
                    U.el('div', { class: 'timeline-icon', text: meter.icon || '🚰' }),
                    U.el('div', { class: 'timeline-body' }, [
                        U.el('div', { class: 'timeline-title', text: `${meter.room} · ${latest && latest.value !== null ? U.fmtNumber(latest.value, 2) + ' ' + meter.unit : 'no readings'}` }),
                        U.el('div', {
                            class: 'timeline-sub',
                            text: latest && latest.consumption !== null
                                ? `Used ${U.fmtNumber(latest.consumption, 2)} ${meter.unit} since ${U.fmtDate(latest.previousDate, 'medium')}`
                                : 'Log readings to track consumption'
                        })
                    ]),
                    U.el('div', { class: 'timeline-right' }, [pill(status)])
                ]));
            });
        } else {
            waterPanel.appendChild(ui.notice('No water meters yet. Add one for the kitchen, the bathroom, or anywhere else you read a meter.'));
        }
        rightColumn.appendChild(waterPanel);

        // Recently paid
        const payments = [];
        store().bills().forEach(function (bill) {
            (bill.payments || []).forEach(function (payment) {
                payments.push({ bill: bill, payment: payment });
            });
        });
        payments.sort(function (a, b) {
            return String(b.payment.paidAt).localeCompare(String(a.payment.paidAt));
        });

        const paidPanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [
                U.el('h3', { class: 'panel-title' }, [U.el('span', { text: '✅' }), U.el('span', { text: 'Recently paid' })])
            ])
        ]);
        if (payments.length) {
            payments.slice(0, 6).forEach(function (entry) {
                paidPanel.appendChild(U.el('div', { class: 'payment-row' }, [
                    U.el('span', { class: 'payment-amount', text: U.fmtMoney(entry.payment.amount, entry.bill.currency || settings.currency) }),
                    U.el('span', { class: 'payment-date', text: U.fmtDate(U.localDateOf(entry.payment.paidAt), 'medium') }),
                    U.el('span', { class: 'spacer', style: { flex: '1' } }),
                    U.el('span', { class: 'payment-for', text: entry.bill.title })
                ]));
            });
        } else {
            paidPanel.appendChild(U.el('p', { class: 'panel-hint', text: 'No payments recorded yet. Mark a bill as paid and it will show up here.' }));
        }
        rightColumn.appendChild(paidPanel);

        split.appendChild(rightColumn);
        host.appendChild(split);
    }

    function timelineRow(alert, ctx) {
        const record = alert.record;
        const isBill = record.kind === 'bill';
        const isMeter = record.kind === 'meter';
        const cat = isBill ? HM.model.category(record.category) : null;
        const icon = isMeter ? (record.icon || '🚰') : isBill ? cat.icon : (record.done ? '✅' : '📋');
        const due = alert.due;
        const dueText = U.describeDue(due);
        const reminder = store().reminderAt(record);

        return U.el('div', {
            class: `timeline-row${alert.status.key === 'overdue' ? ' is-overdue' : ''}`,
            onclick: function () { openEditor(record, ctx); }
        }, [
            U.el('div', { class: 'timeline-icon', text: icon }),
            U.el('div', { class: 'timeline-body' }, [
                U.el('div', { class: 'timeline-title', text: record.title || `${record.room} water meter` }),
                U.el('div', {
                    class: 'timeline-sub',
                    text: [
                        isBill && record.amount !== null && record.amount !== undefined ? U.fmtMoney(record.amount, record.currency || store().state.settings.currency) : '',
                        isMeter ? `Next reading · ${record.unit}` : '',
                        !isBill && !isMeter ? (record.category || 'task') : '',
                        reminder ? `Reminder ${U.fmtDate(U.toISODate(reminder), 'medium')}` : ''
                    ].filter(Boolean).join(' · ')
                })
            ]),
            U.el('div', { class: 'timeline-right' }, [
                U.el('span', { class: 'timeline-date', text: due ? U.fmtDate(due, 'monthDay') : '—' }),
                pill(alert.status)
            ])
        ]);
    }

    /**
     * Re-read the library and adopt every item tagged as attached to one of our
     * records, then refresh the todo/done state tags.
     */
    async function syncTags(ctx, quiet) {
        if (!HM.tags.enabled()) {
            if (!quiet) ui.toast('Eagle not reachable', 'Tag sync needs the Eagle API.', 'warn');
            return { records: 0, recovered: 0, failed: 0 };
        }
        const node = quiet ? null : ui.toast('Syncing tags…', 'Reading hm: tags from your Eagle library.', 'info', 20000);
        let result = { records: 0, recovered: 0, failed: 0 };
        try {
            result = await HM.tags.reconcileAll();
        } catch (err) {
            HM.log.warn('tag sync failed', err);
        }
        if (node) node.remove();
        if (!quiet) {
            ui.toast(
                'Tags synced',
                result.recovered
                    ? `${U.pluralize(result.recovered, 'attachment')} recovered from Eagle tags across ${U.pluralize(result.records, 'record')}.`
                    : `Checked ${U.pluralize(result.records, 'record')}; everything already matched.`,
                'ok'
            );
        }
        if (ctx && ctx.refresh) ctx.refresh();
        return result;
    }

    /* =====================================================================
     * Bills
     * =================================================================== */
    function renderBills(host, ctx) {
        const settings = store().state.settings;
        const filter = ctx.app.billFilter || 'open';
        const categoryFilter = ctx.app.billCategory || 'all';
        const query = ctx.app.search.toLowerCase();

        let bills = store().bills();

        if (query) {
            bills = bills.filter(function (bill) {
                return [bill.title, bill.provider, bill.accountNumber, bill.notes, HM.model.category(bill.category).label]
                    .join(' ').toLowerCase().indexOf(query) !== -1;
            });
        }
        if (categoryFilter !== 'all') {
            bills = bills.filter(function (bill) { return bill.category === categoryFilter; });
        }
        if (filter === 'open') bills = bills.filter(function (bill) { return !bill.paid; });
        else if (filter === 'paid') bills = bills.filter(function (bill) { return bill.paid; });
        else if (filter === 'overdue') {
            bills = bills.filter(function (bill) { return !bill.paid && store().billStatus(bill).key === 'overdue'; });
        } else if (filter === 'soon') {
            bills = bills.filter(function (bill) {
                const key = store().billStatus(bill).key;
                return !bill.paid && (key === 'today' || key === 'soon');
            });
        }

        bills.sort(function (a, b) {
            if (a.paid !== b.paid) return a.paid ? 1 : -1;
            return (U.parseDate(a.dueDate) || 0) - (U.parseDate(b.dueDate) || 0);
        });

        /* --- toolbar --------------------------------------------------- */
        const filters = [
            { id: 'open', label: 'Unpaid' },
            { id: 'soon', label: 'Due soon' },
            { id: 'overdue', label: 'Overdue' },
            { id: 'paid', label: 'Paid' },
            { id: 'all', label: 'All' }
        ];

        const head = U.el('div', { class: 'section-head' }, [
            U.el('h2', { class: 'section-title', text: 'Bills' }),
            ui.seg(filters, filter, function (id) {
                ctx.app.billFilter = id;
                ctx.refresh();
            }),
            U.el('div', { class: 'spacer' }),
            ui.select(
                [{ value: 'all', label: 'All categories' }].concat(
                    HM.model.BILL_CATEGORIES.map(function (c) { return { value: c.id, label: c.label }; })
                ),
                categoryFilter,
                {
                    style: { width: 'auto', minWidth: '150px' },
                    onchange: function (event) {
                        ctx.app.billCategory = event.target.value;
                        ctx.refresh();
                    }
                }
            ),
            U.el('button', {
                class: 'btn btn-primary',
                onclick: function () { openEditor(null, ctx, 'bill'); }
            }, [U.el('span', { text: '＋' }), U.el('span', { text: 'New bill' })])
        ]);
        host.appendChild(head);

        if (!bills.length) {
            host.appendChild(ui.emptyState(
                '🧾',
                query || categoryFilter !== 'all' ? 'No bills match this filter' : 'No bills yet',
                query || categoryFilter !== 'all'
                    ? 'Try a different filter or clear the search box.'
                    : 'Add your electricity, gas, water or any other recurring household bill and Home Manager will remind you before it is due.',
                U.el('button', {
                    class: 'btn btn-primary', text: 'Add your first bill',
                    onclick: function () { openEditor(null, ctx, 'bill'); }
                })
            ));
            return;
        }

        const grid = U.el('div', { class: 'bill-grid' });
        bills.forEach(function (bill) { grid.appendChild(billCard(bill, ctx)); });
        host.appendChild(grid);

        /* --- paid history --------------------------------------------- */
        if (filter === 'all' || filter === 'paid') {
            const withHistory = bills.filter(function (bill) { return (bill.payments || []).length; });
            if (withHistory.length) {
                host.appendChild(U.el('div', { class: 'section-head' }, [
                    U.el('h2', { class: 'section-title', text: 'Payment history' })
                ]));
                const panel = U.el('div', { class: 'panel' });
                withHistory.forEach(function (bill) {
                    panel.appendChild(U.el('div', { style: { marginBottom: '10px' } }, [
                        U.el('div', { style: { fontWeight: '700', fontSize: '13px', marginBottom: '4px' }, text: bill.title })
                    ]));
                    (bill.payments || []).slice(0, 5).forEach(function (payment) {
                        panel.appendChild(U.el('div', { class: 'payment-row' }, [
                            U.el('span', { class: 'payment-amount', text: U.fmtMoney(payment.amount, bill.currency || settings.currency) }),
                            U.el('span', { class: 'payment-date', text: U.fmtDate(U.localDateOf(payment.paidAt), 'medium') }),
                            U.el('span', { style: { flex: '1' } }),
                            U.el('span', { class: 'payment-for', text: `for ${U.fmtDate(payment.forDueDate, 'medium')}` })
                        ]));
                    });
                });
                host.appendChild(panel);
            }
        }
    }

    function billCard(bill, ctx) {
        const settings = store().state.settings;
        const cat = HM.model.category(bill.category);
        const status = store().billStatus(bill);
        const currency = bill.currency || settings.currency;
        const repeat = HM.model.repeat(bill.repeat);
        const lastPayment = (bill.payments || [])[0];

        const foot = U.el('div', { class: 'bill-foot' });

        if (!bill.paid) {
            foot.appendChild(U.el('button', {
                class: 'btn btn-sm btn-ok',
                title: 'Record this bill as paid',
                onclick: function (event) {
                    event.stopPropagation();
                    markPaid(bill, ctx);
                }
            }, [U.el('span', { text: '✓' }), U.el('span', { text: 'Mark paid' })]));
        } else {
            foot.appendChild(U.el('button', {
                class: 'btn btn-sm',
                title: 'Undo the paid flag',
                onclick: function (event) {
                    event.stopPropagation();
                    store().markUnpaid(bill.id);
                    ui.toast('Marked as unpaid', bill.title, 'info');
                    ctx.refresh();
                }
            }, [U.el('span', { text: '↩' }), U.el('span', { text: 'Undo' })]));
        }

        foot.appendChild(U.el('span', { class: 'spacer' }));
        attachActions(bill, ctx).forEach(function (node) { foot.appendChild(node); });
        foot.appendChild(U.el('button', {
            class: 'btn btn-sm btn-ghost', text: '✎', title: 'Edit bill',
            onclick: function (event) { event.stopPropagation(); openEditor(bill, ctx); }
        }));

        return U.el('div', {
            class: `bill-card${status.key === 'overdue' ? ' is-overdue' : ''}${bill.paid ? ' is-paid' : ''}`,
            onclick: function () { openEditor(bill, ctx); }
        }, [
            U.el('div', { class: 'bill-top' }, [
                categoryChip(cat),
                U.el('div', { class: 'bill-title-wrap' }, [
                    U.el('div', { class: 'bill-title', text: bill.title || 'Untitled bill' }),
                    U.el('div', { class: 'bill-sub', text: [cat.label, bill.provider].filter(Boolean).join(' · ') })
                ]),
                pill(status)
            ]),

            U.el('div', { class: 'bill-amount' }, [
                U.el('span', { text: U.fmtMoney(bill.amount, currency) }),
                bill.paid ? U.el('span', { class: 'muted', text: '  paid' }) : null
            ]),

            U.el('div', { class: 'bill-due-row' }, [
                U.el('span', { class: 'bill-due-text', text: `Due ${U.fmtDate(bill.dueDate, 'long')}` }),
                bill.repeat !== 'none' ? U.el('span', { class: 'tag', text: repeat.label }) : null,
                attachmentsBadge(bill)
            ]),

            bill.paid ? null : U.el('div', {
                class: 'progress',
                style: { '--tone': toneFor(status) },
                title: status.label
            }, [U.el('span', { style: { width: dueProgress(bill.dueDate) + '%' } })]),

            U.el('div', { class: 'mini-meta' }, [
                lastPayment
                    ? U.el('span', {}, [
                        U.el('span', { text: 'Last paid ' }),
                        U.el('b', { text: U.fmtDate(U.localDateOf(lastPayment.paidAt), 'medium') })
                    ])
                    : null,
                bill.consumption !== null && bill.consumption !== undefined && bill.consumption !== ''
                    ? U.el('span', {}, [
                        U.el('span', { text: 'Usage ' }),
                        U.el('b', { text: `${U.fmtNumber(bill.consumption, 2)}${bill.consumptionUnit ? ' ' + bill.consumptionUnit : ''}` })
                    ])
                    : null
            ]),

            foot
        ]);
    }

    async function markPaid(bill, ctx) {
        const currency = bill.currency || store().state.settings.currency;
        const rolls = bill.repeat !== 'none' && bill.autoRoll && store().state.settings.markPaidRollsForward;

        await new Promise(function (resolve) {
            let settled = false;
            const finish = function () { if (!settled) { settled = true; ui.closeModal(); resolve(); } };

            const amountInput = ui.input({
                type: 'number', step: '0.01', min: '0',
                value: bill.amount === null || bill.amount === undefined ? '' : String(bill.amount),
                'data-autofocus': 'true'
            });
            const noteInput = ui.input({ type: 'text', placeholder: 'Optional note (e.g. paid by card)' });
            const rollSwitch = ui.switchRow(
                'Roll the due date to the next period',
                rolls ? `Next due date: ${U.fmtDate(store().nextDueDate(bill.dueDate, bill.repeat), 'long')}` : 'The bill will simply be marked as paid.',
                rolls,
                function () { /* the value is read on submit */ }
            );

            ui.openModal({
                title: 'Mark bill as paid',
                narrow: true,
                onClose: finish,
                body: [
                    U.el('p', { style: { margin: '0 0 14px', color: 'var(--muted)' }, text: `${bill.title} · due ${U.fmtDate(bill.dueDate, 'long')}` }),
                    ui.field('Amount paid', U.el('div', { class: 'input-group' }, [
                        amountInput,
                        U.el('span', { class: 'input-suffix', text: currency })
                    ])),
                    ui.field('Note', noteInput),
                    bill.repeat !== 'none' && bill.autoRoll ? rollSwitch : null
                ],
                footer: [
                    U.el('div', { class: 'spacer' }),
                    U.el('button', { class: 'btn', text: 'Cancel', onclick: finish }),
                    U.el('button', {
                        class: 'btn btn-ok', text: '✓ Mark as paid',
                        onclick: function () {
                            const switchButton = rollSwitch.querySelector('.switch');
                            const rollForward = switchButton.classList.contains('on');
                            const updated = store().markPaid(bill.id, {
                                amount: U.num(amountInput.value, bill.amount),
                                note: noteInput.value.trim(),
                                rollForward: bill.repeat === 'none' ? false : rollForward
                            });
                            finish();
                            ui.toast(
                                'Payment recorded',
                                updated && updated.paid
                                    ? `${bill.title} marked as paid.`
                                    : `${bill.title} paid. Next due ${U.fmtDate(updated.dueDate, 'long')}.`,
                                'ok'
                            );
                            if (ctx && ctx.refresh) ctx.refresh();
                        }
                    })
                ]
            });
        });
    }

    /* =====================================================================
     * Tasks
     * =================================================================== */
    function renderTasks(host, ctx) {
        const filter = ctx.app.taskFilter || 'open';
        const query = ctx.app.search.toLowerCase();

        let tasks = store().tasks();

        if (query) {
            tasks = tasks.filter(function (task) {
                return [task.title, task.notes, task.category].join(' ').toLowerCase().indexOf(query) !== -1;
            });
        }

        const filters = [
            { id: 'open', label: 'Open' },
            { id: 'today', label: 'Today' },
            { id: 'overdue', label: 'Overdue' },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'done', label: 'Done' },
            { id: 'all', label: 'All' }
        ];

        if (filter === 'open') tasks = tasks.filter(function (t) { return !t.done; });
        else if (filter === 'done') tasks = tasks.filter(function (t) { return t.done; });
        else if (filter === 'today') tasks = tasks.filter(function (t) { return !t.done && U.daysUntil(t.dueDate) === 0; });
        else if (filter === 'overdue') {
            tasks = tasks.filter(function (t) {
                const days = U.daysUntil(t.dueDate);
                return !t.done && days !== null && days < 0;
            });
        } else if (filter === 'upcoming') {
            tasks = tasks.filter(function (t) {
                const days = U.daysUntil(t.dueDate);
                return !t.done && days !== null && days > 0;
            });
        }

        // Bucket: overdue, today, this week, later, no date, done
        const buckets = [
            { id: 'overdue', label: 'Overdue', tone: 'var(--danger)' },
            { id: 'today', label: 'Today', tone: 'var(--warn)' },
            { id: 'week', label: 'This week', tone: 'var(--info)' },
            { id: 'later', label: 'Later', tone: 'var(--muted)' },
            { id: 'nodate', label: 'No due date', tone: 'var(--faint)' },
            { id: 'done', label: 'Completed', tone: 'var(--ok)' }
        ];

        function bucketOf(task) {
            if (task.done) return 'done';
            const days = U.daysUntil(task.dueDate);
            if (days === null || !task.dueDate) return 'nodate';
            if (days < 0) return 'overdue';
            if (days === 0) return 'today';
            if (days <= 7) return 'week';
            return 'later';
        }

        const head = U.el('div', { class: 'section-head' }, [
            U.el('h2', { class: 'section-title', text: 'Tasks' }),
            ui.seg(filters, filter, function (id) {
                ctx.app.taskFilter = id;
                ctx.refresh();
            }),
            U.el('div', { class: 'spacer' }),
            U.el('button', {
                class: 'btn btn-primary',
                onclick: function () { openEditor(null, ctx, 'task'); }
            }, [U.el('span', { text: '＋' }), U.el('span', { text: 'New task' })])
        ]);
        host.appendChild(head);

        if (!tasks.length) {
            host.appendChild(ui.emptyState(
                '📋',
                query ? 'No tasks match your search' : 'No tasks here',
                query ? 'Try a different search term.' : 'Create custom tasks and reminders — recurring chores, one-off errands, anything you want nudged about.',
                U.el('button', {
                    class: 'btn btn-primary', text: 'Create a task',
                    onclick: function () { openEditor(null, ctx, 'task'); }
                })
            ));
            return;
        }

        const panel = U.el('div', { class: 'panel' });
        let rendered = 0;
        buckets.forEach(function (bucket) {
            const items = tasks.filter(function (task) { return bucketOf(task) === bucket.id; });
            if (!items.length) return;
            rendered += 1;

            items.sort(function (a, b) {
                if (a.done !== b.done) return a.done ? 1 : -1;
                const pa = HM.model.PRIORITIES.findIndex(function (p) { return p.id === a.priority; });
                const pb = HM.model.PRIORITIES.findIndex(function (p) { return p.id === b.priority; });
                if (pa !== pb) return pb - pa;
                return (U.parseDate(a.dueDate) || 0) - (U.parseDate(b.dueDate) || 0);
            });

            panel.appendChild(U.el('div', { class: 'section-head', style: { marginTop: rendered === 1 ? '0' : '14px' } }, [
                U.el('h3', { class: 'section-title', style: { color: bucket.tone }, text: bucket.label }),
                U.el('span', { class: 'count', text: String(items.length) })
            ]));

            const list = U.el('div', { class: 'task-list' });
            items.forEach(function (task) { list.appendChild(taskRow(task, ctx)); });
            panel.appendChild(list);
        });

        host.appendChild(panel);
    }

    function taskRow(task, ctx) {
        const status = store().taskStatus(task);
        const repeat = HM.model.repeat(task.repeat);
        const checklist = task.checklist || [];
        const doneCount = checklist.filter(function (c) { return c.done; }).length;

        const checkbox = U.el('button', {
            class: `check${task.done ? ' checked' : ''}`,
            title: task.done ? 'Mark as not done' : 'Mark as done',
            text: '✓',
            onclick: async function (event) {
                event.stopPropagation();
                const updated = store().toggleTask(task.id);
                if (!updated) return;
                if (task.repeat && task.repeat !== 'none' && !updated.done) {
                    ui.toast('Nice work', `“${task.title}” rescheduled for ${U.fmtDate(updated.dueDate, 'long')}.`, 'ok');
                }
                // Keep the todo/done tag on the attached Eagle items in step
                // with the task, so the tags stay meaningful in Eagle itself.
                if ((updated.attachments || []).length) {
                    const moved = await HM.tags.syncState(updated);
                    if (moved) {
                        ui.toast(
                            'Eagle tags updated',
                            `${U.pluralize(moved, 'item')} retagged ${updated.done ? HM.tags.DONE : HM.tags.TODO}.`,
                            'info',
                            2600
                        );
                    }
                }
                ctx.refresh();
            }
        });

        const meta = U.el('div', { class: 'task-meta' }, [
            task.priority !== 'normal' ? priorityDot(task.priority) : null,
            task.dueDate ? U.el('span', { text: U.fmtDate(task.dueDate, 'medium') }) : U.el('span', { text: 'No due date' }),
            status.key !== 'done' && status.key !== 'nodate' && status.key !== 'later' ? pill(status) : null,
            task.repeat !== 'none' ? U.el('span', { class: 'tag', text: '↻ ' + repeat.label }) : null,
            checklist.length ? U.el('span', { class: 'tag', text: `☑ ${doneCount}/${checklist.length}` }) : null
        ]);

        const actions = U.el('div', { class: 'task-actions' }, [
            U.el('button', {
                class: 'btn btn-sm btn-ghost', text: '✎', title: 'Edit task',
                onclick: function (event) { event.stopPropagation(); openEditor(task, ctx); }
            })
        ]);
        attachActions(task, ctx, {
            onChange: function () { ctx.refresh(); }
        }).forEach(function (node) {
            node.classList.add('btn-ghost');
            actions.appendChild(node);
        });

        return U.el('div', {
            class: `task-row${task.done ? ' is-done' : ''}`,
            onclick: function () { openEditor(task, ctx); }
        }, [
            checkbox,
            U.el('div', { class: 'task-body' }, [
                U.el('div', { class: 'task-title', text: task.title || 'Untitled task' }),
                meta,
                ui.thumbStrip(task, ctx, { size: 40, limit: 6 })
            ]),
            actions
        ]);
    }

    /* =====================================================================
     * Water meters
     * =================================================================== */
    function renderWater(host, ctx) {
        const meters = store().meters();

        const head = U.el('div', { class: 'section-head' }, [
            U.el('h2', { class: 'section-title', text: 'Water meters' }),
            U.el('div', { class: 'spacer' }),
            U.el('button', {
                class: 'btn',
                onclick: function () { openEditor(null, ctx, 'meter'); }
            }, [U.el('span', { text: '＋' }), U.el('span', { text: 'Add meter' })])
        ]);
        host.appendChild(head);

        if (!meters.length) {
            host.appendChild(ui.emptyState(
                '💧',
                'No water meters yet',
                'Add a meter for each place you read one — the kitchen and the bathroom are the usual suspects. Home Manager tracks consumption between readings and reminds you when the next one is due.',
                U.el('button', {
                    class: 'btn btn-primary', text: 'Add a water meter',
                    onclick: function () { openEditor(null, ctx, 'meter'); }
                })
            ));
            return;
        }

        const grid = U.el('div', { class: 'meter-grid' });
        meters.forEach(function (meter) { grid.appendChild(meterCard(meter, ctx)); });
        host.appendChild(grid);
    }

    function meterCard(meter, ctx) {
        const status = store().meterStatus(meter);
        const latest = store().latestReading(meter);
        const rate = store().meterRate(meter);
        const cycleLabel = (HM.model.READING_CYCLES.find(function (c) { return c.id === meter.cycle; }) || { label: meter.cycle }).label;

        /* --- readouts --------------------------------------------------- */
        const readouts = U.el('div', { class: 'meter-readout' }, [
            U.el('div', { class: 'readout' }, [
                U.el('div', { class: 'readout-label', text: 'Latest reading' }),
                U.el('div', { class: 'readout-value' }, [
                    U.el('span', { text: latest && latest.value !== null ? U.fmtNumber(latest.value, 2) : '—' }),
                    U.el('small', { text: meter.unit })
                ]),
                U.el('div', {
                    class: 'readout-delta',
                    text: latest ? U.fmtDate(latest.reading.date, 'medium') : 'No readings logged'
                })
            ]),
            U.el('div', { class: 'readout' }, [
                U.el('div', { class: 'readout-label', text: 'Consumption' }),
                U.el('div', { class: 'readout-value' }, [
                    U.el('span', { text: latest && latest.consumption !== null ? U.fmtNumber(latest.consumption, 2) : '—' }),
                    U.el('small', { text: meter.unit })
                ]),
                U.el('div', {
                    class: `readout-delta${latest && latest.consumption !== null ? ' up' : ''}`,
                    text: rate
                        ? `${U.fmtNumber(rate.perDay, 3)} ${meter.unit}/day over ${rate.days} days`
                        : 'Since the previous reading'
                })
            ])
        ]);

        /* --- chart ------------------------------------------------------ */
        const series = meter.readings.map(function (reading, index) {
            return {
                label: U.fmtDate(reading.date, 'monthDay'),
                value: store().consumption(meter, index),
                date: reading.date
            };
        }).filter(function (point) { return point.value !== null; }).slice(-8);

        const chart = U.el('div');
        if (series.length) {
            const max = Math.max.apply(null, series.map(function (p) { return p.value; })) || 1;
            const chartNode = U.el('div', { class: 'chart' });
            series.forEach(function (point) {
                chartNode.appendChild(U.el('div', { class: 'chart-col', title: `${U.fmtDate(point.date, 'medium')}: ${U.fmtNumber(point.value, 2)} ${meter.unit}` }, [
                    U.el('div', { class: 'chart-value', text: U.fmtNumber(point.value, 1) }),
                    U.el('div', { class: 'chart-bar', style: { height: Math.max(4, Math.round((point.value / max) * 88)) + '%' } }),
                    U.el('div', { class: 'chart-label', text: point.label })
                ]));
            });
            chart.appendChild(chartNode);
        } else {
            chart.appendChild(U.el('div', { class: 'chart-empty', text: 'Log at least two readings to see consumption per period.' }));
        }

        /* --- log reading form ------------------------------------------- */
        const dateInput = ui.input({ type: 'date', value: U.todayISO() });
        const valueInput = ui.input({
            type: 'number', step: '0.01', placeholder: latest && latest.value !== null ? String(latest.value) : 'e.g. 1234.56'
        });
        const noteInput = ui.input({ type: 'text', placeholder: 'Optional note' });
        const consumptionHint = U.el('div', { class: 'hint' });

        function updateHint() {
            const previous = latest && latest.value !== null ? latest.value : null;
            const typed = U.num(valueInput.value);
            if (previous === null || typed === null) {
                consumptionHint.textContent = previous === null
                    ? 'This will be the starting reading for this meter.'
                    : `Previous reading: ${U.fmtNumber(previous, 2)} ${meter.unit}`;
                return;
            }
            const diff = typed - previous;
            consumptionHint.textContent = diff < 0
                ? 'Lower than the previous reading — that usually means the meter was replaced or reset.'
                : `Consumption since last reading: ${U.fmtNumber(diff, 2)} ${meter.unit}`;
        }
        valueInput.addEventListener('input', updateHint);
        updateHint();

        const form = U.el('div', { style: { marginTop: '16px' } }, [
            U.el('div', { class: 'lbl', text: 'Log a new reading' }),
            U.el('div', { class: 'field-row-3' }, [
                ui.field('Date', dateInput),
                ui.field('Reading', U.el('div', { class: 'input-group' }, [valueInput, U.el('span', { class: 'input-suffix', text: meter.unit })])),
                ui.field('Note', noteInput)
            ]),
            consumptionHint,
            U.el('div', { class: 'btn-row', style: { marginTop: '12px' } }, [
                U.el('button', {
                    class: 'btn btn-primary',
                    onclick: function () {
                        const value = U.num(valueInput.value);
                        if (value === null) {
                            ui.toast('Reading required', 'Enter the number shown on the meter.', 'warn');
                            valueInput.focus();
                            return;
                        }
                        const saved = store().addReading(meter.id, {
                            date: dateInput.value || U.todayISO(),
                            value: value,
                            note: noteInput.value.trim()
                        });
                        const refreshedMeter = store().getMeter(meter.id);
                        const index = refreshedMeter.readings.findIndex(function (r) { return r.id === saved.id; });
                        const consumed = store().consumption(refreshedMeter, index);
                        ui.toast(
                            'Reading logged',
                            consumed !== null
                                ? `${U.fmtNumber(consumed, 2)} ${meter.unit} used since the previous reading.`
                                : 'First reading stored — the next one will show consumption.',
                            'ok'
                        );
                        ctx.refresh();
                    }
                }, [U.el('span', { text: '＋' }), U.el('span', { text: 'Log reading' })])
            ])
        ]);

        /* --- history ---------------------------------------------------- */
        const history = U.el('div', { class: 'reading-list' });
        if (meter.readings.length) {
            meter.readings.slice().reverse().forEach(function (reading) {
                const index = meter.readings.findIndex(function (r) { return r.id === reading.id; });
                const consumed = store().consumption(meter, index);
                history.appendChild(U.el('div', { class: 'reading-row' }, [
                    U.el('span', { class: 'reading-date', text: U.fmtDate(reading.date, 'medium') }),
                    U.el('span', { class: 'reading-value', text: `${U.fmtNumber(reading.value, 2)} ${meter.unit}` }),
                    consumed !== null
                        ? U.el('span', { class: 'reading-consumption', text: `+${U.fmtNumber(consumed, 2)}` })
                        : U.el('span', { class: 'reading-consumption', style: { color: 'var(--faint)' }, text: 'first' }),
                    U.el('span', { class: 'reading-spacer' }),
                    reading.note ? U.el('span', { class: 'payment-for', text: reading.note }) : null,
                    U.el('button', {
                        class: 'btn btn-sm btn-ghost', text: '✎', title: 'Edit this reading',
                        onclick: function (event) {
                            event.stopPropagation();
                            editReading(meter, reading, ctx);
                        }
                    }),
                    U.el('button', {
                        class: 'btn btn-sm btn-ghost', text: '✕', title: 'Delete this reading',
                        onclick: async function (event) {
                            event.stopPropagation();
                            const ok = await ui.confirmDialog({
                                title: 'Delete reading?',
                                message: `Remove the reading from ${U.fmtDate(reading.date, 'long')}?`,
                                detail: 'Consumption for the following reading will be recalculated.',
                                confirmLabel: 'Delete',
                                danger: true
                            });
                            if (!ok) return;
                            store().removeReading(meter.id, reading.id);
                            ui.toast('Reading deleted', '', 'info');
                            ctx.refresh();
                        }
                    })
                ]));
            });
        } else {
            history.appendChild(U.el('div', { class: 'panel-hint', text: 'No readings yet.' }));
        }

        return U.el('div', { class: 'meter-card' }, [
            U.el('div', { class: 'meter-head' }, [
                U.el('div', { class: 'meter-icon', text: meter.icon || '🚰' }),
                U.el('div', { style: { flex: '1', minWidth: '0' } }, [
                    U.el('div', { class: 'meter-name', text: `${meter.room} water meter` }),
                    U.el('div', { class: 'meter-sub', text: `Next reading ${U.fmtDate(meter.nextDue, 'long')} · ${cycleLabel}` })
                ]),
                pill(status),
                U.el('button', {
                    class: 'btn btn-sm btn-ghost', text: '✎', title: 'Edit meter settings',
                    onclick: function () { openEditor(meter, ctx); }
                })
            ]),

            readouts,
            chart,
            form,

            U.el('div', { class: 'lbl', style: { marginTop: '18px' }, text: `Reading history · ${meter.readings.length}` }),
            history,

            U.el('div', { style: { marginTop: '16px' } }, [
                ui.attachmentStrip({
                    record: meter,
                    onChange: function () { ctx.refresh(); }
                })
            ])
        ]);
    }

    function editReading(meter, reading, ctx) {
        const dateInput = ui.input({ type: 'date', value: reading.date, 'data-autofocus': 'true' });
        const valueInput = ui.input({ type: 'number', step: '0.01', value: reading.value === null ? '' : String(reading.value) });
        const noteInput = ui.input({ type: 'text', value: reading.note || '' });

        // Attachments live on the reading itself. Refresh only the strip so the
        // date / value / note being edited are not discarded.
        const attachHost = U.el('div');
        const renderAttachments = function () {
            attachHost.innerHTML = '';
            attachHost.appendChild(ui.attachmentStrip({
                record: reading,
                meterId: meter.id,
                readingId: reading.id,
                onChange: renderAttachments
            }));
        };
        renderAttachments();

        ui.openModal({
            title: 'Edit reading',
            narrow: true,
            body: [
                U.el('p', { style: { margin: '0 0 14px', color: 'var(--muted)' }, text: `${meter.room} water meter` }),
                ui.field('Date', dateInput),
                ui.field('Reading', U.el('div', { class: 'input-group' }, [
                    valueInput, U.el('span', { class: 'input-suffix', text: meter.unit })
                ])),
                ui.field('Note', noteInput),
                attachHost
            ],
            footer: [
                U.el('div', { class: 'spacer' }),
                U.el('button', { class: 'btn', text: 'Cancel', onclick: function () { ui.closeModal(); } }),
                U.el('button', {
                    class: 'btn btn-primary', text: 'Save',
                    onclick: function () {
                        store().updateReading(meter.id, reading.id, {
                            date: dateInput.value || reading.date,
                            value: U.num(valueInput.value, reading.value),
                            note: noteInput.value.trim()
                        });
                        ui.closeModal();
                        ui.toast('Reading updated', '', 'ok');
                        ctx.refresh();
                    }
                })
            ]
        });
    }

    /* =====================================================================
     * Reminders
     * =================================================================== */
    function renderReminders(host, ctx) {
        const settings = store().state.settings;
        const alerts = store().alerts();
        const now = new Date();

        host.appendChild(ui.notice(
            `Reminders fire at ${settings.remindTime} on the day you choose, ${settings.remindDaysBefore} day${settings.remindDaysBefore === 1 ? '' : 's'} before a due date unless a record overrides it. While this window is open Home Manager also posts a desktop notification.`,
            '', '⏰'
        ));

        const groups = [
            { id: 'overdue', label: 'Overdue', tone: 'var(--danger)', filter: (a) => a.status.key === 'overdue' },
            { id: 'today', label: 'Today', tone: 'var(--warn)', filter: (a) => a.status.key === 'today' },
            { id: 'week', label: 'Next 7 days', tone: 'var(--info)', filter: (a) => { const d = U.daysUntil(a.due); return d !== null && d > 0 && d <= 7; } },
            { id: 'month', label: 'Next 30 days', tone: 'var(--muted)', filter: (a) => { const d = U.daysUntil(a.due); return d !== null && d > 7 && d <= 30; } },
            { id: 'later', label: 'Later', tone: 'var(--faint)', filter: (a) => { const d = U.daysUntil(a.due); return d !== null && d > 30; } }
        ];

        let total = 0;
        groups.forEach(function (group) {
            const items = alerts.filter(group.filter);
            if (!items.length) return;
            total += items.length;

            host.appendChild(U.el('div', { class: 'section-head' }, [
                U.el('h2', { class: 'section-title', style: { color: group.tone }, text: group.label }),
                U.el('span', { class: 'count', text: String(items.length) })
            ]));

            const panel = U.el('div', { class: 'panel' });
            const list = U.el('div', { class: 'timeline' });
            items.forEach(function (alert) {
                const record = alert.record;
                const reminder = store().reminderAt(record);
                const row = timelineRow(alert, ctx);

                const right = row.querySelector('.timeline-right');
                if (reminder) {
                    const fired = reminder <= now;
                    right.insertBefore(U.el('span', {
                        class: `pill pill-${fired ? alert.status.tone : 'later'}`,
                        title: `Reminder ${fired ? 'sent' : 'scheduled'} for ${U.fmtDateTime(U.toISODateTime(reminder))}`,
                        text: fired ? '🔔 sent' : `🔔 ${U.fmtDate(U.toISODate(reminder), 'monthDay')}`
                    }), right.firstChild);
                }
                list.appendChild(row);
            });
            panel.appendChild(list);
            host.appendChild(panel);
        });

        if (!total) {
            host.appendChild(ui.emptyState(
                '🌤',
                'Nothing on the horizon',
                'No bills, tasks or meter readings are waiting. Enjoy the quiet — or add something new.',
                U.el('div', { class: 'btn-row', style: { justifyContent: 'center' } }, [
                    U.el('button', {
                        class: 'btn btn-primary', text: 'New bill',
                        onclick: function () { openEditor(null, ctx, 'bill'); }
                    }),
                    U.el('button', {
                        class: 'btn', text: 'New task',
                        onclick: function () { openEditor(null, ctx, 'task'); }
                    })
                ])
            ));
        }
    }

    /* =====================================================================
     * Attachments browser
     * =================================================================== */
    function renderAttached(host, ctx) {
        const attachments = store().allAttachments();
        const query = ctx.app.search.toLowerCase();

        const filtered = query
            ? attachments.filter(function (att) {
                return [att.name, att.ownerLabel, att.ext].join(' ').toLowerCase().indexOf(query) !== -1;
            })
            : attachments;

        host.appendChild(U.el('div', { class: 'section-head' }, [
            U.el('h2', { class: 'section-title', text: 'Attached Eagle items' }),
            U.el('span', { class: 'count', text: String(filtered.length) }),
            U.el('div', { class: 'spacer' }),
            U.el('span', { class: 'panel-hint', text: 'Images linked from your Eagle library' })
        ]));

        if (!filtered.length) {
            host.appendChild(ui.emptyState(
                '🖼',
                query ? 'No attached items match' : 'No attachments yet',
                query
                    ? 'Try a different search term.'
                    : 'Attach photos of a bill, a meter reading or a receipt straight from your Eagle library — open any bill, task or meter and click “From Eagle”.'
            ));
            return;
        }

        const grid = U.el('div', { class: 'item-grid' });
        filtered.forEach(function (att) {
            const inOtherLibrary = att.libraryPath && HM.bridge.library.path && att.libraryPath !== HM.bridge.library.path;
            const tile = U.el('div', {
                class: 'item-tile',
                title: `${att.name}\n${att.ownerLabel}\nClick to open in Eagle`,
                onclick: function () { HM.bridge.openItem(att.itemId, { window: false }); }
            }, [
                U.el('div', { class: 'tile-fallback', text: inOtherLibrary ? '🔒' : '🖼' }),
                U.el('div', { class: 'tile-name', text: `${att.name} · ${att.ownerLabel}` })
            ]);
            grid.appendChild(tile);
            const imageHost = tile.firstChild;
            ui.thumb(att.itemId).then(function (url) {
                if (!tile.isConnected) return;
                if (url) imageHost.replaceWith(U.el('img', { src: url, alt: att.name, loading: 'lazy' }));
                else imageHost.textContent = inOtherLibrary ? '🔒' : '🖼';
            });
        });
        host.appendChild(grid);
    }

    /* =====================================================================
     * Settings
     * =================================================================== */
    function renderSettings(host, ctx) {
        const settings = store().state.settings;
        const info = HM.bridge.appInfo();
        const library = HM.bridge.library;

        const apply = function (patch) {
            Object.assign(store().state.settings, patch);
            store().saveSoon();
        };

        /* --- money & reminders ---------------------------------------- */
        const currencyInput = ui.input({
            type: 'text', value: settings.currency, maxlength: '8',
            oninput: function (event) { apply({ currency: event.target.value }); ctx.refreshSoft(); }
        });
        const leadInput = ui.input({
            type: 'number', min: '0', max: '60', value: String(settings.remindDaysBefore),
            onchange: function (event) { apply({ remindDaysBefore: U.clamp(Number(event.target.value) || 0, 0, 60) }); ui.toast('Saved', 'Default reminder lead time updated.', 'ok'); }
        });
        const timeInput = ui.input({
            type: 'time', value: settings.remindTime,
            onchange: function (event) { apply({ remindTime: event.target.value || '09:00' }); ui.toast('Saved', 'Reminder time updated.', 'ok'); }
        });

        host.appendChild(U.el('div', { class: 'section-head' }, [U.el('h2', { class: 'section-title', text: 'Money & reminders' })]));
        host.appendChild(U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'field-row' }, [
                ui.field('Currency symbol or code', currencyInput, 'Use a symbol (€, $, £) or a three-letter code (EUR, USD).'),
                ui.field('Remind me this many days before', leadInput, 'Individual records can override this.')
            ]),
            U.el('div', { class: 'field-row' }, [
                ui.field('Reminder time of day', timeInput, 'Notifications appear at this time.')
            ])
        ]));

        /* --- notifications --------------------------------------------- */
        const notifyPanel = U.el('div', { class: 'panel' });
        notifyPanel.appendChild(U.el('div', { class: 'panel-head' }, [
            U.el('h3', { class: 'panel-title', text: 'Notifications' }),
            U.el('div', { class: 'spacer' }),
            U.el('button', {
                class: 'btn btn-sm', text: '🔔 Send a test',
                onclick: async function () {
                    const ok = await HM.bridge.notify('Home Manager', 'This is what a reminder looks like.', { duration: 5000 });
                    if (!ok) ui.toast('Notifications unavailable', 'Eagle’s notification API is not reachable in this environment.', 'warn');
                }
            })
        ]));
        notifyPanel.appendChild(ui.switchRow('Bills', 'Notify me before a bill is due and while it is overdue.', settings.notifyBills, function (value) { apply({ notifyBills: value }); }));
        notifyPanel.appendChild(ui.switchRow('Tasks', 'Notify me about tasks with a due date or an explicit reminder.', settings.notifyTasks, function (value) { apply({ notifyTasks: value }); }));
        notifyPanel.appendChild(ui.switchRow('Water meter readings', 'Notify me when the next reading is due.', settings.notifyMeters, function (value) { apply({ notifyMeters: value }); }));
        notifyPanel.appendChild(ui.switchRow('Play a sound with notifications', 'Turn off for silent reminders.', settings.sound, function (value) { apply({ sound: value }); }));
        host.appendChild(notifyPanel);

        /* --- Eagle tags ----------------------------------------------- */
        const tagStats = HM.tags.stats();
        const tagPanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [
                U.el('h3', { class: 'panel-title', text: '🏷 Eagle tags' }),
                U.el('div', { class: 'spacer' }),
                U.el('button', {
                    class: 'btn btn-sm', text: '🔄 Sync from Eagle',
                    onclick: function () { syncTags(ctx); }
                })
            ]),
            ui.notice(
                'Attachments live in Eagle\'s tag system. Each record owns a tag like '
                + '`hm:t7` (t = task, b = bill, m = meter) and its attached items carry '
                + 'that tag plus `hm:todo` or `hm:done`. Search `hm:` in Eagle\'s search bar '
                + 'to find everything Home Manager tracks, and the links are rebuilt from '
                + 'those tags every time this plugin loads.',
                '', '🏷'
            ),
            U.el('dl', { class: 'kv', style: { marginTop: '14px' } }, [
                U.el('dt', { text: 'Records with tags' }), U.el('dd', { text: `${tagStats.taggedRecords} of ${tagStats.records}` }),
                U.el('dt', { text: 'Attached items' }), U.el('dd', { text: String(tagStats.attachments) }),
                U.el('dt', { text: 'Tagged in Eagle' }), U.el('dd', { text: String(tagStats.tagged) }),
                U.el('dt', { text: 'Not yet tagged' }), U.el('dd', {
                    text: tagStats.untagged
                        ? `${tagStats.untagged} — usually items belonging to another Eagle library; open that library and sync`
                        : 'none'
                }),
                U.el('dt', { text: 'Next tag code' }), U.el('dd', { text: `hm:*${tagStats.nextCode + 1}` })
            ]),
            ui.switchRow(
                'Re-sync tags every time the plugin opens',
                'Reads hm: tags back from Eagle on load and adopts any item it finds there.',
                settings.syncTagsOnLoad,
                function (value) { apply({ syncTagsOnLoad: value }); }
            ),
            ui.switchRow(
                'Keep the due-date rollover on payment',
                'When a repeating bill is marked paid, move it to the next period instead of just flagging it paid.',
                settings.markPaidRollsForward,
                function (value) { apply({ markPaidRollsForward: value }); }
            )
        ]);
        host.appendChild(tagPanel);

        /* --- water meters setup --------------------------------------- */
        const meterPanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [
                U.el('h3', { class: 'panel-title', text: 'Water meters' }),
                U.el('div', { class: 'spacer' }),
                U.el('button', {
                    class: 'btn btn-sm btn-primary', text: '＋ Add meter',
                    onclick: function () { openEditor(null, ctx, 'meter'); }
                })
            ])
        ]);
        if (store().meters().length) {
            store().meters().forEach(function (meter) {
                meterPanel.appendChild(U.el('div', { class: 'switch-row' }, [
                    U.el('div', { class: 'switch-text' }, [
                        U.el('div', { class: 'switch-title', text: `${meter.icon || '🚰'} ${meter.room}` }),
                        U.el('div', { class: 'switch-desc', text: `${meter.unit} · next ${U.fmtDate(meter.nextDue, 'medium')} · ${U.pluralize(meter.readings.length, 'reading')}` })
                    ]),
                    U.el('button', {
                        class: 'btn btn-sm', text: 'Edit',
                        onclick: function () { openEditor(meter, ctx); }
                    })
                ]));
            });
        } else {
            meterPanel.appendChild(U.el('p', { class: 'panel-hint', text: 'No meters yet.' }));
        }
        host.appendChild(meterPanel);

        /* --- library & app info --------------------------------------- */
        const libraryPanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [U.el('h3', { class: 'panel-title', text: 'Eagle' })]),
            U.el('dl', { class: 'kv' }, [
                U.el('dt', { text: 'Library' }), U.el('dd', { text: library.name || '—' }),
                U.el('dt', { text: 'Path' }), U.el('dd', { text: library.path || '—' }),
                U.el('dt', { text: 'Items' }), U.el('dd', { text: ctx.libraryCount === null || ctx.libraryCount === undefined ? '…' : U.fmtNumber(ctx.libraryCount, 0) }),
                U.el('dt', { text: 'Folders' }), U.el('dd', { text: String(HM.bridge.folders.length) }),
                U.el('dt', { text: 'Eagle' }), U.el('dd', { text: info.version ? `${info.version}${info.build ? ' (build ' + info.build + ')' : ''}` : 'Not running in Eagle' }),
                U.el('dt', { text: 'Plugin' }), U.el('dd', { text: `${(HM.bridge.manifest && HM.bridge.manifest.name) || 'Home Manager'} v${(HM.bridge.manifest && HM.bridge.manifest.version) || '1.0.0'}` }),
                U.el('dt', { text: 'API ready' }), U.el('dd', {
                    text: HM.bridge.isAvailable()
                        ? 'yes — Eagle API is usable'
                        : (HM.bridge.hasHost() ? 'waiting for Eagle’s plugin-create event…' : 'no Eagle host (preview mode)')
                }),
                U.el('dt', { text: 'Data file' }), U.el('dd', { text: store().dataPath || `localStorage (${store().backend})` })
            ]),
            U.el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
                U.el('button', {
                    class: 'btn', text: '🔄 Refresh library info',
                    onclick: async function () {
                        await HM.bridge.refreshLibrary();
                        ctx.libraryCount = await HM.bridge.countAll();
                        ui.clearThumbCache();
                        ctx.refresh();
                        ui.toast('Refreshed', 'Eagle library information reloaded.', 'ok');
                    }
                }),
                U.el('button', {
                    class: 'btn', text: '🧹 Clear thumbnail cache',
                    onclick: function () { ui.clearThumbCache(); ui.toast('Cache cleared', 'Thumbnails will be re-read on demand.', 'ok'); }
                })
            ])
        ]);
        host.appendChild(libraryPanel);

        /* --- data management ------------------------------------------ */
        const dataPanel = U.el('div', { class: 'panel' }, [
            U.el('div', { class: 'panel-head' }, [
                U.el('h3', { class: 'panel-title', text: 'Your data' }),
                U.el('div', { class: 'spacer' }),
                U.el('span', { class: 'panel-hint', text: `${U.pluralize(store().bills().length, 'bill')} · ${U.pluralize(store().tasks().length, 'task')} · ${U.pluralize(store().meters().length, 'meter')}` })
            ]),
            ui.notice(`Everything is stored locally in ${store().dataPath || 'this browser profile'}. Nothing is uploaded anywhere.`),
            U.el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
                U.el('button', {
                    class: 'btn', text: '⬇️ Export backup',
                    onclick: async function () {
                        const stamp = U.todayISO();
                        const name = `home-manager-backup-${stamp}.json`;
                        const target = await HM.bridge.saveFileDialog(name, [{ name: 'JSON', extensions: ['json'] }]);
                        if (!target) return;
                        try {
                            const fs = require('fs');
                            fs.writeFileSync(target, store().toJSON(), 'utf8');
                            ui.toast('Backup saved', target, 'ok');
                        } catch (err) {
                            ui.toast('Export failed', (err && err.message) || 'Unknown error.', 'err');
                        }
                    }
                }),
                U.el('button', {
                    class: 'btn', text: '⬆️ Import backup',
                    onclick: async function () {
                        const filePath = await HM.bridge.openFileDialog([{ name: 'JSON', extensions: ['json'] }]);
                        if (!filePath) return;
                        const ok = await ui.confirmDialog({
                            title: 'Replace your data?',
                            message: 'Importing a backup replaces every bill, task and meter currently stored.',
                            detail: filePath,
                            confirmLabel: 'Import and replace',
                            danger: true
                        });
                        if (!ok) return;
                        try {
                            const text = HM.bridge.readTextFile(filePath);
                            store().fromJSON(text);
                            ui.clearThumbCache();
                            ctx.refresh();
                            ui.toast('Backup imported', 'Your data has been restored.', 'ok');
                        } catch (err) {
                            ui.toast('Import failed', (err && err.message) || 'That file could not be read.', 'err');
                        }
                    }
                }),
                U.el('button', {
                    class: 'btn btn-danger', text: '🗑 Reset everything',
                    onclick: async function () {
                        const ok = await ui.confirmDialog({
                            title: 'Delete all Home Manager data?',
                            message: 'This removes every bill, task, meter and reading you have stored here.',
                            detail: 'Image items already published to Eagle are not touched. This cannot be undone.',
                            confirmLabel: 'Delete everything',
                            danger: true
                        });
                        if (!ok) return;
                        store().reset(true);
                        ui.clearThumbCache();
                        ctx.refresh();
                        ui.toast('Data cleared', 'Home Manager is empty again.', 'ok');
                    }
                }),
                U.el('button', {
                    class: 'btn', text: '🌱 Load example data',
                    onclick: async function () {
                        const ok = await ui.confirmDialog({
                            title: 'Load example data?',
                            message: 'Adds an electricity bill, a gas bill, two water meters and two starter tasks.',
                            detail: 'Your existing records are kept.',
                            confirmLabel: 'Add examples'
                        });
                        if (!ok) return;
                        const snapshot = JSON.parse(JSON.stringify(store().state));
                        HM.model.seedState(store().state);
                        store().state.items = snapshot.items.concat(store().state.items.slice(snapshot.items.length));
                        store().state.meters = snapshot.meters.concat(store().state.meters.slice(snapshot.meters.length));
                        await store().save();
                        ctx.refresh();
                        ui.toast('Examples added', 'Have a look around.', 'ok');
                    }
                })
            ])
        ]);
        host.appendChild(dataPanel);

        host.appendChild(U.el('p', {
            class: 'panel-hint',
            style: { textAlign: 'center', marginTop: '22px' },
            text: 'Home Manager · a todo, bills and water-meter plugin for Eagle. Built with the Eagle Plugin API.'
        }));
    }

    /* =====================================================================
     * Editors (drawer)
     * =================================================================== */
    function openEditor(record, ctx, newKind) {
        const isNew = !record;
        const draft = record
            ? JSON.parse(JSON.stringify(record))
            : (newKind === 'bill' ? HM.model.newBill({ title: '' })
                : newKind === 'meter' ? HM.model.newMeter({ room: 'Kitchen' })
                    : HM.model.newTask({ title: '' }));

        const kind = draft.kind;
        const eyebrow = isNew ? 'New' : (kind === 'bill' ? 'Bill' : kind === 'meter' ? 'Water meter' : 'Task');

        const body = [];
        const rerender = function () {
            // Rebuild the drawer for changes that alter the visible form shape.
            openEditor(isNew ? null : store().get(draft.id) || draft, ctx, isNew ? kind : undefined);
        };

        /* --- common: title -------------------------------------------- */
        const titleInput = ui.input({
            type: 'text', value: draft.title || (kind === 'meter' ? '' : ''),
            placeholder: kind === 'bill' ? 'Electricity bill' : kind === 'meter' ? 'Meter name' : 'What needs doing?',
            'data-autofocus': isNew ? 'true' : null
        });

        if (kind === 'meter') {
            const roomInput = ui.input({ type: 'text', value: draft.room || '' });
            const iconInput = ui.input({ type: 'text', value: draft.icon || '🚰', maxlength: '4', style: { textAlign: 'center', fontSize: '18px' } });
            const unitInput = ui.input({ type: 'text', value: draft.unit || 'm³' });
            body.push(U.el('div', { class: 'field-row-3' }, [
                ui.field('Room / location', roomInput),
                ui.field('Icon', iconInput),
                ui.field('Unit', unitInput)
            ]));
            draft.__roomInput = roomInput;
            draft.__iconInput = iconInput;
            draft.__unitInput = unitInput;
        } else {
            body.push(ui.field(kind === 'bill' ? 'Bill name' : 'Task', titleInput));
        }

        /* --- kind specific fields -------------------------------------- */
        if (kind === 'bill') {
            const categorySelect = ui.select(
                HM.model.BILL_CATEGORIES.map(function (c) { return { value: c.id, label: `${c.icon}  ${c.label}` }; }),
                draft.category,
                { onchange: function () { /* read on save */ } }
            );
            const providerInput = ui.input({ type: 'text', value: draft.provider || '', placeholder: 'Company name' });
            const accountInput = ui.input({ type: 'text', value: draft.accountNumber || '', placeholder: 'Customer / account number' });
            const amountInput = ui.input({ type: 'number', step: '0.01', value: draft.amount === null || draft.amount === undefined ? '' : String(draft.amount), placeholder: '0.00' });
            const currencyInput = ui.input({ type: 'text', value: draft.currency || '', placeholder: store().state.settings.currency, maxlength: '8' });
            const consumptionInput = ui.input({ type: 'number', step: '0.01', value: draft.consumption === null || draft.consumption === undefined ? '' : String(draft.consumption), placeholder: 'optional' });
            const unitInput = ui.input({ type: 'text', value: draft.consumptionUnit || '', placeholder: 'kWh' });
            const dueInput = ui.input({ type: 'date', value: draft.dueDate || U.todayISO() });
            const repeatSelect = ui.select(
                HM.model.REPEATS.map(function (r) { return { value: r.id, label: r.label }; }),
                draft.repeat
            );

            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Category', categorySelect),
                ui.field('Provider', providerInput)
            ]));
            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Amount', U.el('div', { class: 'input-group' }, [amountInput, U.el('span', { class: 'input-suffix', text: store().state.settings.currency })])),
                ui.field('Currency override', currencyInput, 'Leave empty to use the global currency.')
            ]));
            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Due date', dueInput),
                ui.field('Repeats', repeatSelect)
            ]));
            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Metered usage', U.el('div', { class: 'input-group' }, [consumptionInput, U.el('span', { class: 'input-suffix', text: 'unit' })])),
                ui.field('Usage unit', unitInput, 'e.g. kWh for electricity, m³ for gas.')
            ]));
            body.push(ui.field('Account number', accountInput));

            draft.__bind = function () {
                return {
                    title: titleInput.value.trim() || 'Untitled bill',
                    category: categorySelect.value,
                    provider: providerInput.value.trim(),
                    accountNumber: accountInput.value.trim(),
                    amount: U.num(amountInput.value),
                    currency: currencyInput.value.trim(),
                    consumption: U.num(consumptionInput.value),
                    consumptionUnit: unitInput.value.trim(),
                    dueDate: dueInput.value || U.todayISO(),
                    repeat: repeatSelect.value
                };
            };
        }

        if (kind === 'task') {
            const dueInput = ui.input({ type: 'date', value: draft.dueDate || '' });
            const repeatSelect = ui.select(
                HM.model.REPEATS.map(function (r) { return { value: r.id, label: r.label }; }),
                draft.repeat
            );
            const prioritySelect = ui.select(
                HM.model.PRIORITIES.map(function (p) { return { value: p.id, label: p.label }; }),
                draft.priority
            );
            const categoryInput = ui.input({ type: 'text', value: draft.category || '', placeholder: 'home, maintenance, safety…' });

            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Due date', dueInput),
                ui.field('Repeats', repeatSelect)
            ]));
            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Priority', prioritySelect),
                ui.field('Category', categoryInput)
            ]));

            // Checklist
            const checklistHost = U.el('div', { class: 'checklist' });
            const renderChecklist = function () {
                checklistHost.innerHTML = '';
                (draft.checklist || []).forEach(function (entry, index) {
                    checklistHost.appendChild(U.el('div', { class: `checklist-row${entry.done ? ' done' : ''}` }, [
                        U.el('button', {
                            class: `check${entry.done ? ' checked' : ''}`, text: '✓',
                            onclick: function () {
                                draft.checklist[index].done = !draft.checklist[index].done;
                                renderChecklist();
                            }
                        }),
                        U.el('span', { text: entry.text }),
                        U.el('button', {
                            class: 'btn btn-sm btn-ghost', text: '✕',
                            onclick: function () {
                                draft.checklist.splice(index, 1);
                                renderChecklist();
                            }
                        })
                    ]));
                });
                if (!draft.checklist || !draft.checklist.length) {
                    checklistHost.appendChild(U.el('div', { class: 'panel-hint', text: 'No steps yet.' }));
                }
            };
            renderChecklist();

            const newStepInput = ui.input({ type: 'text', placeholder: 'Add a step and press Enter' });
            newStepInput.addEventListener('keydown', function (event) {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const text = newStepInput.value.trim();
                if (!text) return;
                draft.checklist = draft.checklist || [];
                draft.checklist.push({ text: text, done: false });
                newStepInput.value = '';
                renderChecklist();
            });

            body.push(ui.field('Checklist', U.el('div', {}, [
                checklistHost,
                U.el('div', { style: { marginTop: '8px' } }, [newStepInput])
            ])));

            draft.__bind = function () {
                return {
                    title: titleInput.value.trim() || 'Untitled task',
                    dueDate: dueInput.value || '',
                    repeat: repeatSelect.value,
                    priority: prioritySelect.value,
                    category: categoryInput.value.trim(),
                    checklist: draft.checklist || []
                };
            };
        }

        if (kind === 'meter') {
            const cycleSelect = ui.select(
                HM.model.READING_CYCLES.map(function (c) { return { value: c.id, label: c.label }; }),
                draft.cycle
            );
            const customDays = ui.input({ type: 'number', min: '1', max: '3650', value: draft.customCycleDays ? String(draft.customCycleDays) : '' });
            const nextDueInput = ui.input({ type: 'date', value: draft.nextDue || U.addDays(U.todayISO(), 30) });

            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Reading cycle', cycleSelect),
                ui.field('Next reading due', nextDueInput)
            ]));
            body.push(U.el('div', { class: 'field-row' }, [
                ui.field('Custom interval (days)', customDays, 'Only used when the cycle is “Custom interval”.'),
                ui.field('Name (optional)', ui.input({ type: 'text', value: draft.room || '', placeholder: 'Kitchen' }))
            ]));

            draft.__bind = function () {
                return {
                    room: (draft.__roomInput && draft.__roomInput.value.trim()) || 'Meter',
                    icon: (draft.__iconInput && draft.__iconInput.value.trim()) || '🚰',
                    unit: (draft.__unitInput && draft.__unitInput.value.trim()) || 'm³',
                    cycle: cycleSelect.value,
                    customCycleDays: U.num(customDays.value),
                    nextDue: nextDueInput.value || U.addDays(U.todayISO(), 30)
                };
            };
        }

        /* --- reminders & notes ----------------------------------------- */
        const remindAtInput = ui.input({
            type: 'datetime-local', value: draft.remindAt || '',
            onchange: function () { /* read on save */ }
        });
        const remindLeadInput = ui.input({
            type: 'number', min: '0', max: '60',
            value: draft.remindDaysBefore === null || draft.remindDaysBefore === undefined ? '' : String(draft.remindDaysBefore),
            placeholder: `default (${store().state.settings.remindDaysBefore})`
        });
        const prioritySelectShared = kind === 'bill' ? ui.select(
            HM.model.PRIORITIES.map(function (p) { return { value: p.id, label: p.label }; }),
            draft.priority
        ) : null;
        const notesInput = ui.textarea({ rows: '3', placeholder: 'Anything worth remembering…' });
        notesInput.value = draft.notes || '';

        const reminderSection = U.el('div', { style: { marginTop: '18px' } }, [
            U.el('div', { class: 'lbl', text: 'Reminder' }),
            U.el('div', { class: 'field-row' }, [
                ui.field('Exact reminder', remindAtInput, 'Overrides the lead-time rule below.'),
                ui.field('Days before due', remindLeadInput, 'Empty uses the global default.')
            ])
        ]);

        if (prioritySelectShared) {
            reminderSection.appendChild(ui.field('Priority', prioritySelectShared));
        }

        if (kind !== 'bill') {
            reminderSection.appendChild(ui.field('Notes', notesInput));
        } else {
            reminderSection.appendChild(ui.field('Notes', notesInput));
        }

        body.push(reminderSection);

        /* --- attachments ------------------------------------------------ */
        // `draft` is a clone used for form binding, but attachments must be
        // written to the *stored* record or they would be thrown away on the
        // next render. For an unsaved record the draft is the only home they
        // have, and collectDraft() carries them over on create.
        const attachmentTarget = isNew ? draft : (store().get(draft.id) || draft);
        const attachHost = U.el('div', { style: { marginTop: '6px' } });
        const renderAttachments = function () {
            // Rebuild only the strip, so anything typed into the form survives.
            attachHost.innerHTML = '';
            attachHost.appendChild(ui.attachmentStrip({
                record: attachmentTarget,
                onChange: renderAttachments
            }));
        };
        renderAttachments();
        body.push(attachHost);

        /* --- paid history ---------------------------------------------- */
        if (kind === 'bill' && (draft.payments || []).length) {
            const historyPanel = U.el('div', { class: 'panel', style: { marginTop: '16px' } });
            historyPanel.appendChild(U.el('div', { class: 'section-head', style: { marginTop: '0' } }, [
                U.el('h3', { class: 'section-title', text: 'Payment history' }),
                U.el('span', { class: 'count', text: String(draft.payments.length) })
            ]));
            draft.payments.slice(0, 12).forEach(function (payment) {
                historyPanel.appendChild(U.el('div', { class: 'payment-row' }, [
                    U.el('span', { class: 'payment-amount', text: U.fmtMoney(payment.amount, draft.currency || store().state.settings.currency) }),
                    U.el('span', { class: 'payment-date', text: U.fmtDate(U.localDateOf(payment.paidAt), 'medium') }),
                    U.el('span', { style: { flex: '1' } }),
                    U.el('span', { class: 'payment-for', text: payment.note || `for ${U.fmtDate(payment.forDueDate, 'medium')}` })
                ]));
            });
            body.push(historyPanel);
        }

        /* --- footer actions -------------------------------------------- */
        const footer = [];
        if (!isNew) {
            footer.push(U.el('button', {
                class: 'btn btn-danger btn-sm', text: '🗑 Delete',
                onclick: async function () {
                    const ok = await ui.confirmDialog({
                        title: `Delete this ${kind}?`,
                        message: `“${draft.title || draft.room}” will be removed from Home Manager.`,
                        detail: 'Image items already published to Eagle stay in your library.',
                        confirmLabel: 'Delete',
                        danger: true
                    });
                    if (!ok) return;
                    store().remove(draft.id);
                    ui.closeDrawer();
                    ui.toast('Deleted', '', 'info');
                    ctx.refresh();
                }
            }));
        }

        footer.push(U.el('div', { class: 'spacer' }));

        if (kind === 'bill' && !isNew && !draft.paid) {
            footer.push(U.el('button', {
                class: 'btn btn-ok btn-sm', text: '✓ Mark paid',
                onclick: function () { ui.closeDrawer(); markPaid(draft, ctx); }
            }));
        }
        if (kind === 'task' && !isNew) {
            footer.push(U.el('button', {
                class: 'btn btn-sm', text: draft.done ? '↩ Reopen' : '✓ Complete',
                onclick: function () {
                    store().toggleTask(draft.id);
                    ctx.refresh();
                    ui.closeDrawer();
                }
            }));
        }

        footer.push(U.el('button', {
            class: 'btn', text: 'Cancel',
            onclick: function () { ui.closeDrawer(); }
        }));

        footer.push(U.el('button', {
            class: 'btn btn-primary', text: isNew ? 'Create' : 'Save changes',
            onclick: async function () {
                const saved = collectDraft(draft, isNew);
                ui.closeDrawer();
                ctx.refresh();
                ui.toast(isNew ? 'Created' : 'Saved', saved.title || saved.room || '', 'ok');
            }
        }));

        function collectDraft(base, creating) {
            const patch = base.__bind ? base.__bind() : { title: titleInput.value.trim() || base.title || 'Untitled' };
            patch.remindAt = remindAtInput.value || '';
            patch.remindDaysBefore = remindLeadInput.value === '' ? null : U.clamp(Number(remindLeadInput.value) || 0, 0, 60);
            patch.notes = notesInput.value.trim();
            if (prioritySelectShared) patch.priority = prioritySelectShared.value;

            // A tag code may already have been allocated for a new record if
            // Eagle items were attached before the first save. It must be
            // carried across, or the record forgets which hm: tag is its own and
            // that tag can never be removed again.
            patch.tagCode = base.tagCode || 0;

            if (creating) {
                const created = store().add(Object.assign({ kind: base.kind }, patch));
                // Carry over any attachments picked before the first save,
                // including the tag each one was stamped with.
                if (base.attachments && base.attachments.length) {
                    store().addAttachments(created, base.attachments);
                }
                return created;
            }
            return store().update(base.id, patch) || base;
        }

        ui.openDrawer({
            eyebrow: eyebrow,
            title: draft.title || draft.room || (isNew ? 'New record' : 'Untitled'),
            body: body,
            footer: footer
        });
    }

    /* =====================================================================
     * Router
     * =================================================================== */
    const viewMeta = {
        dashboard: { title: 'Dashboard', sub: 'Everything that needs your attention' },
        tasks: { title: 'Tasks', sub: 'Custom todos, chores and reminders' },
        bills: { title: 'Bills', sub: 'Electricity, gas, water and everything else' },
        water: { title: 'Water meters', sub: 'Kitchen & bathroom consumption tracking' },
        reminders: { title: 'Reminders', sub: 'What is coming up and when you will be told' },
        attached: { title: 'Attached items', sub: 'Eagle images linked to your records' },
        settings: { title: 'Settings', sub: 'Preferences, Eagle publishing and your data' }
    };

    function render(host, ctx) {
        host.innerHTML = '';
        const view = ctx.app.view;
        const wrapper = U.el('div', { class: 'fade-in' });
        host.appendChild(wrapper);

        try {
            if (view === 'tasks') renderTasks(wrapper, ctx);
            else if (view === 'bills') renderBills(wrapper, ctx);
            else if (view === 'water') renderWater(wrapper, ctx);
            else if (view === 'reminders') renderReminders(wrapper, ctx);
            else if (view === 'attached') renderAttached(wrapper, ctx);
            else if (view === 'settings') renderSettings(wrapper, ctx);
            else renderDashboard(wrapper, ctx);
        } catch (err) {
            HM.log.error('view render failed', view, err);
            wrapper.appendChild(ui.emptyState(
                '💥', 'Something went wrong',
                `This screen failed to render: ${(err && err.message) || 'unknown error'}`,
                U.el('button', {
                    class: 'btn btn-primary', text: 'Back to dashboard',
                    onclick: function () { ctx.navigate('dashboard'); }
                })
            ));
        }
    }

    HM.views = {
        render,
        viewMeta,
        openEditor,
        markPaid,
        syncTags,
        openItemInEagle
    };
})(window);
