# Close Plan — user guide

Close Plan is a shared, phase-based plan for getting a deal to signature (and
go-live). The iSEEit team and the customer work on the same plan: who does what,
by when, and where the deal stands.

This guide is for people using Close Plan. For how it is built, see
[close-plan.md](close-plan.md) and [close-plan-salesforce.md](close-plan-salesforce.md).

## Who uses it

| You are | How you get in | What you see |
|---|---|---|
| **iSEEit team member** | Sign in to Task AI (Google, passkey or email link), then open **Close plans** | Every plan you created or are a member of. Site Admins see all plans. |
| **Plan owner** | Same as above | Everything, plus managing people, phases and sharing. Each plan has two owners: one on the seller side, one on the buyer side. |
| **Customer contact** | A personal link you receive by email (`/p/…`). No password, no account. | The shared plan only: phases, shared tasks, people. Never internal tasks. |

Your personal link is valid for 60 days. If it stops working (expired, switched
off, or you were removed from the plan), ask the iSEEit plan owner for a new one.

## The plan at a glance

- **Plan** tab: the header (customer, target signature, target go-live, progress),
  a timeline of the phases, and the phases with their tasks.
- **People** tab: both teams, with each person's open, due and overdue items.
- **Next up** (side panel): your open tasks that are overdue or due in the next
  14 days, overdue first.
- **Recent activity**: the latest major updates. *Show all activity* opens the full
  list with a summary of the last 7 days.

### Phases

Each plan has its own phases (for example Align → Validate → Finalize → Launch →
Realize Value), each with a goal and start and end dates.

- Phases can overlap, and more than one can be current.
- Phases that are finished or in the future fold into one line (open count,
  overdue count, next due task). Use **Expand all / Collapse all**, or click a
  phase to open it. Your choice is remembered on your browser.
- The timeline is a single lane; if phases overlap it becomes a Gantt view with a
  "Today" line, and each bar fills as tasks close.
- Only plan owners can rename, re-date, reorder, add or delete phases (three-dot
  menu on the phase header). Deleting a phase never deletes tasks: you choose
  where they go.

## Working with tasks

**Add a task:** click **+ Add a task** at the end of a phase, type the name and
press Enter (Esc cancels). Enter again adds the next one. The task gets you as
owner and the end of the phase as due date.

**Open a task** to see its details: status, phase, due date, description,
subtasks, owner, coworkers, requested by, and status updates.

| Field | Meaning |
|---|---|
| **Owner** | Does the task and is accountable for it. |
| **Coworkers** | Help the owner. Can see and edit the task. |
| **Requested by** | The person who asked for it and tracks it. |
| **Subtask** | A full task of its own (owner, date, status), one level below a task. |
| **Milestone** | A key date, such as signature or go-live. A milestone can count as the target signature or target go-live. |
| **Shared with customer** | Off = internal task, never visible to the customer. |

**People fields:** click **+ Add** (or **Change** for the owner), type to search,
use the arrow keys, Enter picks the first match, Esc closes.

**Status:** Open → In progress → Closed. A task moves to *In progress*
automatically when someone posts an update on it, or when one of its subtasks is
started or closed. A status you set by hand always wins, and a closed task is
never reopened by a note.

**Post an update:** write it in the task's updates. Customer contacts can also
reply to a notification email; the reply is posted on the task, and a status
change stated in it is applied.

**Reorder:** drag a task by its grip (shown on hover) above or below another task,
or onto another phase. Subtasks travel with their task. Keyboard: focus the grip
and use the arrow keys.

**Delete:** *Delete task* at the bottom of the details, after a second
confirmation that says how many subtasks go with it. You can delete tasks you
created, or any task if you have "All tasks" access. Customer contacts can
delete only tasks they added.

## What each person may do

Set per person on the plan by a plan owner (People tab → gear icon):

| Setting | Options | Effect |
|---|---|---|
| **Tasks** | View only / Own tasks / All tasks | View only: read the plan. Own tasks: edit and close tasks you own, co-work on or created, and post updates on tasks you requested. All tasks: edit every task you can see. |
| **Create tasks** | on / off | Add tasks and subtasks. |

Defaults: customer contacts get *Own tasks* + create; iSEEit members get *All
tasks* + create. Customer contacts can never change people, phases, plan owners or
the shared/internal switch.

## Creating a plan (iSEEit team)

Click **+ New close plan**. A four-step guide creates the plan as a **draft**:
nothing is shared and nobody is invited until you do it.

1. **Deal** — search the opportunity as you type (account, amount, stage, close
   date, contacts) or enter it by hand. Set the plan name, plan start, target
   signature and target go-live.
2. **Template** — pick a starting point. Dates are fitted into your real
   timeframe. Templates: Standard B2B, POC-led, Enterprise procurement, Renewal &
   expansion, App design & build, Product MVP with a development partner, Blank.
3. **People** — template tasks are written for roles (executive sponsor, project
   lead, security, procurement, legal, account lead, solutions engineer, …). Pick
   a person per role, or "decide later" to fall back to that side's plan owner.
4. **Review** — untick tasks the deal doesn't need.

A draft shows a **Getting started** checklist: check dates with the buyer plan
owner, review internal tasks, invite the buyer plan owner, invite the buying team.
When all four are done the plan becomes active.

You can also start from Salesforce: sidebar → **Import from Salesforce**.

## Managing people (plan owners)

On the **People** tab, **Add person** on each side. Only the iSEEit plan owner
and admins can add people; each person gets a role on the plan.

- **iSEEit side:** active Task AI users, several at once.
- **Customer side:** *From Sales AI* (the account's contacts, with a suggested role
  from their job title), *Task AI user* (a partner on the customer side), or *New
  contact* by hand.

Everything about a person (email, role, invitation, access, removal) is behind the
gear icon on their row.

**Invitation states for customer contacts:** No email → Not invited → Invited →
Active (they opened their link).

- **Send invitation** emails the contact their personal link. **Copy personal link**
  gives you the link to send yourself. **Switch off link** stops it working.
- **Remove a person:** their open tasks go to someone you choose (default: that
  side's plan owner). A plan owner can't be removed until another owner is set.

## Sharing and exports

- **Download PDF** (next to the plan title, for everyone): a print-ready report
  with where we stand, key dates, phase timeline, next steps, every phase with its
  shared tasks and both teams. Choose "Save as PDF" in the print dialog. Internal
  tasks are never included. Good for customers who are not connected yet.
- **Rename the plan:** click its name in the header (plan owners and admins).
- **Delete a plan:** ⋮ next to the title (seller-side plan owner or admin), after a
  second confirmation. Personal links of that plan stop working.
- **Link preview:** a pasted `/p/…` link shows the plan's name and the iSEEit logo.

## Voice assistant (iSEEit team)

Click **🎙 Voice assistant** next to *Download PDF* (saved plans only). It greets
you and listens. Say **"What can I say?"** to see the list for this plan. Examples:

- *Where do we stand? What should I do next? What's overdue? What are we waiting on from them?*
- *Open task <name>. Close it. Post an update: …* *Change the due date to Friday.*
- *Add a task* — it asks for the phase, owner, due date and description you didn't
  mention; say "skip" to use defaults.

Closing a task and moving a milestone ask you to say "yes" to confirm. Anything it
can't do yet is recorded as a request for the product team.

## Notifications

Site Admins set the rules under **Admin → Notifications**. In short:

- **Customers are never spammed:** at most one scheduled email per person per plan
  per week.
- **Invitation** email with the personal link, and a reminder if it isn't opened
  (limited number, set by admins).
- **Assigned tasks:** when you become owner or coworker of an open task you get an
  email (and a Slack message for iSEEit people). Several tasks in one save make one
  email. Draft plans don't send these.
- **Added to a plan:** iSEEit people get an email and Slack message.
- **Monday email:** plan owners get an overview plus their tasks; other customer
  contacts get *My tasks* and *Requested by you* for the plan, and nothing in a
  week where nothing is open for them. Currently paused until the test round.
- **Overdue reminders:** iSEEit owners get them every few days; customers see
  overdue items only in the Monday email.

**Stop emails:** every Close Plan email has an **Unsubscribe** link. Plan owners can
also set *Don't email* on a person, and admins keep an exclusion list.

## Salesforce (admins and plan owners)

A plan can be linked to its Salesforce opportunity (iSEEit close plan objects).
Plan menu → **Sync with Salesforce** shows a preview, then applies it.

- Phases, tasks, status, due dates, owners, order and sharing sync both ways. If
  the same field changed on both sides, **Close Plan wins** and the overwritten
  Salesforce value is noted in the activity.
- A plan that has synced once checks Salesforce when opened and writes its changes
  back a few seconds after each save.
- On the first sync, tasks that exist only in the plan are held back unless you
  tick "Also create…".
- Not synced yet: subtasks.

## Tips and troubleshooting

| Problem | Try |
|---|---|
| "Not saved" next to the plan | Wait a moment; the page retries. If it says someone else changed the plan, review the latest version and redo your change. |
| A customer's link doesn't work | It may be expired (60 days) or switched off. Send a new invitation. |
| A customer can't see a task | It is marked internal, or is a subtask of an internal task. |
| An invitation didn't arrive | Check their address and the invitation state; the person may be excluded or unsubscribed. Use *Copy personal link* instead. |
| Contacts missing in *Add person* | The plan has no Sales AI account yet, or Sales AI is unreachable. Use *Task AI user* or *New contact*. |
