Home Manager

Gives Eagle the household brain you keep putting off building: bills, chores and meter readings in one place, with real due dates and reminders. Attach your own Eagle items — a meter photo, a scanned invoice, a receipt — and the plugin tags them, so Eagle itself remembers the link: search hm: to see which items belong to which record and whether it is still open. Those tags are the durable record, so attachments are rebuilt from them on every load and survive restarts or a wiped data file.

Highlights

- Attach your own Eagle items to any bill, task, meter or reading — from a searchable picker, or from Eagle's current selection
- Each attached item is tagged in place: an identity tag (hm:b3, hm:t7, hm:m1) plus a state tag (hm:todo / hm:done)
- Complete a task or pay a bill and its items flip to hm:done; reopen it and they return to hm:todo
- Attachments are rebuilt from those tags on every load, and a Sync tags button does it on demand
- Bills with amount, provider, usage, due date and a repeat rule; marking one paid records it and schedules the next period
- Tasks with due dates, priority, recurrence, notes and a checklist — recurring chores reschedule themselves rather than disappearing
- Water meters for any room: each reading adds consumption, a per-day average and a chart, with the next reading scheduled for you
- Reminders at an exact time or a number of days before a due date, as Eagle notifications, with overdue items re-nudged daily
- A dashboard roll-up of overdue, due soon, outstanding and paid this month, plus a three-week timeline and search
- One gallery of every attached item, a dark-first interface that follows Eagle's light theme, and automatic re-sync when you switch libraries

How to use

1. Open Home Manager — first run seeds an electricity bill, a gas bill, two water meters and two starter tasks.
2. Give a bill an amount, due date and repeat rule; paying it schedules the next one.
3. Press + From Eagle on any record to attach items, or use your current Eagle selection. They are tagged immediately.
4. Log water readings in the meter panel; consumption, the average and the chart update as you go.
5. Complete a task or mark a bill paid and its items flip to hm:done in Eagle. Detach and the tag comes off.

Install

Needs Eagle 4.x (verified on 4.0.0 build 23; selecting items in Eagle needs build 12+). No dependencies, no build step: double-click the .eagleplugin, or copy the plugin folder into Eagle's plugin folder and refresh the panel.

Reminders run while the plugin window is open and catch up when it opens — set "serviceMode": true for notifications with it closed. Items in other libraries show a padlock until you switch to that library and sync.

No network requests of any kind. It writes only its own data file under Eagle's plugin data, plus the hm: tags on the items you attach — removed again when you detach.
