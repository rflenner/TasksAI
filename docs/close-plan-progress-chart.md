# Close Plan: progress chart, rules and weights

The **Plan progress** tile on the Plan tab is twice as wide as the other three tiles. It shows the score (share of closed tasks) and a small graph. A grey line separates the top from a bottom row with a **Current progress** box ("21% behind plan"), a box with the **Forecasted signature** date and **Show details** on the right. **Show details** opens a full-width panel below the tiles (closed by default, at most two tile heights high): the full graph with axes, today, original and current plan, both forecasts with the delay against target, dates moved, and the whole-plan forecast. Under about 1180px wide the tile takes a full row. It is shown to the **iSEEit team only**: never on a customer's shared link, never in the customer PDF. Code: `progressData()` and `progressTile()` in `prototype/close-plan-demo.html`.

## What it shows

Time runs along the bottom, weighted completion (0 to 100%) up the side. Three lines:

| Line | Meaning |
|---|---|
| **Original plan** (grey, dashed) | How much should be done by each date, using the due dates the plan started with |
| **Current plan** (blue) | The same, using today's due dates |
| **Done** (green) | What has really been closed, up to today |

An orange line marks today. The Current progress box compares **Done** with the **Original plan** at today's date.

## Weights

- Every task counts **1**.
- Every milestone counts **3**, so milestones weigh in more (constant `MS_WEIGHT`).
- Subtasks count like tasks (1). Internal-only tasks count too, because only iSEEit sees the chart.
- A line's height at a date is: weight of everything counted by that date, divided by the total weight of all tasks, times 100.

## Rules

1. **Original plan date of a task** = the "from" date of its *first* recorded date change. If the task never moved, it is its current due date. Dates are therefore frozen at creation or import; moving a task later does not rewrite the original plan.
2. **Current plan date** = the task's due date today.
3. **Done date** = the day the task was closed. A task closed without a recorded date counts on its due date.
4. Tasks without a due date are left out of both plan lines, until they have one.
5. The "Done" line stops at today and is never drawn into the future.
6. **Moved dates** are counted from the date changes on tasks. The tile's info text names how many dates moved, and how many days the Target signature and Target go-live moved against their original dates.

## Badge

Difference = original plan % at today minus done % at today.

- **More than 2 points behind**: "N% behind plan" (orange).
- **Within 2 points**: "On plan" (green).
- **More than 2 points ahead**: "N% ahead of plan" (green).

## Forecast

The tile shows one date, the **forecast signature**, in orange when it is after the Target signature and green when it is on or before it. No weeks of delay are shown in the tile.

1. The set is every task due on or before the Target signature (current due dates), milestones weighted 3.
2. **Pace** = weighted progress that set made in the last **28 days**, divided by 28 (percentage points per day).
3. **Finish date** = today + (100% minus the set's done %) divided by pace, rounded up to whole days. Already complete: today.
4. **No task of the set closed in the last 28 days**: "no forecast yet".

The graphs have no forecast line. The details panel also states the whole-plan forecast (every task, same pace rule) in words. The go-live forecast (same rule, tasks due on or before the Target go-live) is shown in the details panel.

The forecast is a straight extrapolation. It does not know about holidays, a known upcoming rush, or tasks that are not yet created.

## Known limits

- The big percentage in the tile is the plain share of closed tasks (the number customers also see). The chart and the badge use the weighted figure, so the two can differ by a few points.
- The plan does not record when a task was created, so "total" is today's task count over the whole period. Tasks added later make the earlier part of the plan lines look lower than it was.
- The original plan relies on recorded date changes. A task whose date was edited before change tracking existed shows its current date as original.
- Constants worth tuning after the first test round: `MS_WEIGHT` (3), the forecast window (28 days) and the "on plan" tolerance (2 points).
