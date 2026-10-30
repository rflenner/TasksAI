# Close Plan design spec: Task AI → Sales AI

For the chat that ports Close Plan into Sales AI (`/Applications/Sales AI/iseeit-conversation-app`, folder `frontend/src/pages/opportunities-page/closePlan/`, backend `backend/src/app/mutual-close-plan*`).

## 1. How to work with this document
1. **The Task AI page is the source of truth for look and behaviour.** It is one file: `prototype/close-plan-demo.html` in `/Applications/Closeplan` (repo `rflenner/TasksAI`, branch `main`). It runs standalone with fictional data, so you can open it and compare side by side:
   ```
   cd /Applications/Closeplan/prototype && python3 -m http.server 3200
   open http://localhost:3200/close-plan-demo.html
   ```
   In the page, `ui.open = "<taskId>"; render()` in the console opens a task drawer; `ui.progOpen = true; render()` opens the progress details.
2. **Port the behaviour, not the HTML.** Sales AI uses React and its `sai-cp-*` classes. Keep those, but copy the measurements, colours, copy text and rules below. When in doubt, read the named function in the prototype.
3. **What changed since you started:** `git -C /Applications/Closeplan log --format='%h %ad %s' --date=short -- prototype/close-plan-demo.html`. Every user-visible change is one commit with a PR number. Read the list from the date you ported from. Section 5 has the list of what the Sales AI copy lacked on 2026-10-30.
4. **Do not copy Task AI's own storage.** Task AI keeps a plan as one JSON document (`docs/sales-ai-handover/data-structure.md`). Sales AI has its own backend; port the rules (visibility, who may edit), not the tables.
5. **Verify visually** against the prototype before saying a screen is done: same spacing, same states (empty, hover, open, disabled, overdue, complete).

## 2. Global rules (decided by the product owner)
- **No blue frames on text fields.** Typing in the add-task field, search boxes or fields must not draw a navy border or glow. Keep a neutral grey border. (Task AI: `.inline-new`, `.pfield.open`.)
- **Dropdowns are boxes with a small arrow.** A dropdown or tag box is a plain box; a small ▾ on the right (grey `#8b929d`, 11px, navy while open). No "Change" / "+ Add" text buttons. A click anywhere on the box opens it.
- **Empty fields read "None selected"** in grey `#9aa2ac`, 14px, with the arrow.
- **Tags:** a tagged person shows as a plain chip. The × appears only on hover and removes the person (not on single-value fields such as Owner).
- **Dropdown panel with search as you type** for every dropdown with a longer list: a search box ("Search by name, title or email" for people), results grouped under an uppercase team header (11px, letter-spaced, grey), each row avatar + name, with the role or title below in small grey. Enter picks the first match, Esc closes, a click outside closes. Short lists (about 5 or fewer, e.g. Status) stay a plain list.
- **Milestone and status colours:** green `#25784b` done, red `#c8372d` missed (past date, not closed), yellow `#e0a100` only when due within 7 days of today, purple `#7a4fd0` still ahead.
- **Internal tasks and updates never reach the customer view**, filtered on the server, not hidden on screen.
- Light theme only, Arial, 14px base. Tokens: navy `#173f76`, dark `#102f59`, orange (today) `#ffa614`, ink `#202735`, muted `#697181`, line `#e7ebef`, page `#f5f7fa`, field border `#d9dee5`, hint `#9299a3`, buyer teal `#1f6f78` on `#e3f2f3`, late `#c96539`.

## 3. Screen by screen
Each entry: what it must look like, then where to read it in `prototype/close-plan-demo.html`.

### 3.1 Phase header (task list) — `phaseGroups` / the `.group-title` markup
Grey bar (`#f5f7fa`, rounded 10px): chevron, numbered circle (✓ when complete), phase name (+ "CURRENT PHASE" tag), goal line when open. **Right side, three lines:** date range, a thin green completion bar (≈110px wide, 5px high), "**8/11 closed**". Colour by state: grey normal, light blue for the current phase, light green when all tasks are closed. Folded phases show a one-line summary instead of the goal.

### 3.2 Timeline strip at the top — `timelineBlock`
One lane when phases do not overlap, a Gantt row per phase when they do. Each phase card: number circle (✓ when complete), name, date range, completion bar, "x/y closed". Card colour: grey upcoming, blue + navy border current, green complete, amber border when it has an overdue task. A "TODAY" line in orange. Milestones as diamonds underneath (hover shows name, date, "moved +7 days").

### 3.3 Task card, subtasks, drag — `cardHtml`
Checkbox, title, one meta row (owner, due date, status, milestone star, coworkers, "Requested by …", update count, "x/y subtasks"). Overdue due dates in `#c96539` with "Overdue ·". "ADDED BY <customer>" badge only when a customer created it and the viewer is on the selling team. Drag handle on hover; tasks can move between phases. Bell icon only on hover.

### 3.3b Next up — see `next-up.md` in this folder
A list of open tasks the viewer may see, due today or earlier or within 14 days, oldest first, 6 rows with "Show all N". Side column on screens 1920 px and wider, otherwise an icon button with an overdue badge. Full rules, wording and placement are in `next-up.md` (read `nextUpPanel()` in the prototype).

### 3.4 Add a task (inline) — `.inline-new`
A normal white card with a normal grey border (no blue): disabled checkbox, "Task name" field (17px, navy text, no border), hint line "Enter adds it and starts the next one · the button adds it and closes · Esc cancels", and on the right **Cancel** and **Add task** buttons.

### 3.5 Task drawer — `renderDrawer`
Sections in order: title, status / phase / due date, description (rich text), subtasks, **Owner / Coworkers / Requested by** (rules in section 2), "Share internal only" and "Milestone" switches ("Counts as" Target signature or Target go-live appears when Milestone is on), **Status updates** (post box posts when you click outside; remove link for the author, plan owner and admins), then two collapsed sections: **Who hears about this task** (the real notification rules) and **Task history**. Attachments (PDF only, 10 MB, 20 per task, built-in viewer) sit with the task.

### 3.6 People fields — `peopleField`, `pickerList`, `wirePicker`
Exactly the section-2 behaviour. Panel groups: the plan's customer team, the selling team, then people not yet on the plan (picking one adds them to the plan). Photos where known, initials otherwise.

### 3.7 Progress tile and chart (iSEEit team only) — `progressTile`, `progressPanel`, `progressChart`, `progressData`
- **Tile:** big percentage of tasks closed, "9 of 48 tasks closed", a small chart, two boxes "Current progress" (e.g. "30% behind plan") and "Forecasted signature" (date, orange when late), and a "Show details" toggle.
- **Details:** the large chart plus facts (Today, Forecast signature, Forecast go-live, Dates moved, All tasks).
- **Weighting:** every task counts 1, every milestone counts 3.
- **Lines:** original plan (grey dashed, the due dates the plan started with), current plan (navy), done (green, ends at today with a dot). Orange vertical today line.
- **Axis:** starts at the first date, **ends at the last milestone** (or today if later); nothing is drawn after it.
- **Milestones:** diamonds on the current-plan curve (7px radius on the large chart, 5.5px on the small one), coloured by the section-2 rule. Target signature and go-live also get a dotted vertical line over the full height. On the large chart each milestone shows its **name in bold and the date under it**, next to the diamond, in the free space the curve leaves (above-left, or below-right; below-left near the right edge). Of two close milestones the earlier goes above, the later below. Labels have a thin white outline. The small chart shows no names.
- **(i) button** at the top right of the large chart: the legend and footnote live behind it, not on screen.

### 3.8 People tab — `peopleView`
Per person: open, due this week, overdue and closed counts as small bars, "Last seen" under the status (iSEEit admins only for the activity log), role as free text with a suggestion list. Removing a person reassigns all their tasks to one other person.

### 3.9 Header and sharing
Plan title (click to rename), target signature and go-live dates, plan owner on each side, a Salesforce status chip (click to re-sync), Share with the customer (invite dialog with Salesforce search, personal links valid 60 days), Download PDF (everyone, including customer links). The customer view is the same screen without internal items and without the progress tile.

### 3.10 Excel export (iSEEit team) — not yet merged in Task AI
A workbook with one Plan sheet (a collapsible group per phase, a live completion bar, a Status drop-down Open / In progress / Done) plus Timeline, People, Updates and Files sheets; an internal and a shared-only version. The source was lost from disk before merging; rebuilding from the session transcript is possible. Do not start this in Sales AI yet.

## 4. Behaviour rules worth copying
- **Status moves by itself** when work starts (an update, a started subtask).
- **Folding:** current phases, past phases with open work and any phase with an overdue task start open; the rest fold.
- **Overdue** = not closed and due before today. A task without a due date is "No due date", never overdue, and is never given the phase end date.
- **Salesforce sync** (Task AI): Close Plan wins on conflict; a task created in Salesforce is credited to its **creator**, not its owner.
- **Notification emails** (invitation, task assigned, Monday digest, reminders): the Monday email and overdue reminders are paused until the test round. Rules: `docs/close-plan.md` in the Task AI repo.

## 5. Gap list for Sales AI (checked 2026-10-30 by searching the closePlan folder and backend)
Present in some form: personal links, drag/reorder, milestones, internal-only, roles, templates, phase editing, rich text, "Who hears" and Task history boxes, remove a status update, activity/last-seen, people stats.
**Missing or not found:** PDF attachments and the viewer; the progress tile and chart (section 3.7); PDF report; contact photos; org chart link and preview; voice assistant (iSEEit team); Excel export; the Salesforce two-way sync beyond what exists (read `docs/close-plan-salesforce.md`).
**Just done on 2026-10-30 (by the Task AI chat, uncommitted in your folder):** people fields, searchable dropdowns, phase header and timeline cards with bar and count, the add-task format. Re-read those files before editing.

Suggested order for the rest: progress tile and chart, then attachments, then PDF report, then photos and org chart link, then Salesforce sync.

## 6. Keeping the two in step
- One owner per change: when the Task AI chat changes the look, it appends a line to `docs/sales-ai-handover/closeplan-changes.md` (date, PR, what a Sales AI port must copy).
- The Sales AI chat reads that file first, then the commit list in section 1.3.
- Visual changes are agreed on the Task AI page first; the Sales AI port follows. Say so in the Sales AI commit message ("ports Task AI #264").
