# Close Plan ⇄ Salesforce: handover summary

For a new chat. Facts checked against the code on 2026-10-25. Detail: `docs/close-plan-salesforce.md` (field mapping, deviations D1–D13). Test data is fictional or from the iSEEit test org; no keys here.

## 1. Principle (decided 2026-10-02)
- Close Plan (Task AI, `prototype/close-plan-demo.html` + `close_plan_documents` JSON) is the interactive master.
- Salesforce (iSEEit package, org "nowiseeit") is the reporting copy. On conflict **Close Plan wins**; the overwritten Salesforce value is noted in the plan activity (author "Salesforce").
- Pilots may have Salesforce but no Sales AI, so Sales AI must stay optional.

## 2. How we connect
- **One workspace-wide OAuth connection** (Habilelabs, PR #161): a Site Admin enters the Salesforce login domain on `/integrations` and clicks Connect. OAuth 2.0 authorization code + PKCE, scopes `api refresh_token`.
- Code: `app/lib/salesforce.ts`; routes `app/api/integrations/salesforce/{connect,callback,route}.ts`; UI `app/integrations/SalesforceConnectionCard.tsx`.
- Needs a Salesforce **Connected App** (callback `https://tasks-ai.onrender.com/api/integrations/salesforce/callback`, PKCE) and Render env vars `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` (never print or paste them).
- Storage: table `salesforce_connection` (single row id=1). Tokens are AES-256-GCM encrypted, key derived from `SESSION_SECRET`; rotating it means reconnecting.
- Token handling: `ensureSalesforceTokenFresh()` refreshes under a Postgres advisory lock (rotation-safe); `invalid_grant` marks the connection "expired"; one retry on 401.
- Safety: the domain must be a Salesforce-owned host (`salesforce-domain.ts`), because the secret is posted to it. Typed search text goes into SOQL only through `opportunitySearchSoql` (allowlisted characters).
- API: REST `v62.0`. All calls go through `salesforceApi<T>(path, {method, body})`. Binary download: `salesforceDownload`.
- Known limitation (parked): every write lands as the admin who connected, bypassing the acting user's Salesforce rights. Plan is per-user OAuth; open decisions are in the memory note "closeplan-per-user-salesforce".

## 3. Object mapping
| Close Plan | Salesforce |
|---|---|
| Plan | `Opportunity` (never created by us; id stored as `sfdcOpportunityId`) |
| Phase | `iseeit__Current_Phase__c` (title, `Phase_Order__c` "1"–"27", start/end dates) |
| Task | `iseeit__TO_DO__c` with `iseeit__Is_From_Close_Plan__c = true` |
| Subtask | Standard `Task` via `iseeit__TaskEvent_TO_DO__c` — **not built yet** |

Task fields: title `iseeit__Title__c`; description `iseeit__Checklist_Description__c`; status `iseeit__Phase_Checkpoint_Status__c` (Open / In Progress / Done; never push "Due"); due `iseeit__Deadline__c`; shared vs internal `iseeit__Interaction_Type__c` (Mutual / Internal); owners `iseeit__Phase_Checkpoint_Owner__c` (comma-separated User 005… and Contact 003… ids, owner first); order `iseeit__Close_Plan_Order__c` (picklist "0"–"26", so max 27 tasks per phase); phase link `iseeit__Current_Phase__c`. No Salesforce field exists for requested-by, milestone or phase description.

## 4. How we write back (built 2026-10-18)
Logic: `app/lib/close-plan-sfdc-sync.ts` (pure, DB-free, tested in `tests/close-plan-sfdc-sync.test.ts`). Route: `POST /api/close-plans/store/:id/sfdc-sync` with `mode: "preview"` (writes nothing) or `"apply"` (+ optional `sendUnlinked`). Allowed for plan owner and admins.

- **Three-way merge per field.** Each linked task/phase keeps `sfdcSeen` (values at last sync). Only Salesforce changed → pull; only plan changed → push; both → plan wins.
- **Linking:** phases match by Salesforce id, else name; tasks with the same title in a matching phase are adopted, not duplicated.
- **First sync:** plan-only tasks/phases are held back unless "Also create…" is ticked, then marked `sfdcSkip`.
- **Writes:** batched `composite/sobjects` calls with `allOrNone=false` (POST create, PATCH update, DELETE), phases first, then tasks. Deleting a linked task records `sfdcDeleted`; the next sync deletes the checkpoint (recycle bin). A checkpoint deleted in Salesforce removes the task here; one that only left the close plan is unlinked.
- **Owners/people:** ids looked up by email (iSEEit people from `User`, customers from `Contact`); owners are written only when everyone on the task has an id. Unknown owners found in Salesforce are added to the plan. A Sales AI contact id starting `003` is used as the Contact id.
- **Order/phase moves** sync both ways by rank (`sfdcRank`, `sfdcSeen.phase`).
- **Automatic:** a plan that has synced once checks Salesforce when opened and writes changes back about 3 s after each save (`sfAutoRun` in the page). A sync with no changes saves no new version.
- **Import:** sidebar "Import from Salesforce" (`POST /api/close-plans/store/import-salesforce`, read-only) seeds a draft plan from an opportunity's iSEEit close plan.
- **Other reads:** opportunity search (`app/lib/salesforce-opportunity-search.ts`, Playground `/playground`), contact photos from the org chart (`app/lib/close-plan-photos.ts`), people lookup.

## 5. Not built / open
- Subtasks (standard `Task`), deleting phases in Salesforce, scheduled background sync, Chatter posts for updates.
- Still to verify on a test opportunity: do API-created checkpoints show in the iSEEit view and PDF; how linked `Task`s render; does a deadline push re-derive phase dates.
- Per-user OAuth (see above). First sync of the CluePoints plan is pending; Salesforce writes need the owner's go-ahead.
- Test opportunities: `006Qs00000nLiA4IAK` ("15 OCT CRM"), `006Qs00000msL0gIAE` ("Closeplan MVP").
- Habilelabs is the dev partner: keep their effort minimal.
