Home Manager

Turns Eagle into the household brain you keep putting off building. Bills, chores and meter readings sit in one place with real due dates and real reminders — and, unusually for a to-do app, the things they belong to are your own Eagle items. Attach a photo of the meter, a scanned invoice or a receipt to a bill, a task or a reading, and the plugin writes a small tag onto those items so that Eagle itself remembers the relationship: search hm: in Eagle and you can see exactly which of your items belong to which record, and whether that record is still open. Those tags are the durable record, not a config file — Home Manager rebuilds its attachments from them every time it loads, so the links survive restarts, library re-indexes and even a wiped data file.

Highlights

- Attach one or many of your own Eagle items to a bill, a task, a water meter or an individual meter reading — from a folder-tree picker with search, or by attaching whatever is selected in Eagle right now
- Attachments are permanent: every attached item gets an identity tag (hm:b3 for a bill, hm:t7 for a task, hm:m1 for a meter) plus a state tag (hm:todo / hm:done) written onto the item itself, so the link lives inside your library
- The state travels with the item: mark a bill paid or complete a task and its attached items flip to hm:done; reopen it and they go back to hm:todo
- Every load re-reads those tags and rebuilds its attachments, and a Sync tags button does it on demand — the data file is a cache, not the source of truth
- Bills with amount, currency, provider, account number, metered usage, due date and a repeat rule from weekly through yearly
- Mark paid records the amount, the date, a note and which due date it settled, into a per-bill payment history
- Repeating bills roll to the next period when you pay them, skipping forward past stale dates instead of landing in the past
- Tasks with due dates, priority, category, recurrence, notes and a checklist; recurring chores reschedule themselves instead of vanishing when completed
- Water meters for any room: log readings and get consumption, a per-day average and a chart per period, with the next reading scheduled for you
- A meter reset is reported as no consumption rather than a nonsensical negative number
- Reminders either at an exact date and time, or a number of days before a due date at a time of day you choose — globally, or overridden per record
- Eagle desktop notifications, with overdue items re-notifying once a day so a missed bill does not go quiet
- A dashboard roll-up: overdue and due-soon counts, the outstanding total, what you paid this month, open tasks and the next water reading, over a three-week timeline
- Filter and search across everything: unpaid, due soon, overdue and paid bills, tasks by bucket, bills by category, plus free-text search
- An attached-items gallery showing every Eagle item linked to any record, with its owner on the tile
- Dark-first interface that follows Eagle's light theme, and it re-syncs by itself when you switch libraries
- Keyboard-first: / to search, b, t and w to create a bill, task or meter, r for reminders, d for the dashboard, Esc to close

How to use

1. Open Home Manager. On first run it seeds an electricity bill, a gas bill, two water meters and a couple of starter tasks so there is something to look at.
2. Give a bill an amount, a due date and a repeat rule. When you pay it, the next one is scheduled for you.
3. Open any record and press + From Eagle to attach a photo of the meter, a scanned invoice or a receipt — or select items in Eagle first and use "use current Eagle selection".
4. The attached items are tagged the moment you attach them. The record shows the tag it owns (hm:b2, say), and the thumbnails appear on the row and on the card.
5. Log water readings in the meter panel; consumption, the per-day average and the chart update as you go.
6. Watch the Dashboard or the Reminders view to see what is due and when you will be told.
7. Complete a task or mark a bill paid and its attached items flip to hm:done inside Eagle. Detach an item and the tag comes off again.

Install

Needs Eagle 4.x. Selecting items in Eagle and reading Eagle's own user-data path need Eagle 4.0 build 12 or newer; verified on Eagle 4.0.0 build 23. There are no dependencies and no build step: double-click the .eagleplugin file, or copy the plugin folder into Eagle's plugin folder and refresh the panel.

Reminders are evaluated while the plugin window is open, and anything it missed is caught up the moment it opens; for notifications with the window closed, set "serviceMode": true in the manifest. Eagle exposes only the library that is active right now, so an item from another library shows a padlock instead of a thumbnail until you switch to that library and sync — it is tagged at that point. The plugin's own data lives in Eagle's plugin data folder as data.json, alongside a small diagnostics log.

Home Manager makes no network requests of any kind — no telemetry, no analytics, no accounts. It writes only two things: its own data file and diagnostics log under Eagle's plugin data, and the hm: tags it adds to the items you choose to attach, which are removed again when you detach. Nothing else in your library is touched.
