# Close Plan → Salesforce (iSEEit package): mapping and deviations

Spec for the tech team. Checked read-only against the iSEEit package objects in
the iSEEit Salesforce org on 2026-10-02 (API v66.0). Examples use fictional data.

## Principle

- **Close Plan is the master.** It is fed by Sales AI (calls, emails) and by items
  the customer and the sellers add. All editing happens in Close Plan.
- **Salesforce gets a one-way copy for reporting** in the existing iSEEit close plan
  structure. Close Plan always wins: a change made in Salesforce is overwritten by
  the next push.
- An optional **one-time import** from Salesforce can seed a new plan from an
  existing iSEEit close plan (see "Reading people from Salesforce").

## Object mapping

| Close Plan | Salesforce object | Link |
|---|---|---|
| Plan | `Opportunity` (exists, not created by us) | `close_plans.opportunity_id` = Salesforce Opportunity Id (via Sales AI) |
| Phase | `iseeit__Current_Phase__c` | `iseeit__Opportunity__c` |
| Task | `iseeit__TO_DO__c` ("iSEEit Current Checkpoints") with `iseeit__Is_From_Close_Plan__c = true` | `iseeit__Opportunity__c`, `iseeit__Current_Phase__c` |
| Subtask | Standard `Task` | `iseeit__TaskEvent_TO_DO__c` → parent checkpoint, `WhatId` → Opportunity |
| Update / activity | Optional: Chatter `FeedItem` on the checkpoint (feed tracking is on for `iseeit__TO_DO__c`) | `ParentId` |

Linking a standard `Task` to a checkpoint through `iseeit__TaskEvent_TO_DO__c` is
what the iSEEit package already does for its checkpoint follow-ups, so subtasks
need no package change.

`iseeit__Current_Picklist_Option__c` looks like a checklist but is not one: these
are the answer options of a checkpoint question (template-bound, tick + text, no
owner or date). Don't use it for subtasks.

## Field mapping

### Phase → `iseeit__Current_Phase__c`

| Close Plan | Salesforce field | Note |
|---|---|---|
| name | `iseeit__Title__c` (255) | |
| position | `iseeit__Phase_Order__c` | Picklist "1"–"27" |
| start / end date | `iseeit__Start_Date__c` / `iseeit__End_Date__c` | **Don't push** (D6) |
| description (goal) | — | **No field** (D4) |
| progress | `iseeit__Phase_Score__c` | Calculated by iSEEit, don't push |

### Task → `iseeit__TO_DO__c`

Every field is creatable and updatable; no template link
(`iseeit__Default_Checklists__c`) is required.

| Close Plan | Salesforce field | Note |
|---|---|---|
| title | `iseeit__Title__c` (255) | Truncate |
| description | `iseeit__Checklist_Description__c` (long text, 50k) | Shown as "Information" in the iSEEit view and PDF. Set `iseeit__Checklist_Description_Length__c` too |
| status | `iseeit__Phase_Checkpoint_Status__c` | Open → `Open`, In progress → `In Progress`, Closed → `Done`. iSEEit also has `Due`; never push it |
| due date | `iseeit__Deadline__c` | |
| shared with customer / internal | `iseeit__Interaction_Type__c` | shared → `Mutual`, internal → `Internal`. `External` is unused |
| owner + coworkers | `iseeit__Phase_Checkpoint_Owner__c` (comma-separated Ids) + `iseeit__Checkpoint_Phase_Owner_Description__c` (names joined by " \| ") | User (`005…`) **and** Contact (`003…`) Ids are accepted. Owner first (D1) |
| requested by | — | **No field** (D1) |
| milestone | — | **No field** (D3) |
| position | `iseeit__Close_Plan_Order__c` | Template picklist with duplicates; leave empty |
| — | `iseeit__Is_From_Close_Plan__c` | Always `true` |
| — | `iseeit__Checklist_Status__c` ("Checkpoint Rating") | Don't touch; iSEEit sets it to "Completed" when a description exists |

### Subtask → standard `Task`

| Close Plan | Salesforce field | Note |
|---|---|---|
| title | `Subject` | Prefix "[Close plan] " so reps can filter them out |
| description | `Description` | |
| due date | `ActivityDate` | |
| status | `Status` | Open → `Not Started`, In progress → `In Progress`, Closed → `Completed` |
| owner (seller side) | `OwnerId` | **Must be a User** (D2) |
| customer person on it | `WhoId` + `iseeit__Recipient_List__c` (Contact Ids, comma-separated) | |
| shared / internal | `iseeit__Interaction_Type__c` | Same values as on the checkpoint |
| parent task | `iseeit__TaskEvent_TO_DO__c` | Checkpoint Id |
| plan | `WhatId` | Opportunity Id |
| — | `IsReminderSet = false` | No Salesforce reminders for synced subtasks |

## Reading people from Salesforce

Salesforce **cannot** tell owner, coworker and requested-by apart.

| Where | What's there | Roles? |
|---|---|---|
| Checkpoint | `iseeit__Phase_Checkpoint_Owner__c`: one flat list of User and Contact Ids, in the order they were added | No. All are "owners" |
| Follow-up Task | `OwnerId` (one User) + `WhoId` / `iseeit__Recipient_List__c` (Contacts) | Owner, plus the closest thing to "requested by / for" |
| `iseeit__Contact_Role_Tagging__c` | Exists on checkpoints but is empty everywhere | — |
| `iseeit__Opportunity_Contact_Role__c` / `iseeit__Opportunity_Role__c` | Deal roles per contact (`iseeit__Role__c`, org chart, power base) | Deal roles, not task roles. Useful to suggest the customer plan owner (e.g. the Champion) |

Import rule (seeding a plan from Salesforce): first User in the owner list → Owner;
everyone else in the list → Coworkers; Requested by stays empty. On a follow-up
Task, `WhoId` / recipient contacts → Requested by.

## Deviations Close Plan has to handle

| # | Deviation | What Close Plan does |
|---|---|---|
| D1 | No roles on a checkpoint: owner, coworkers and requested by collapse into one owner list | Push owner first, then coworkers. Requested by is not pushed on tasks (only on subtasks, as recipients). On import, apply the import rule above |
| D2 | A `Task` owner must be a Salesforce User; customer contacts can't own one | Customer-owned subtask: `OwnerId` = seller plan owner, customer in `WhoId`. Reports will count it as seller-owned |
| D3 | No milestone flag | Not pushed. Optional: prefix the title with "◆ " |
| D4 | No phase description | Not pushed |
| D5 | Only one description per checkpoint, no history | Push the task description. Optional: post each major update (Sales AI insight, customer reply, status change) as a Chatter post on the checkpoint |
| D6 | iSEEit sets phase dates from checkpoint deadlines (e.g. a phase becomes 5–5 Oct from one deadline) | Don't push phase dates; let iSEEit derive them. Overlapping phases in Close Plan are not reflected exactly |
| D7 | Status has no "Due"; "Done" vs our "Closed" | Fixed mapping (tables above) |
| D8 | No field for our Ids, so Salesforce can't find our records | Store the Salesforce Ids on our side (data model below) and update by Id; never match on title |
| D9 | Subtasks appear in the reps' Salesforce task lists and activity timeline | "[Close plan] " prefix, reminders off |
| D10 | The iSEEit Salesforce PDF export prints **internal** checkpoints as well | Out of our control. Tell users to export from Close Plan, whose PDF leaves internal tasks out |
| D11 | The iSEEit view hides untouched template checkpoints | Don't import template checkpoints without an owner, deadline, status change or description |
| D12 | Deleting in Close Plan | Delete the checkpoint / Task in Salesforce (or set N/A via `iseeit__Checkpoint_N_A__c` to keep reporting history; to decide) |
| D13 | People, access rights, invites, personal links, digests, activity summary, templates | Close Plan only, not pushed |

## Data model additions in Close Plan

- `close_plan_phases.sfdc_id`
- `tasks.sfdc_id` (checkpoint Id for tasks, `Task` Id for subtasks), `tasks.sfdc_synced_at`, `tasks.sfdc_error`
- `close_plan_members.sfdc_user_id` / `sfdc_contact_id`. Contact Ids come from Sales AI; seller User Ids need a lookup by email on `User`
- A push job: debounce per plan (e.g. 1 min after the last change), upsert phases first, then tasks, then subtasks. API use is small against the org's 100k/day limit

## Still to test (needs one test write in Salesforce)

1. Does a checkpoint created through the API, without a template link, show in the
   iSEEit close plan view and PDF?
2. How does the iSEEit view show a `Task` linked through `iseeit__TaskEvent_TO_DO__c`?
3. Does a push to `iseeit__Deadline__c` re-derive the phase dates straight away?
