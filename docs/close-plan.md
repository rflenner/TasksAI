# Close Plan — design

A shared, phase-based plan for getting a deal to signature, which a seller
works on together with the buyer. Built as a module of Task AI: same app,
database, deployment, auth, email/Slack plumbing.

## Decisions (2026-10-01)

| Question | Decision |
|---|---|
| Tenancy | V1 runs in the existing single Task AI workspace. Later: isolated workspaces per customer, fed by that customer's own Sales AI accounts/contacts/opportunities. New tables carry a `workspace_id` from day one so that later split doesn't need a data migration. |
| Buyer access | Buyers can view, update **and add** tasks and subtasks on the shared plan. |
| Subtasks | Full tasks (own owner, due date, status), one level deep. Example: a "POC" task with subtasks Define use cases, Create POC document, Organize participants, Create technical environment, Define date, Echo-back meeting — each with its own owner on either side. The existing per-task checklist stays for trivial tick-boxes. |
| Phases | Editable template (default Discovery → Validation → Negotiate → Close) copied into each plan, then editable per plan. |

## Sales AI as the source of CRM data

Task AI becomes the local mirror of the Sales AI CRM data a close plan needs.
Sales AI's Export API (`iseeit-conversation-app/backend/src/app/export-data`)
publishes exactly four entities, all already reachable with the key Task AI uses:

| Entity | Fields | Today in Task AI | Close Plan change |
|---|---|---|---|
| `accounts` | account_id, account_name, industry, owner_id, created_at | fetched every sync, only used for an id→name lookup | upsert into new `crm_accounts` table |
| `opportunities` | opportunity_id, opportunity_name, account_id, stage, amount, close_date, owner_id | same — id→name lookup only | upsert into new `crm_opportunities` table |
| `contacts` | contact_id, contact_name, first/last name, email, title, department, account_id, owner_id | never fetched; `contacts` only learns people seen on action items | fetch the full entity; extend `contacts` with title, department, account_id, owner_id |
| `action-items` | (as today) | one-way pull, imported as tasks | **not touched here** — a bi-directional action-item sync is being built separately (2026-10-01). Close Plan only relies on the existing `externalSource`/`externalId` link on `tasks`. |

Notes:
- One Export App key = one Sales AI company, scoped to that company's records.
  That's the natural seam for the later multi-workspace version: each workspace
  stores its own `SALES_AI_BASE_URL` + key, and its synced rows carry its `workspace_id`.
- The API has no "updated since" filter, so accounts/opportunities/contacts are a
  full pull + upsert each run. The client's 20-page safety cap (2,000 rows per
  entity) needs raising or turning into a logged warning for contacts.
- Sales AI's own close-plan phases are not in the Export API. If we want plans to
  start from a customer's existing Sales AI phase configuration, that's a new
  export entity on the Sales AI side.
- Field list is from the iSEEit backend source (2026-09-30). Confirm with one
  live call per entity before relying on title/department/stage/amount.

How Close Plan uses it:
- **Create plan from an opportunity**: picker over `crm_opportunities`; plan name,
  account, target close date (`close_date`) and seller owner prefilled.
- **Buyer members**: picked from `contacts` on the opportunity's account (with
  title shown), or added by hand (and later pushed back to Sales AI if wanted).
- **Synced action items for that opportunity** land in an "Unplanned" lane on the
  plan, and someone files them into a phase. They're never shared with the buyer automatically.
- **Bi-directional action items (separate workstream)**: plan tasks are ordinary
  `tasks` rows, so once write-back exists, Sales-AI-originated plan tasks sync back
  with no Close Plan-specific work. Open question: should tasks *created* on a plan
  (by seller or buyer) also be pushed to Sales AI as new action items, or stay
  Task AI-only? Internal-only and buyer-owned tasks need an explicit rule.
- **Stage drift**: when the opportunity's `stage` or `close_date` changes in Sales AI,
  the plan shows it ("CRM close date moved to 15 Nov") rather than silently rewriting the plan.

## Adding and ordering tasks

- **+ Add a task** at the end of a phase opens an inline task card with the name
  field focused. Enter adds the task and starts the next one, Esc cancels. The
  task gets the creator as owner and the phase end as due date; clicking it opens
  the details. "New task" at the top opens the same inline row in the current phase.
- **Order**: drag a task card by its grip (shown on hover) above or below another
  task, or onto another phase to move it there (subtasks travel with it);
  keyboard: focus the grip and use the up and down arrow keys. Available to the
  selling team and to customer contacts with "All tasks" access.

## Task details layout

Same structure as Task AI's task drawer, cleaned up for a plan: title and tags
(phase, milestone, internal, added by the customer), then **Status · Phase · Due
date**, the **description**, then **subtasks directly under the description** (so
they are seen), then **Owner · Coworkers · Requested by**, sharing and milestone
switches, who hears about the task, and status updates.

People fields are chips in an input-like box. "+ Add" (or "Change" for the owner)
opens a small panel with a search box, results grouped by team, and, for plan
owners, Task AI users not yet on the plan. Typing filters, Enter picks the first
match, arrow keys move through the list, Esc closes. This replaces the plain
dropdowns Task AI uses for coworkers and recipients today; worth bringing back to
Task AI.

## Next up and client PDF

- **Next up** (top of the side panel): open tasks that are overdue or due in the
  next 14 days for whoever is viewing, overdue first, six shown ("Show all N").
- **Client PDF**: ⋮ next to the plan title → "Export PDF for <customer>" (iSEEit
  team). Opens a print-ready report preview, then the browser's print dialog
  ("Save as PDF", A4, vector text; the suggested file name is
  "Close plan – <customer> – <date>"). Contents: where we stand (phase,
  progress, next milestone, signature, go-live), key dates, a phase timeline,
  next steps, every phase with its shared tasks and subtasks (status, owner,
  coworkers, requested by, due), and both teams with roles. Internal tasks and
  subtasks of internal tasks are never included. Meant for customers who are not
  connected to the plan yet.

## Recent activity

The activity panel lists only **major updates** (closed tasks, status updates
and email replies, new tasks, moved milestones, phases added or deleted, people
invited, added or removed), the latest six. **Show all activity (N)** opens
everything, with a **summary of the last 7 days** on top. Inside Task AI it is written by AI (`POST
/api/close-plans/activity-summary`, signed-in users, same OpenAI Responses API
and model as Task AI's extraction, minimal reasoning; input is the activity
lines only, bounded to 80 lines of 300 characters, and treated as data). It is
requested once changes stop for 1.5 s and cached per state of the activity.
Without AI (stand-alone demo, AI not configured, or an error) a rule-based
summary counts closed tasks, updates, new tasks and subtasks, moved milestones
and dates, people changes and edits. **Show all activity (N)** opens the full
list grouped by day, with identical entries in a row merged ("×2").

## Status: work started means In progress

Same rule as Task AI's `autoAdvanceStatus` (`app/lib/task-activity.ts`): an
**Open** task moves to **In progress** the moment someone starts working on it.

- Someone posts a status update on it, including a reply by email.
- One of its subtasks moves to In progress or Closed.
- Work on a subtask also starts its main task (both move).

A status set by hand always wins, and a closed task is never reopened by a
note. Each automatic change is recorded in the activity ("started work on …").

## People on a task: owner, coworkers, requested by

**Naming (decided 2026-10-01):** the role Task AI stores as `recipients[]` and
shows as "For …", "Recipient", "Reporter/Recipient" or "Delegated" is called
**Requested by** in Close Plan: "Requested by Marcus Reid" on a task,
"Requested" in people counts, "Requested by you" / "Requested by me" in the
digest and filters. Worth adopting in Task AI too, so both products use one name.

Close Plan keeps Task AI's three roles unchanged, so its notification and
digest logic applies without a parallel model.

| Role | Task AI field | Meaning | In Task AI today |
|---|---|---|---|
| Owner | `owner` (one name) | Does the task, accountable for it | "My tasks"; the only role that gets overdue reminders |
| Coworker | `collaborators[]` | Helps the owner do it | Same as owner in digests ("My tasks"); can see and edit the task |
| Requested by | `recipients[]` (Task AI UI today: "For …") | The task is delivered to them / they asked for it, and they track it | "Delegated tasks you're tracking" digest section; a read-only user only ever sees tasks where they are a recipient |

How Task AI notifies today (all by **name match** against registered `users`; a
name with no Task AI account is never notified):

| Notification | Owner | Coworker | Requested by | Code |
|---|---|---|---|---|
| Real-time Slack DM on an update or close | ✓ | ✓ | ✓ | `namesToNotify` in `app/lib/task-notify.ts` (everyone on the task except the person who made the change) |
| Weekly digest (Mon) | My tasks | My tasks | Delegated | `classifyForDigest` in `app/lib/pending-tasks.ts` |
| Overdue reminder (every 2 days) | ✓ | — | — | `overdueOwnedTasks`, `scripts/send-overdue-nudges.ts` |
| New-assignment notice (daily) | ✓ | ✓ | ✓ | `isNewlyAssigned` |
| Manual "notify" button | pick anyone on the task | | | `notifyCandidates` |

Sales AI action items only have an owner and recipients (no coworkers), and the
recipients are usually the customer contacts. Synced items therefore already put
the buyer in the recipient role.

What this means for Close Plan:

- **Cross-side handoffs use the existing roles.** Example: "Return questionnaire
  and SOC 2 report", owner iSEEit Solutions Engineer, for Marcus Reid. "Waiting on
  Meridian Biotech" = open tasks whose owner is a Meridian Biotech contact.
- **Buyers aren't Task AI users,** so today's name-match notifications would skip
  them entirely. Close Plan needs to resolve plan members (with email from the
  Sales AI contact) as notification targets, not just `users`. Best done by moving
  owner/coworker/recipient matching from plain names to person ids
  (user id or contact id). That's an architecture topic for Monday, since it touches
  every notification path.
- **Internal tasks never notify Meridian Biotech people,** even if they are named on them.
- iSEEit people keep every existing Task AI notification unchanged.

### Notification rules for Close Plan (agreed 2026-10-01)

Guiding rule: **never spam the client.** At most one scheduled email per person
per plan per week.

- **Two plan owners per plan**: one on the seller side, one on the buyer side
  (Meridian Biotech default: Olivia Grant; iSEEit: Rizan Flenner).
- **Monday digest:**
  - **Plan owners** get one email: plan overview (progress, current phase,
    overdue count, next milestone), their own tasks ("My tasks" = owner or
    coworker), "Requested by you", then the rest of the plan: overdue
    elsewhere, coming up in the next two weeks, closed this week. A task appears
    only once.
  - **Other Meridian Biotech contacts** get "My tasks" + "Requested by you" for this plan only,
    and **no email at all** in a week where nothing is open for them.
  - **Other iSEEit people** get no extra email: their plan tasks are ordinary
    Task AI tasks and already appear in their regular Task AI digest.
- **Nothing else is scheduled for Meridian Biotech contacts:** no per-update emails,
  no separate overdue reminders, no new-assignment notices. Overdue items show up
  in the Monday email.
- **Reply by email (existing Task AI feature):** every task in a digest carries
  "Add an update" (no-login link) and "Reply by email" (a personal
  `reply+{token}@tasks.iseeit.ai` address). The reply is posted on that task, and
  a status change stated in the reply is applied. Today Task AI only wires this
  for the manual "notify" email. The digest emails need a reply token per task line.
  **Deferred (2026-10-01):** handled later, not part of the first Close Plan build.
- **Ask for an update (existing manual notify):** the iSEEit team can send one
  Meridian Biotech contact a single-task email on purpose. That contact can reply
  directly to update the task. It's an explicit, person-picked send, so it doesn't
  break the no-spam rule.

## Creating a plan: guide and templates

"+ New close plan" in the Task AI sidebar opens a 4-step guide. The plan is created
as a **draft**: nothing is shared and nobody on the customer side is invited until
the owner does it.

1. **Deal**: search the opportunity in Sales AI as you type (account, amount,
   stage, close date, contacts) or enter it by hand. Set the plan name, **plan
   start** (default today), **target signature** and **target go-live**.
2. **Template**: choose a starting plan. The template is **fitted into the real
   timeframe**: each template date is a day number on the template's own scale
   (signature = 0, go-live = the template's typical gap). Days before signature
   are stretched or squeezed between plan start and signature, days between
   signature and go-live between those two dates, and days after go-live keep
   their distance. The step warns when the plan starts before today or the
   timeline is much tighter than the template expects.
3. **People**: template tasks are written for roles (buyer: executive sponsor,
   project lead, technical lead, IT security, procurement, legal, end-user
   representative; seller: account lead, solutions engineer, customer success,
   project manager, designer, developer). Buyer roles are suggested from Sales AI
   job titles; "decide later" falls back to that side's plan owner. The buyer
   plan owner is chosen here; the seller plan owner is the creator.
4. **Review**: phases and tasks with owner and date; untick what the deal
   doesn't need; milestones and internal tasks are labelled.

Out-of-the-box templates:

| Template | Phases | For |
|---|---|---|
| Standard B2B | Align → Validate → Finalize → Launch → Realize Value | Most software deals |
| POC-led | Discover → Pilot / POC → Business case → Contract → Rollout | Deals that hinge on a pilot |
| Enterprise procurement | Align → Validate → Security & Legal → Procurement → Launch | Regulated buyers, long paper process |
| Renewal & expansion | Review value → Expansion scope → Commercials → Rollout | Existing customers (signature = renewal date) |
| App design & build (service) | Proposal & SOW → Discovery → Design & prototype → Build → Test & acceptance → Launch & handover | Service projects building an app with the customer (signature = SOW) |
| Product MVP with a development partner | Align → Build: core plan → Build: client access → Integrations → Harden & release → Client test | Building an MVP in about four weeks with Claude Code and a development partner on the other side for a few time-boxed reviews, then testing it with a client (signature = MVP release, go-live = test review). Used to plan the Close Plan MVP itself |
| Blank | Prepare → Decide → Implement, with the signature and go-live milestones | Anything else |

Later: "Save as template" on any plan, and company templates managed by admins.

**Deleting a plan**: the selling-side plan owner can delete a plan from the ⋮
menu next to its title, after a second confirmation that names how many phases
and tasks go and whose personal links stop working. With no plans left, the
page offers "New close plan".

**Getting started checklist** on a draft plan (seller view): check the dates with
the buyer plan owner, review internal tasks, invite the buyer plan owner, invite
the rest of the buying team. When all four are done the plan becomes active and
the checklist disappears.

The prototype now holds several plans (sidebar list under Close plans); every
screen uses the plan's account name instead of a hard-coded customer.

## Phases

- Each plan has its own phases (copied from the template), each with a name, a
  description ("what we accomplish together"), a start and an end date.
- **Phases can overlap.** The plan's order is set by the plan owners, not by
  date. More than one phase can be "current" at the same time.
- **Only the plan owners** (either side) can rename, re-describe, re-date,
  reorder (up/down), add and delete phases, all from a three-dot menu on the phase header. Deleting a phase never deletes tasks:
  an empty phase is removed straight away; a phase with tasks asks where its
  tasks go (default: the neighbouring phase), then asks once more to confirm.
- Timeline: when no phases overlap, one compact lane with every phase placed by
  date (name and dates inside the bar). As soon as any two overlap, it switches
  to a Gantt view: one row per phase in plan order on a shared
  date axis, with a "Today" line, month gridlines, and each bar filled by the
  share of that phase's tasks that are closed.

## People on the plan and access rights

The plan has a **People** tab (next to **Plan**) with both teams. The People
panel is no longer shown all the time.

**Per-person access** (stored on the plan member, not on the Task AI user):

| Setting | Options | Effect |
|---|---|---|
| Tasks | View only / Own tasks / All tasks | View only: read the shared plan. Own tasks: close and edit tasks they own or co-work on (or created), post updates on tasks they're a recipient of. All tasks: edit every task they can see. |
| Create tasks | on/off | Add tasks and subtasks (off and locked for view-only) |

Defaults: Meridian Biotech contacts = Own tasks + Create; iSEEit members = All tasks +
Create.

**Managing people is reserved for the plan owners.** The iSEEit plan owner manages
both teams and the Meridian Biotech plan owner manages the Meridian Biotech team. Everything
they configure about a person (email, plan role, invitation, access, Monday
email preview, removal) lives behind a gear icon on that person's row. Nobody
else sees the gear, the invitation status, or "Add person".

**Layout:** one full-width row per person: who they are, item count with a bar
whose length is relative to the busiest person on the plan (split into
overdue / due this week / open / closed), and their owner / coworker / for counts.
"Tasks" expands that person's tasks in place under the row; clicking one opens
the task.

**Invitation states (Meridian Biotech):** No email → Not invited → Invited (date) →
Active (has opened their link). Only invited people get the Monday digest. The
invitation email lists what they can do and the open tasks waiting for them
(Task AI's invite email already previews tasks the same way).

**Per-person stats:** items they are on (owner, coworker or requested by), split into
overdue / due this week / open / closed, plus the role breakdown and a
"Show tasks" link that filters the plan to that person.

**Adding people:** iSEEit side = existing Task AI users only. Meridian Biotech side =
Sales AI contacts of the account, or a new contact entered by hand (later
written back to Sales AI).

**Removing people:** their open owned tasks are handed to someone chosen at
removal time (default: that side's plan owner). They're taken off coworker and
recipient lists, and their personal link stops working. A plan owner can't be removed
until another plan owner is set.

## Shared storage (step A, live since 2026-10-01)

Until the full data model (step B) is built, each plan is stored **whole, as one
JSON document** in `close_plan_documents` (migration `0021`), so the iSEEit team
can work on the same plan.

- `GET /api/close-plans/store`: the signed-in user (so the page acts as them, not
  a fixed person) and the plans they can see: **Site Admins** see all, everyone
  else the plans they **created** or where their Task AI email is one of the
  plan's **iSEEit members** (`member_emails`, derived on the server). Customer
  contacts never see plans this way.
- `PUT /api/close-plans/store/:id` with the version last loaded: creates (Site and
  Area Admins only) or updates (anyone who can see it). A version mismatch returns
  409 with the latest plan; the page shows it and asks to redo the change.
- `DELETE /api/close-plans/store/:id`: soft delete, iSEEit plan owner or Site Admin.
- The page saves 0.6 s after a change, shows "Saving… / Saved / Not saved", and
  checks for others' changes every 30 s while nobody is typing.
- Someone not yet on a plan (e.g. a Site Admin) who changes it is added to the
  iSEEit team on that first change.
- Plans created before step A lived only in the creator's browser; the page offers
  a one-time **Upload** of those. The fictional demo plan can still be opened from
  the empty page but is never saved.
- Limits: whole-plan saves, so two people editing at the same moment can't both
  win (the later one is asked to redo); no customer access yet; plan tasks are not
  yet Task AI tasks (no My tasks, digests, Slack).

## Data model: built on Task AI's existing database

Plan tasks are ordinary `tasks` rows, so most of what a close plan needs already
exists. One **additive** migration (`0021_close_plan.sql`) adds what's missing.
Nothing is renamed or removed; every existing task leaves the new columns empty,
so My tasks, digests, the Sales AI sync and reply-by-email keep working unchanged.
Migrations already run automatically at startup on Render (`scripts/init-db.ts`).

**Reused as is**

| Close Plan needs | Existing structure |
|---|---|
| Tasks: title, description, owner, due, status, updates | `tasks` |
| Owner / Coworker / Requested by | `owner`, `collaborators`, `recipients` (plain names; people without an account already work) |
| Link to the Sales AI deal | `tasks.account_id/name`, `opportunity_id/name` |
| History, incl. "milestone moved from X to Y" | `task_activity` |
| Buyer contacts with email | `contacts` (Sales AI sync) |
| Selling team | `users` |
| Update without signing in, reply by email | `task_update_tokens` |
| Simple tick-boxes inside a task | `tasks.checklist` |

Reusing `project` as the plan, `topic` as the phase and `checklist` as subtasks was
considered and rejected: subtasks would lose owner and date, and a buyer scoped to a
project would also see internal tasks.

**New tables**

- `close_plans`: `title`, `account_id/name`, `opportunity_id/name`, `status`
  (draft / active / won / lost / archived), `seller_owner` (user), `buyer_owner`
  (member), `template_id`, `setup` (getting-started checklist state, jsonb), timestamps.
  A `workspace_id` can be added with the later multi-workspace work.
- `close_plan_phases`: `plan_id`, `name`, `goal`, `start_date`, `end_date`, `position`.
- `close_plan_members`: `plan_id`, `name` (as used on tasks), `email`, `side`
  (seller / buyer), `user_id` or `contact_id`, `plan_role`, `access_level`
  (view / own / all), `can_create`, `invite_status` (none / invited / active),
  `invited_at`, plus Resend delivery status like `users` has.
- `close_plan_access_tokens`: one personal, hashed, expiring link per buyer member,
  same model as `task_update_tokens`.
- Templates ship in code first; `close_plan_templates` only when "save as template" is built.

**New nullable columns on `tasks`**: `plan_id`, `phase_id`, `parent_task_id` (one level
deep), `position`, `shared_with_buyer` (default true), `is_milestone` (default false).

## Access

- **Task AI users who are customer contacts** (e.g. invited Collaborators): plan
  tasks are ordinary Task AI tasks, so `canSeeTask` would show them a plan task
  they are named on in My tasks, digests and Slack even when it is internal. The
  real build must add a rule: a task with `shared_with_buyer = false` is never
  visible to anyone on the buyer side of that plan, whatever their Task AI role.

- Internal users: existing roles. A plan is visible to its owner/members, area
  admins whose scope matches, site admins. Plan tasks still pass `canSeeTask`.
- Buyers: no Task AI account. Each buyer member gets a personal link
  `/p/<token>`. The token grants access to that one plan's shared tasks only:
  view, change status, post updates, tick checklist items, add tasks/subtasks,
  edit tasks they created or own. Never internal tasks, never other plans.
  Later option: upgrade frequent buyers to real accounts (passkey/Google).

## Screens

1. **Plans list** (`/plans`) — per deal: phase progress, % done, overdue count, target close date.
2. **Plan editor** (`/plans/[id]`) — phases as columns or stacked sections, tasks with
   expandable subtasks, owner/due/status inline, internal/shared toggle, invite buyers,
   copy share link.
3. **Buyer view** (`/p/[token]`) — clean, seller-branded page: timeline of phases,
   "your tasks" first, add task/subtask, post update.
4. **Templates** (`/plans/templates`) — edit default phases and starter tasks.

## Notifications and email: reuse from Task AI

Every scheduled Task AI email and Slack message starts from `users` (active
accounts). Buyers have no account, so the no-spam rule mostly comes for free.

**Selling team, unchanged**: plan tasks are Task AI tasks, so they get the Slack
message on update/close (`notifySlackOnTaskChange`), the weekly digest, overdue
reminders and new-assignment notices (`scripts/send-*.ts`), with their own
notification preferences.

**Buyers, reused as is** (these take a plain name and email, not an account):
- "Add an update" links: `createTaskUpdateToken` / `applyTaskUpdateViaToken`. The
  update is credited "Name (via email)" and the selling owner gets the Slack message.
- "Ask for an update" email with reply-by-email and status from the reply:
  `sendManualNotify` + the inbound-email webhook.
- Sending, layout and task cards: `sendWithResend`, `app/lib/email.ts`.

**Buyers automatically excluded** from real-time Slack, overdue reminders and
new-assignment notices (all iterate `users`), as agreed.

**To build or extend**
- Weekly plan job: Monday email per buyer member (My tasks, Requested by you) and the
  plan overview for both plan owners; iterates `close_plan_members`, reuses the
  existing email sections; only the overview block is new.
- `notifyCandidates`: also list plan members, so "Ask for an update" can pick buyers.
- Filter `shared_with_buyer` in every buyer-facing path.
- Buyer invitation email with the personal plan link (Task AI invite layout, no account).
- Resend delivery webhook: also update `close_plan_members`.
- Reply-by-email from the weekly email: deferred.

## Build order

0. Sales AI sync extension: `crm_accounts`, `crm_opportunities`, full contacts.
   Action items stay with the separate bi-directional sync work. Useful to Task AI
   on its own, so it can ship first.
1. Schema + migration (`0021_close_plan.sql`), default workspace + template seed.
2. Plan CRUD API + internal plans list/editor with phases, tasks, subtasks.
3. Buyer members, access tokens, `/p/[token]` view with view/update/add.
4. Notifications (seller alerts on buyer activity, buyer digest).
5. Plan ↔ CRM: create from opportunity, buyer picker from account contacts,
   "Unplanned" lane for synced action items, stage/close-date drift notices.
6. Later: multi-workspace isolation, per-workspace Sales AI credentials and branding.
