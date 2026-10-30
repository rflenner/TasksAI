# Close Plan: how "Next up" items are shown

Source: `nextUpPanel()` in `prototype/close-plan-demo.html` (the Close Plan page of Task AI). The voice assistant has a separate "What's up next?" (see the end).

## What it is
A short list of the open work that needs attention first on a plan: what is overdue and what is due in the next two weeks. It answers "what do I (or we) look at now?" without opening every phase.

## Which tasks are in the list
A task appears when **all** of these are true:
1. **The viewer is allowed to see it.** The selling team (iSEEit) sees every task, including internal ones. A customer sees only tasks shared with them, and only subtasks whose parent is shared too.
2. **It is not closed.**
3. **It has a due date.** A task without a due date never appears, however important it is.
4. **The due date is today or earlier, or within the next 14 days.** Everything overdue is included, however old.

It is **the whole plan as that viewer sees it**, not just "my" tasks: owner, coworkers and requester do not filter it. Subtasks are listed too, each marked "in <parent task>".

## Order and length
- Sorted by due date, **oldest first**. Because overdue tasks have the earliest dates, they come first, then today, then the following days.
- The panel shows the **first 6**. If there are more, a "Show all N" toggle expands the list, and "Show fewer" collapses it again.
- Ties on the same date keep the order of the plan's task list (the sort is stable).

## What each row shows
- The owner's avatar (photo when there is one, otherwise initials).
- The task title, in navy, clickable.
- A small grey line: **when**, then the owner's name, then (for a subtask) "in <parent task>".
  - Overdue: "**Overdue · 12 Oct**" in bold orange-red.
  - Due today: "Due today".
  - Due tomorrow: "Due tomorrow".
  - Otherwise: "Due 3 Nov · in 6 days".
- Clicking a row closes the panel and opens that task in the task drawer.

If nothing qualifies, the panel says "Nothing overdue or due in the next two weeks."

## Where it appears
- **Screens 1920 px wide and larger:** a side column on the right of the plan, with "Recent activity" below it.
- **Smaller screens:** a **Next up** icon button (a ticked list) next to the plan tabs. Clicking it opens the same panel as a small popover with a close ×; Esc or a click outside closes it.
- The icon carries a **red count badge** when something is overdue, and its tooltip reads "Next up · N overdue". The badge counts overdue tasks the viewer can see (the same rule as the "Overdue" filter on the plan), so it can differ from the rows in the panel: the panel also lists tasks due soon, while the badge counts only overdue ones.

## Not included
- Tasks without a due date, and tasks due more than 14 days ahead.
- Closed tasks.
- Milestones are ordinary tasks here: a milestone appears like any other when it falls in the window (no special mark).
- Internal tasks never appear for customers.

## Related: the voice assistant
Asking the voice assistant "What's up next?" uses `upcomingIds()` in `app/lib/close-plan-voice.ts`. It is similar but not identical: open tasks with a due date, sorted by due date (overdue first), **no 14-day limit**, and capped at **10**, read out as a list to walk through. It works on the plan as the iSEEit team sees it.

## If you port this (for example to Sales AI)
Copy the four inclusion rules, the oldest-first order, the limit of 6 with a "Show all" toggle, the wording of the relative dates and the two placements (side column vs. icon button with badge). Keep the viewer-visibility rule on the server for customers: the list must never be built from tasks the customer may not see.
