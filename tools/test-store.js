/* =========================================================================
 * Headless test harness for the Home Manager data layer.
 *
 * Loads util.js + store.js the same way the plugin window does (as plain
 * scripts over a shared global) with a mocked Eagle environment and a real
 * temp directory for the JSON data file, then exercises the model rules.
 *
 * Run:  node tools/test-store.js
 * ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* ------------------------------------------------------------------ setup */
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'));
const userData = path.join(sandboxRoot, 'Eagle');

global.window = global;
global.eagle = {
    app: { userDataPath: userData, version: '4.0', platform: 'win32' }
};

// store.js is authored for a browser/eval context; give it a real `require`.
function loadScript(file) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    const factory = new Function('window', 'require', 'module', 'exports', 'console', code);
    factory(global, require, { exports: {} }, {}, console);
}

loadScript('util.js');
loadScript('store.js');

const HM = global.HM;
const U = HM.util;
const store = HM.store;

/* ------------------------------------------------------------- assertions */
let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label, extra) {
    if (condition) {
        passed += 1;
    } else {
        failed += 1;
        failures.push(label + (extra !== undefined ? `\n      got: ${JSON.stringify(extra)}` : ''));
        console.log(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra)}` : ''}`);
    }
}

function eq(actual, expected, label) {
    ok(actual === expected, label, { actual, expected });
}

function section(name) {
    console.log(`\n${name}`);
}

/* ------------------------------------------------------------------ tests */
(async function run() {
    /* ---- 1. date math ---------------------------------------------------- */
    section('1. Local-date arithmetic');
    eq(U.toISODate(new Date(2026, 0, 5)), '2026-01-05', 'toISODate pads correctly');
    eq(U.addDays('2026-01-31', 1), '2026-02-01', 'addDays crosses a month boundary');
    eq(U.addMonths('2026-01-31', 1), '2026-02-28', 'addMonths clamps to a short month');
    eq(U.addMonths('2024-01-31', 1), '2024-02-29', 'addMonths clamps to a leap February');
    eq(U.addMonths('2026-03-15', 1), '2026-04-15', 'addMonths keeps the day of month');
    eq(U.daysBetween('2026-03-01', '2026-03-31'), 30, 'daysBetween counts whole days');
    eq(U.addDays('2026-03-29', 1), '2026-03-30', 'addDays is stable across a DST switch');
    eq(U.num('12,5'), 12.5, 'num accepts a comma decimal separator');
    eq(U.num(''), null, 'num returns null for empty input');

    /* ---- 2. first run seeds --------------------------------------------- */
    section('2. First-run seeding and persistence');
    await store.init();
    eq(store.backend, 'file', 'uses the file backend when fs + userDataPath are available');
    ok(store.dataPath && store.dataPath.indexOf('plugin-data') !== -1, 'data file lands in plugin-data/', store.dataPath);
    eq(store.bills().length, 2, 'seeds two bills');
    eq(store.meters().length, 2, 'seeds two water meters');
    eq(store.tasks().length, 2, 'seeds two tasks');

    const meterRooms = store.meters().map((m) => m.room).sort().join(', ');
    eq(meterRooms, 'Bathroom, Kitchen', 'meters are the kitchen and the bathroom');

    const electricity = store.bills().find((b) => b.category === 'electricity');
    const gas = store.bills().find((b) => b.category === 'gas');
    ok(electricity && gas, 'seeds an electricity bill and a gas bill');
    ok(fs.existsSync(store.dataPath), 'data file was written to disk');

    // Reload from disk in a fresh copy of the module to prove round-tripping.
    const dataPath = store.dataPath;
    const persisted = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    eq(persisted.items.length, 4, 'persisted file holds all four items');

    /* ---- 3. bill status -------------------------------------------------- */
    section('3. Bill status derivation');
    const bill = store.bills().find((b) => b.category === 'electricity');
    bill.dueDate = U.addDays(U.todayISO(), 12);
    eq(store.billStatus(bill).key, 'upcoming', 'a bill due in 12 days is upcoming');

    bill.dueDate = U.addDays(U.todayISO(), 2);
    eq(store.billStatus(bill).key, 'soon', 'a bill due in 2 days is soon (inside the lead time)');

    bill.dueDate = U.todayISO();
    eq(store.billStatus(bill).key, 'today', 'a bill due today reads as today');

    bill.dueDate = U.addDays(U.todayISO(), -4);
    const overdue = store.billStatus(bill);
    eq(overdue.key, 'overdue', 'a past due date reads as overdue');
    eq(overdue.label, '4 days overdue', 'overdue label counts the days');

    bill.paid = true;
    eq(store.billStatus(bill).key, 'paid', 'a paid bill reports paid regardless of date');
    bill.paid = false;

    /* ---- 4. mark paid rolls the due date --------------------------------- */
    section('4. Marking a repeating bill paid');
    const monthly = store.bills().find((b) => b.category === 'electricity');
    monthly.dueDate = '2026-01-15';
    monthly.repeat = 'monthly';
    monthly.amount = 78;
    const paymentsBefore = (monthly.payments || []).length;

    store.markPaid(monthly.id, { amount: 81.4, note: 'card' });
    const afterPay = store.getBill(monthly.id);
    eq(afterPay.payments.length, paymentsBefore + 1, 'a payment entry is appended');
    eq(afterPay.payments[0].amount, 81.4, 'the payment records the amount actually paid');
    eq(afterPay.payments[0].forDueDate, '2026-01-15', 'the payment remembers which due date it settled');
    eq(afterPay.paid, false, 'a repeating bill is not left flagged paid');
    const stepped = U.daysUntil(afterPay.dueDate) >= 0;
    ok(stepped, 'the rolled due date is never in the past', afterPay.dueDate);

    // A long-neglected monthly bill must skip forward past today, not stop one
    // period after the stale due date.
    const stale = store.bills().find((b) => b.category === 'gas');
    stale.dueDate = '2024-01-10';
    stale.repeat = 'monthly';
    store.markPaid(stale.id);
    const staleAfter = store.getBill(stale.id);
    ok(U.daysUntil(staleAfter.dueDate) >= 0, 'a long-overdue repeating bill rolls into the future', staleAfter.dueDate);
    ok(U.daysUntil(staleAfter.dueDate) <= 31, 'and lands within one period of today', staleAfter.dueDate);

    // One-off bills simply flip to paid.
    const oneOff = HM.model.newBill({ title: 'Boiler service', repeat: 'none', dueDate: U.todayISO() });
    store.add(oneOff);
    store.markPaid(oneOff.id);
    const oneOffAfter = store.getBill(oneOff.id);
    eq(oneOffAfter.paid, true, 'a non-repeating bill stays flagged as paid');
    eq(oneOffAfter.payments.length, 1, 'the one-off payment is recorded');

    store.markUnpaid(oneOff.id);
    eq(store.getBill(oneOff.id).paid, false, 'markUnpaid clears the paid flag');

    /* ---- 5. tasks -------------------------------------------------------- */
    section('5. Tasks and recurrence');
    const chore = store.tasks().find((t) => t.repeat === 'semiannual');
    ok(chore, 'a repeating starter task exists');
    const choreDueBefore = chore.dueDate;
    store.toggleTask(chore.id);
    const choreAfter = store.getTask(chore.id);
    eq(choreAfter.done, false, 'a recurring task stays open after completing it');
    ok(choreAfter.dueDate !== choreDueBefore, 'a recurring task advances its due date', choreAfter.dueDate);
    eq(choreAfter.completions.length, 1, 'the completion is logged');

    const plain = store.add(HM.model.newTask({ title: 'One-off errand', dueDate: U.todayISO(), repeat: 'none' }));
    store.toggleTask(plain.id);
    eq(store.getTask(plain.id).done, true, 'a one-off task is marked done');
    store.toggleTask(plain.id);
    eq(store.getTask(plain.id).done, false, 'toggling again reopens it');

    /* ---- 6. water meters ------------------------------------------------- */
    section('6. Water meter readings and consumption');
    const kitchen = store.meters().find((m) => m.room === 'Kitchen');
    eq(store.latestReading(kitchen), null, 'a meter with no readings has no latest reading');

    store.addReading(kitchen.id, { date: '2026-01-01', value: 1200 });
    let kitchenNow = store.getMeter(kitchen.id);
    eq(store.latestReading(kitchenNow).consumption, null, 'the first reading has no consumption');
    eq(kitchenNow.nextDue, U.addMonths('2026-01-01', 1), 'the next reading date advances one cycle');

    store.addReading(kitchen.id, { date: '2026-02-01', value: 1214.5 });
    kitchenNow = store.getMeter(kitchen.id);
    eq(kitchenNow.readings.length, 2, 'both readings are stored');
    eq(store.latestReading(kitchenNow).consumption, 14.5, 'consumption is the delta between readings');
    const rate = store.meterRate(kitchenNow);
    ok(rate && Math.abs(rate.perDay - 14.5 / 31) < 1e-9, 'the per-day rate divides by the day gap', rate);
    eq(kitchenNow.nextDue, '2026-03-01', 'the next reading date follows the latest reading');

    // Out-of-order entry must not corrupt consumption.
    store.addReading(kitchen.id, { date: '2026-01-15', value: 1207 });
    kitchenNow = store.getMeter(kitchen.id);
    eq(kitchenNow.readings.map((r) => r.date).join(','), '2026-01-01,2026-01-15,2026-02-01', 'readings stay sorted by date');
    eq(store.consumption(kitchenNow, 1), 7, 'the inserted reading gets the right delta');
    eq(store.consumption(kitchenNow, 2), 7.5, 'the following reading is recalculated');

    // A meter reset must not produce negative consumption.
    store.addReading(kitchen.id, { date: '2026-03-01', value: 5 });
    kitchenNow = store.getMeter(kitchen.id);
    eq(store.consumption(kitchenNow, 3), null, 'a meter reset yields no consumption rather than a negative number');

    const bathroom = store.meters().find((m) => m.room === 'Bathroom');
    eq(bathroom.readings.length, 0, 'the second meter is tracked independently');

    /* ---- 7. reminders ---------------------------------------------------- */
    section('7. Reminder timing and notification keys');
    const settings = store.state.settings;
    settings.remindTime = '09:00';
    settings.remindDaysBefore = 3;

    const reminderBill = store.bills().find((b) => b.category === 'electricity');
    reminderBill.dueDate = '2026-06-20';
    reminderBill.remindAt = '';
    reminderBill.remindDaysBefore = null;
    const when = store.reminderAt(reminderBill);
    eq(U.toISODateTime(when), '2026-06-17T09:00', 'reminder fires lead-time days before the due date at the configured time');

    reminderBill.remindDaysBefore = 7;
    eq(U.toISODateTime(store.reminderAt(reminderBill)), '2026-06-13T09:00', 'a per-record lead time overrides the global default');

    reminderBill.remindAt = '2026-06-01T18:30';
    eq(U.toISODateTime(store.reminderAt(reminderBill)), '2026-06-01T18:30', 'an explicit reminder overrides the lead-time rule');

    reminderBill.remindAt = '';
    reminderBill.remindDaysBefore = null;

    const keyBefore = store.notificationKey(reminderBill);
    ok(!store.hasNotified(reminderBill), 'a fresh record has not been notified');
    store.markNotified(reminderBill);
    ok(store.hasNotified(reminderBill), 'marking notified is remembered');
    reminderBill.dueDate = '2026-07-20';
    ok(!store.hasNotified(reminderBill), 'rolling the due date invalidates the previous notification');

    /* ---- 8. alerts and summary ------------------------------------------- */
    section('8. Alerts and dashboard summary');
    store.reset(true);
    eq(store.bills().length, 0, 'reset clears records');

    const seeded = HM.model.seedState(store.state);
    await store.save();
    const overdueBill = HM.model.newBill({ title: 'Late bill', amount: 50, dueDate: U.addDays(U.todayISO(), -2), repeat: 'none' });
    const todayTask = HM.model.newTask({ title: 'Due today', dueDate: U.todayISO() });
    const paidBill = HM.model.newBill({ title: 'Settled', amount: 20, dueDate: U.addDays(U.todayISO(), -5), paid: true, paidAt: new Date().toISOString() });
    store.add(overdueBill);
    store.add(todayTask);
    store.add(paidBill);

    // store.add() stores a normalised copy — mutate the stored record.
    const storedPaid = store.getBill(paidBill.id);
    eq(store.bills().length >= 3, true, 'all three bills are stored');

    const alerts = store.alerts();
    eq(alerts[0].status.key, 'overdue', 'overdue items sort first');
    ok(!alerts.some((a) => a.record.id === paidBill.id), 'paid bills are excluded from alerts');
    ok(alerts.some((a) => a.record.id === todayTask.id), 'today tasks are included');

    const summary = store.summary();
    eq(summary.overdueCount, 1, 'summary counts one overdue item');
    ok(summary.openBillCount >= 3, 'summary counts the open bills', summary.openBillCount);
    ok(summary.openBillsTotal > 0, 'summary totals the outstanding amount', summary.openBillsTotal);

    storedPaid.payments = [{ id: 'p1', amount: 20, paidAt: new Date().toISOString(), forDueDate: storedPaid.dueDate }];
    eq(store.summary().paidThisMonthTotal, 20, 'payments made this month are totalled');
    eq(store.summary().paidThisMonthCount, 1, 'payments made this month are counted');

    // A payment made late in the local evening must land in the local month,
    // not the UTC one (this is why paidAt is converted via localDateOf).
    const lateEvening = new Date();
    lateEvening.setHours(23, 30, 0, 0);
    storedPaid.payments = [{ id: 'p2', amount: 20, paidAt: lateEvening.toISOString(), forDueDate: storedPaid.dueDate }];
    eq(store.summary().paidThisMonthTotal, 20, 'a near-midnight payment counts in the local month');
    eq(U.localDateOf(lateEvening.toISOString()), U.toISODate(lateEvening), 'localDateOf matches the local calendar day');

    /* ---- 9. attachments -------------------------------------------------- */
    section('9. Attachments');
    const target = store.bills().find((b) => !b.paid);
    store.addAttachments(target, [
        { itemId: 'AAA', name: 'invoice.png', ext: 'png' },
        { itemId: 'BBB', name: 'meter.jpg', ext: 'jpg' }
    ]);
    eq(target.attachments.length, 2, 'two attachments are stored');

    store.addAttachments(target, [
        { itemId: 'AAA', name: 'invoice.png', ext: 'png' },
        { itemId: 'CCC', name: 'receipt.webp', ext: 'webp' }
    ]);
    eq(target.attachments.length, 3, 'duplicate item ids are not attached twice');

    store.removeAttachment(target.id, 'BBB');
    eq(target.attachments.length, 2, 'attachments can be removed');
    ok(!target.attachments.some((a) => a.itemId === 'BBB'), 'the right attachment was removed');

    const all = store.allAttachments();
    eq(all.length, 2, 'the attachment browser sees every attachment');
    ok(all.every((a) => a.ownerLabel), 'each attachment carries an owner label');

    /* ---- 10. backup round-trip ------------------------------------------- */
    section('10. Backup export / import');
    const backup = store.toJSON();
    const billCountBefore = store.bills().length;
    const attachmentCountBefore = store.allAttachments().length;

    store.reset(true);
    eq(store.bills().length, 0, 'reset before import');

    store.fromJSON(backup);
    eq(store.bills().length, billCountBefore, 'import restores the bills');
    eq(store.allAttachments().length, attachmentCountBefore, 'import restores the attachments');
    eq(store.meters().length, 2, 'import restores the meters');

    let threw = false;
    try { store.fromJSON('{"nope":true}'); } catch (_) { threw = true; }
    ok(threw, 'importing a foreign file raises a clear error');

    /* ---- 11. reload from disk -------------------------------------------- */
    section('11. Reload from disk');
    // Give the reload something meaningful to preserve.
    const reloadMeter = store.meters().find((m) => m.room === 'Kitchen');
    store.addReading(reloadMeter.id, { date: '2026-04-01', value: 900 });
    store.addReading(reloadMeter.id, { date: '2026-05-01', value: 918.25, note: 'after the leak fix' });
    const reloadBill = store.bills().find((b) => !b.paid);
    store.addAttachments(reloadBill, [{ itemId: 'ZZZ', name: 'photo.png', ext: 'png', libraryPath: 'C:/lib' }]);

    const billCount = store.bills().length;
    const meterReadingCount = store.getMeter(reloadMeter.id).readings.length;
    const attachmentCount = store.allAttachments().length;
    const savedPath = store.dataPath;
    await store.save();

    // Simulate a fresh plugin window by reloading the modules.
    delete global.HM;
    loadScript('util.js');
    loadScript('store.js');
    const store2 = global.HM.store;
    await store2.init();
    eq(store2.dataPath, savedPath, 'the same data file is reused');
    eq(store2.bills().length, billCount, 'records survive a reload');
    ok(store2.state.meta.seeded, 'the seeded flag survives, so seed data is not duplicated');
    eq(store2.meters().length, 2, 'meters survive a reload');
    eq(store2.getMeter(reloadMeter.id).readings.length, meterReadingCount, 'readings survive a reload');
    eq(store2.latestReading(store2.getMeter(reloadMeter.id)).consumption, 18.25, 'consumption survives a reload');
    eq(store2.allAttachments().length, attachmentCount, 'attachments survive a reload');
    eq(store2.allAttachments().find((a) => a.itemId === 'ZZZ').libraryPath, 'C:/lib', 'the source library path is preserved');

    /* ---- 12. storage migration when Eagle is slow to become ready --------- */
    section('12. Storage upgrade after readiness');
    {
        // Simulate start-up: Eagle refuses userDataPath until the plugin is
        // created, so the plugin falls back to localStorage...
        const lateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-late-'));
        const dataDir = path.join(lateRoot, 'Eagle');
        const base = {
            app: {
                get userDataPath() { return lateDataPath; },   // becomes available later
                getPath: function () { return Promise.resolve(''); }
            }
        };
        let lateDataPath = '';
        global.eagle = base;

        try { global.localStorage.setItem('hm.todo.data', ''); } catch (_) { /* ignore */ }

        delete global.HM;
        loadScript('util.js');
        loadScript('store.js');
        const store3 = global.HM.store;

        await store3.init();
        eq(store3.dataPath, '', 'no data path resolves while Eagle is not ready');
        const seeded = store3.state.items.length + store3.meters().length;
        ok(seeded > 0, 'the plugin still seeded data while falling back', seeded);

        // ...then Eagle becomes ready and the real path appears.
        lateDataPath = dataDir;
        const outcome = await store3.upgradeBackend();
        eq(outcome, 'migrated', 'storage migrates to a file once the path resolves');
        eq(store3.backend, 'file', 'backend is now the file');
        ok(store3.dataPath && store3.dataPath.indexOf('plugin-data') !== -1, 'data path points into plugin-data', store3.dataPath);
        ok(fs.existsSync(store3.dataPath), 'the file was actually written');
        const written = JSON.parse(fs.readFileSync(store3.dataPath, 'utf8'));
        eq(written.items.length + written.meters.length, seeded, 'every record survived the migration');

        // A second call must be a no-op, not a second migration.
        eq(await store3.upgradeBackend(), 'none', 'upgrading again does nothing');

        // And a fresh window loading that file picks the records up.
        delete global.HM;
        loadScript('util.js');
        loadScript('store.js');
        const store4 = global.HM.store;
        await store4.init();
        eq(store4.backend, 'file', 'a later window starts straight on the file');
        eq(store4.state.items.length + store4.meters().length, seeded, 'records are read back from the file');

        // Diagnostic log is written next to the data file.
        const diagPath = store4.dataPath.replace(/data\.json$/i, 'diagnostics.log');
        global.HM.diag.write('test', 'hello', 'world');
        ok(fs.existsSync(diagPath), 'diagnostics.log is created next to data.json', diagPath);

        // A run that only has a fresh seed must never clobber a real data file,
        // even when the file holds fewer records than the example data.
        const keepFile = JSON.parse(fs.readFileSync(store4.dataPath, 'utf8'));
        keepFile.items = keepFile.items.slice(0, 2);   // 2 real records vs 6 seeded
        keepFile.meters = [];
        keepFile.settings.currency = 'XYZ';
        fs.writeFileSync(store4.dataPath, JSON.stringify(keepFile, null, 2), 'utf8');

        try { global.localStorage.removeItem('hm.todo.data'); } catch (_) { /* ignore */ }
        delete global.HM;
        loadScript('util.js');
        loadScript('store.js');
        const store5 = global.HM.store;
        // Start with no path (as at start-up) so the state is only a fresh seed.
        lateDataPath = '';
        await store5.init();
        eq(store5.loadedFrom, 'seed', 'start-up with no path yields a fresh seed');
        const seededCount = store5.state.items.length + store5.meters().length;
        ok(seededCount > 2, 'the seed has more records than the data file', seededCount);

        lateDataPath = dataDir;
        eq(await store5.upgradeBackend(), 'loaded', 'a fresh seed defers to the existing data file');
        eq(store5.state.settings.currency, 'XYZ', 'the file contents were kept, not overwritten by the seed');
        eq(store5.state.items.length + store5.meters().length, 2, 'the file records won');

        global.eagle = { app: { userDataPath: userData, version: '4.0', platform: 'win32' } };
        try { fs.rmSync(lateRoot, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }

    /* ---- 13. summary of results ------------------------------------------ */
    console.log(`\n${'─'.repeat(58)}`);
    console.log(`  ${passed} passed, ${failed} failed`);
    if (failed) {
        console.log('\n  Failures:');
        failures.forEach((f) => console.log('   • ' + f));
    }
    console.log(`${'─'.repeat(58)}\n`);

    // Clean up the temp workspace.
    try { fs.rmSync(sandboxRoot, { recursive: true, force: true }); } catch (_) { /* ignore */ }

    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error('\nHarness crashed:', err);
    process.exit(2);
});
