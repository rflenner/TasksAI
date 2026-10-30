# Task AI data structure: Close Plans, Contacts, Org charts

For the Sales AI chat. Read-only description of the Postgres schema in the Task AI app (repo `rflenner/TasksAI`, `db/schema.ts`, migrations in `drizzle/`, latest 0038). The sample files next to this one are **fictional**; real customer data is never in the repo.

Samples: `sample-close-plan.json`, `sample-contacts.json`, `sample-org-chart.json`.

## How the pieces relate
- **Sales AI → Task AI:** the `contacts` table is filled by the Sales AI sync (`app/lib/sales-ai-sync.ts`, `sales-ai-mapping.ts`). Sales AI opportunity ids are Salesforce opportunity ids (`006…`), contact ids are `003…`, account ids `001…`.
- **Close plan ⇄ Salesforce:** a plan stores `sfdcOpportunityId` and the Salesforce ids of its phases, tasks and people (see "Salesforce fields" below). Close Plan is the master; Salesforce is the reporting copy.
- **Org charts** are copied from Salesforce (iSEEit package role objects) and can be edited in Task AI.
- A plan is **one JSON document** (`close_plan_documents.data`), not relational rows. Tasks, phases and people live inside it.

## Tables

### `contacts` (Sales AI contact reference; independent of Task AI logins)
| Column | Type | Meaning |
|---|---|---|
| id | serial PK | |
| name | text | |
| email | text? | |
| sales_ai_contact_id | text? **unique** | Sales AI / Salesforce Contact id, the match key for re-syncs |
| sales_ai_account_id / sales_ai_account_name | text? | Last account the contact was seen on |
| sales_ai_opportunity_id / sales_ai_opportunity_name | text? | Last opportunity seen on (last write wins, no history) |
| created_at / updated_at | timestamptz | |

### `close_plan_documents` (one row per plan)
| Column | Type | Meaning |
|---|---|---|
| id | text PK | Plan id |
| title, account | text | Plan title, account name |
| data | jsonb | The whole plan, see "Plan JSON" |
| member_emails | jsonb | Emails of people with access (used for visibility) |
| version | int | Optimistic-lock counter; saves must send the version they read |
| created_by / updated_by | int? | Task AI user ids |
| created_at / updated_at / deleted_at | timestamptz | Soft delete via `deleted_at` |

### Plan child tables
| Table | Purpose | Key columns |
|---|---|---|
| `close_plan_links` | Personal links for customer contacts | plan_id, person_id (id inside the plan JSON), token_hash (sha256 only), expires_at, revoked_at, last_used_at |
| `close_plan_attachments` | PDF files on tasks (bytea) | id, plan_id, task_id, name, size, content_type, shared, uploaded_by/_name/_side, data |
| `close_plan_photos` | Person photos from Salesforce | plan_id, person_id, source, source_id, content_type, data_base64 |
| `close_plan_access_log` | Admin-only activity log | at, plan_id, plan_title, user_id, person_id, person_name, side, via, event, task_id, task_title, detail |
| `close_plan_email_log` | Which notification emails were sent | kind, plan_id, person_id, email, task_id, sent_at |
| `close_plan_notification_rules` | Who is told about what | id, rules (jsonb) |
| `close_plan_role_settings` | Role suggestions for plans | id, roles (jsonb) |

### `org_charts` (migration 0033 onward)
| Column | Type | Meaning |
|---|---|---|
| id | text PK | |
| kind | text | `opportunity` or `account` |
| sfdc_id | text | Opportunity (006…) or Account (001…) id; unique with kind |
| name, account_id, account_name | text | |
| data | jsonb | `{ nodes, roots, issues, salesforceBase }` as loaded from Salesforce |
| edited, edited_at, edited_by | jsonb?, ts?, int? | The chart as changed in Task AI (NULL = not edited) |
| influences | jsonb | `[{ id, from, to, strength 1-3, tone?, note }]`, who influences whom |
| people | int | Number of real (non-provisional) people |
| logo | text | Company logo web address from Sales AI, "" = none |
| imported_by / imported_at | | |

Node fields (`data.nodes[]`): `key` (Contact 003… or provisional a1C… id; parents point at it), `roleId`, `name`, `title`, `email`, `phone`, `description`, `provisional`, `type` (Champion, Coach, Enemy, Influencer, Neutral), `dealRole`, `powerBase`, `parentKey`, `order`, `linkedin`, `left` (left the company), `openTasks`, `activity` (0-4 coverage by meetings and action items), `layout`, `photo`.

### Access (users table)
Per-user switches on `users`: `can_invite`, `can_create_plans`, `can_view_org_charts` (migration 0038). Roles: site admin sees everything.

## Plan JSON (`close_plan_documents.data`)
```
id, title, account, accountId, domain, status ("draft" | …), seq (counter for task ids)
opp { name, stage, amount }, sfdcOpportunityId
planOwners { buyer, seller }          // person ids
people[]  { id, name, email, title, role, side "seller"|"buyer",
            access { level "all"|"own", create, manage }, invite { status, openedAt },
            sfdcUserId?, sfdcContactId?, contactIds? }
phases[]  { id, name, goal, start, end, sfdcId?, sfdcSeen?, sfdcRank?, sfdcSkip? }
tasks[]   { id, phase, parent (task id | null = subtask), title, desc, owner, coworkers[], recipients[],
            due ("YYYY-MM-DD", may be absent), status "Open"|"In progress"|"Closed", closedAt,
            shared (false = internal only), milestone, key ("sign"|"live"|…),
            createdBy, updates[{ at, by, text, removed? }], dateChanges[{ from, to, … }],
            sfdcId?, sfdcSeen?, sfdcRank? }
activity[] { at, by, task, text }     // plan-level log; Salesforce-originated entries use author "Salesforce"
```
`sfdcSeen` is the field values at the last Salesforce sync (used for the three-way merge: only Salesforce changed → pull, only the plan → push, both → plan wins).

## Salesforce fields used (iSEEit package)
Phase `iseeit__Current_Phase__c` (title, order, start/end); task `iseeit__TO_DO__c` (title, description `iseeit__Checklist_Description__c`, status `iseeit__Phase_Checkpoint_Status__c`, deadline, `iseeit__Interaction_Type__c` Mutual/Internal, owners `iseeit__Phase_Checkpoint_Owner__c`, order, `iseeit__Is_From_Close_Plan__c`). Org chart: `iseeit__Opportunity_Role__c`, `iseeit__Account_Contact_Role__c`. Details: `docs/close-plan-salesforce.md`.

## Getting real data (not in the repo)
Production is Render Postgres; read it with a read-only user, for example `\copy (select …) to 'private/x.csv' csv header`, into the gitignored `private/` folder. Treat contacts, org charts and plan text as personal data. Never commit it and never print connection strings or tokens (`salesforce_connection` holds encrypted tokens; do not export it).

## Caveats
- Plan visibility is checked in code (`canAccessPlan`, `member_emails`), not by database rules, so a direct database read bypasses it.
- The customer-facing view filters internal tasks and updates (`app/lib/close-plan-share.ts`); raw `data` contains everything.
