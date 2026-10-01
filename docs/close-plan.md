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

1. **Deal**: pick the opportunity from Sales AI (account, amount, stage, close
   date, contacts) or enter it by hand. Set the plan name, **target signature**
   and **target go-live**.
2. **Template**: choose a starting plan. Every phase and task date is an offset
   from signature ("S") or go-live ("G"), so the whole plan is dated from those
   two dates. The step warns when the plan would start before today.
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
| Blank | Prepare → Decide → Implement, with the signature and go-live milestones | Anything else |

Later: "Save as template" on any plan, and company templates managed by admins.

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

## Data model

New tables:

- `workspaces` — one row ("default") in V1.
- `close_plans` — `workspace_id`, `name`, `account_id/name`, `opportunity_id/name`
  (Sales AI ids, same shape as on `tasks`), `target_close_date`,
  `owner` (seller), `status` (Active / Won / Lost / Archived), `created_by`, timestamps.
- `close_plan_phases` — `plan_id`, `name`, `position`, `color`, optional `target_date`.
- `close_plan_templates` + `close_plan_template_phases` (+ optional template tasks) —
  the editable defaults copied into a new plan.
- `close_plan_members` — the people on a plan: internal users and external buyer
  contacts (`name`, `email`, `side` seller/buyer, optional `contact_id`).
- `close_plan_access_tokens` — per buyer member, hashed + expiring, same model as
  `task_update_tokens`. Identifies *who* the buyer is so their edits are attributed.

Additions to `tasks`:

- `plan_id`, `phase_id` — null for every ordinary Task AI task (unchanged behavior).
- `parent_task_id` — subtasks; only one level allowed (enforced in app code).
- `position` — ordering within a phase / parent.
- `shared_with_buyer` boolean — internal-only steps (discount approval, legal review)
  stay hidden from the buyer view. Buyer-created tasks are always shared.

Plan tasks are real Task AI tasks, so seller-side items automatically appear in
My tasks, digests, overdue nudges, Slack, Task History and reply-by-email.

## Access

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

## Notifications

- Buyer adds/updates a task → seller owner gets Slack/email (reuse `task-notify`).
- Buyer-owned tasks: weekly plan digest email to each buyer with their open
  items + link back to `/p/<token>` (new cron, or folded into the weekly job).
- Overdue buyer tasks are nudged to the *seller* owner, not the buyer, in V1.

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
