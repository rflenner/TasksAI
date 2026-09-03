# Task AI

Task AI turns meeting minutes, forwarded emails, spoken notes, and a synced CRM into accountable action items — while enforcing role-, relationship-, and work-area access on every one of those paths. Runs on standard Next.js/Node.js with PostgreSQL, deployed on Render.

## Features

- **Multiple ways to capture work**: manual entry, AI extraction from pasted meeting minutes, voice dictation, forwarding an email, and an automated sync from the Sales AI CRM. The three AI-driven paths share one extraction pipeline (`app/lib/task-extraction.ts`) and the same permission checks a manual create would hit.
- **Organization**: group by owner, project, recurring meeting, topic, priority, or creation date; filter by priority, source, or free text; quick stat tiles for open / overdue / due-this-week / completed.
- **Follow-through**: per-task status updates, a fully auto-generated change history, daily/weekly digest emails, an overdue nudge, a same-day new-assignment nudge, and a no-login "reply to update" link inside every digest email.
- **Access control**: four roles (Site Admin, Area Admin, Collaborator, Read-only), each additionally scopable to specific projects, meetings, or topics — enforced identically whether a task is created by a person in the UI or by an AI extraction pipeline.
- **Sign-in**: passkeys (WebAuthn), Google OAuth, an email magic-link/one-time-code, and an admin-issued temporary password fallback for accounts whose email isn't reliably arriving.
- **Data hygiene**: a Site Admin can prune stale or hallucinated project/meeting/topic/person suggestions without touching any task still using them.

## Local development

Requirements: Node.js 22.13+, Corepack/pnpm, and PostgreSQL 15+.

1. Copy `.env.example` to `.env.local` and replace every placeholder. Never commit `.env.local`.
2. Create the local PostgreSQL database named in `DATABASE_URL`.
3. Run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm db:init`, and `pnpm dev`.
4. For the first local admin only, set `BOOTSTRAP_SITE_ADMIN=true` for one `pnpm db:init` execution, then set it back to `false`.

Useful checks:

```sh
pnpm lint
pnpm test
pnpm test:db # set TEST_DATABASE_URL first
pnpm build
pnpm check   # lint + test + build, what CI-equivalent verification runs before every merge
```

## Architecture

- **Next.js 16** (App Router), **PostgreSQL**, **Drizzle ORM** — no separate backend service; API routes under `app/api/*` are the entire server.
- **OpenAI Responses API** (strict JSON Schema output) for all AI extraction — meeting minutes, dictation, and forwarded email all go through the same prompt/schema in `app/lib/task-extraction.ts`. A deterministic browser-side fallback parser covers pasted-minutes extraction when the API is unavailable.
- **Resend** for all outbound email (invitations, digests, nudges) and, since September 2026, inbound email receiving (see "Creating tasks by forwarding an email" below).
- **Deepgram / OpenAI Whisper** for voice dictation transcription (`app/dictate`).
- Sessions are opaque, HMAC-signed random tokens; only their SHA-256 hash is stored. Every webhook (Resend delivery-status, Resend inbound-email) is Svix-signature-verified before anything touches the database. Passwords (the admin-issued fallback only — see below) are hashed with `scrypt`, never stored or transmitted in plaintext outside the one-time response to the admin who generated them.
- Deployed on Render via `render.yaml` (a Blueprint): one web service, one Postgres database, and four Cron Jobs — see "Scheduled jobs" below.

## Authentication and access

Four ways to sign in to an existing (invited) account — nothing here ever creates a new account on its own:

- **Passkey (WebAuthn)** — registered from `/account`, offered first on `/login` when the browser supports it.
- **Google OAuth** — "Continue with Google." Requires the signing-in Google account's email to already match an active Task AI user; it's a second door into an existing account, not a signup flow.
- **Email magic-link / one-time code** — a one-click sign-in link plus an 8-character fallback code (32-character alphabet, ambiguous characters excluded), both expiring in 15 minutes and single-use. The link points at `/login/confirm` — a normal page, not an API route — and only calls `/api/auth/verify` when the person explicitly clicks "Sign in to Task AI" there. That's deliberate: an API route that auto-verifies and redirects on a bare GET is what triggered Chrome's phishing heuristic on this domain previously, and is also the shape that gets silently "clicked" (and the one-time code burned) by email link-scanners like Outlook Safe Links before the recipient ever opens the message.
- **Admin-issued password** — a fallback for accounts whose invitation/login email isn't reliably arriving (a Microsoft-shop domain silently dropping it was the motivating case). A Site Admin generates a temporary password from **Users & access** and relays it out of band — WhatsApp, Slack, in person — never through Task AI's own email, since that would depend on the exact delivery channel this exists to work around. Deliberately admin-only: there is no self-service "forgot password" flow. Rate-limited (5 attempts → 15-minute lock, tracked in the database so it survives a restart) and never distinguishes "wrong password" from "no such account" in its error message.

Other access-model notes:

- Invitations contain random single-use tokens; only SHA-256 hashes are stored.
- Accepting an unexpired invitation verifies the invited email address and requires first name, last name, and company.
- Browser sessions use a random opaque identifier signed with HMAC-SHA256. Only its hash is stored in PostgreSQL; the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Mutating APIs reject cross-origin requests.
- All API authorization is derived from the active session and database role. Client-provided email headers and unsigned identity cookies are ignored.
- Four roles — **Site Admin** (unrestricted), **Area Admin** (scoped to assigned projects/meetings/topics, may invite within that scope), **Collaborator** (sees tasks they own, co-work, or are named on, plus any explicit scope), **Read-only** (sees only tasks where they're the named recipient, within scope). The same `canSeeTask`/`canCreateTask`/`canWriteTask` checks in `app/lib/permissions.ts` are enforced everywhere a task can be created or read, including the AI-driven email and dictation paths — a scoped user's forwarded email can't mint a task outside what they could create through the UI either.

## Deploy to Render

1. In Render, choose **New → Blueprint** and connect this repository. Render reads `render.yaml` and creates the web service, the PostgreSQL database, and four Cron Jobs.
2. Enter every `sync: false` variable in the Render dashboard (see `render.yaml` for the current list — currently `SITE_ADMIN_COMPANY`, `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `SALES_AI_API_KEY`, `SALES_AI_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`). They are never stored in Git.
3. Keep `TASK_AI_FROM_EMAIL` as `Task AI <notifications@tasks.flenner.at>`. The `tasks.flenner.at` domain must remain verified in Resend for *sending* — that's independent of what `APP_URL` points to (see below), so this stays put even while the custom domain itself isn't in use for links.
4. On the first deployment only, change `BOOTSTRAP_SITE_ADMIN` to `true` and deploy. Startup applies migrations and idempotently creates the configured `SITE_ADMIN_EMAIL` as Site Admin.
5. Immediately set `BOOTSTRAP_SITE_ADMIN` back to `false` and redeploy. The existing admin remains intact.
6. `APP_URL` (web service and every cron job) controls the origin used for every link inside outgoing emails via `appLinkOrigin`/`appLinkUrl` in `app/lib/request.ts`. It currently points at the Render URL, `https://tasks-ai.onrender.com`, not the custom domain `tasks.flenner.at`: that domain's DNS is blocked by an MX record on the same `tasks` host (needed for inbound mail on a different, unrelated app) that conflicts with the CNAME this site needs. Move `APP_URL` back to `https://tasks.flenner.at` once that's resolved, e.g. by moving the app to its own subdomain instead of the bare `tasks` host.
7. Verify `/api/health`, request a sign-in code for the Site Admin, and send a test invitation.
8. In the Resend dashboard, add a **Webhook** pointed at `<your APP_URL>/api/webhooks/resend`, subscribed to `email.delivered`, `email.bounced`, `email.complained`, and `email.delivery_delayed`. Copy its signing secret into `RESEND_WEBHOOK_SECRET` on the web service. Without it the webhook endpoint just logs and no-ops; invitations still send, but bounce/complaint status won't show up in Users & access. **If `APP_URL` changes, update this webhook URL in Resend's dashboard to match** — it isn't automatic.
9. For the email-to-task pipeline, see "Creating tasks by forwarding an email" below — it needs its own DNS, its own Resend webhook, and its own `RESEND_INBOUND_WEBHOOK_SECRET`, currently set directly in the Render dashboard rather than in `render.yaml` (see the note in that section — this is a known gap in the Blueprint's reproducibility).

Database initialization runs before every `next start`; applied migration filenames are recorded in `app_migrations`, so startup is safe and idempotent. A migration failure stops the service instead of starting against an unknown schema.

## Scheduled jobs

Four Render Cron Jobs, all defined in `render.yaml`:

| Job | Schedule | Script | What it does |
|---|---|---|---|
| `tasks-ai-weekly-reminders` | Monday 05:00 UTC | `send-weekly-reminders.ts` | Personal digest per active user — **My tasks** (open, owner or coworker), **Delegated tasks** (open, recipient only), **Recently closed** (last 24h). Was daily until the overdue nudge below took over that job. |
| `tasks-ai-overdue-nudges` | every 2 days, 05:00 UTC | `send-overdue-nudges.ts` | A tighter nag cycle than the weekly digest, but only for the task's actual owner — never a coworker or recipient loosely attached. Skips anyone with nothing overdue. |
| `tasks-ai-new-task-nudges` | daily, 06:15 UTC | `send-new-task-assignments.ts` | Same-day notice for a fresh assignment (owner, coworker, or recipient) within a 26-hour lookback, separate from the weekly/overdue cadence so a new task doesn't wait to be noticed. Timed just after the Sales AI sync below so same-day synced items are already included. |
| `tasks-ai-sales-ai-sync` | 6×/day (00/06/10/14/18/22 UTC) | `sync-sales-ai.ts` | Imports today's action items from the Sales AI CRM. Always safe to re-run — an already-imported item is a no-op via the `externalId` uniqueness constraint on `tasks`. |

Every digest/nudge email includes a per-task "Add an update →" link that posts a status update without requiring login (`app/lib/task-update-tokens.ts`), alongside the regular task cards that open the full app.

Run any of these manually: `pnpm reminders`, `pnpm overdue-nudges` (needs `DATABASE_URL`, `APP_URL`, and optionally `RESEND_API_KEY` — without a Resend key they log what would have sent instead of erroring).

## Creating tasks by forwarding an email

Forwarding an email (or sending one directly) to an address at **`tasks.iseeit.ai`** creates tasks through the same AI extraction pasted meeting minutes use, with three deliberate guardrails:

- **One task per email by default.** An email listing several sub-points or bullets doesn't automatically become several separate tasks — only an explicit ask ("create multiple tasks", "second task", etc.) splits it, same rule and collapse-backstop as voice dictation.
- **Identity resolved by email address, not spelled name.** Every `"Name <email>"` pair found in the email text — typically the quoted From/To/Cc header lines a forward carries — is cross-checked against both registered users and known Sales AI contacts by the actual address. That canonical name wins over whatever spelling the AI model guessed from prose, which is what stops a differently-spelled duplicate person from being minted.
- **Sensible due dates.** The model is given the email's own received date as "today" and resolves relative phrases ("next week", "ASAP", "before Friday's call", a meeting to prepare for) against it. With no timing signal at all, the task gets a due date 3 business days out — never a blank date, which used to read as immediately overdue.

Setup:

1. **DNS** — a dedicated receiving subdomain (`tasks.iseeit.ai`, kept separate from the apex so it never conflicts with normal company mail on that domain), with a single MX record whose value Resend generates per-domain. No SPF/DKIM/TXT needed for receive-only.
2. **Resend** — toggle "Receiving" on for the domain, then add a webhook endpoint (separate from the delivery-status one) at `<APP_URL>/api/webhooks/inbound-email`, subscribed to `email.received` only.
3. **Render** — set `RESEND_INBOUND_WEBHOOK_SECRET` to that webhook's signing secret. **Currently set directly in the Render dashboard, not in `render.yaml`** — a real gap: a fresh Blueprint deploy wouldn't recreate this env var, so the pipeline would silently stop signature-verifying (and thus stop working) until someone re-added it by hand. Worth folding into `render.yaml` as a `sync: false` entry.

The route (`app/api/webhooks/inbound-email/route.ts`) verifies the Svix signature, matches the sender against an active user (anyone else's forward is dropped and logged, never bounced), fetches the full body via Resend's Received Emails API, and is idempotent per email (`externalId` of `${emailId}:${index}` per task, enforced by a DB constraint) — a retried webhook delivery never re-runs (and re-bills) extraction.

## Sales AI sync

`/integrations` triggers a manual sync, and the `tasks-ai-sales-ai-sync` cron job (see above) runs it automatically. Action items from the Sales AI CRM are mapped to tasks (`app/lib/sales-ai-mapping.ts`), with the originating account and opportunity preserved on the task (`account_id`/`account_name`/`opportunity_id`/`opportunity_name`), and the contact registry (`contacts` table) kept in sync alongside it — the same table the email-to-task pipeline above also cross-checks names against. Every sync run is logged (`sales_ai_sync_runs`) and visible from `/integrations`, whether triggered manually or by the cron job.

## Task History and presence

Each task's detail drawer has a collapsible **Task History** section below Status Updates (collapsed by default; loads on first expand). It shows:
- Every edit as a readable auto-generated line ("Sarah changed due date from Aug 17 to Aug 24", "Sarah added Maya Chen as coworker"), computed by diffing the task before/after each save.
- **Last** viewed-by-person, not a full open log — one line per viewer, refreshing on each open. A full per-open log was considered and rejected: too noisy for a task someone checks repeatedly while working on it.
- When the task was created and by whom, where known — `created_by` is only populated for tasks created after this feature shipped; older/seeded tasks show no attribution.

## Invitation delivery status

Resend accepting an email for sending only means it was handed off — not that it reached an inbox. `app/api/webhooks/resend/route.ts` listens for Resend's async delivery events (Svix-signed, verified against `RESEND_WEBHOOK_SECRET`) and records the outcome for the most recent invitation email against that user: `delivered`, `bounced`, `complained`, or `delayed`, plus Resend's reason text where it provides one. Users & access shows this as a badge next to a pending invitation ("⚠ Bounced", "⚠ Marked as spam", "⏳ Delivery delayed", "✓ Delivered"), so "did they actually get it" no longer requires asking the recipient or digging through Resend's dashboard. Sending a fresh invite (including **Resend invitation**) clears the badge until the new send reports back.

Session `lastSeenAt` updates (throttled to once a minute per session), and "Last active" per person shows on the Users & access page, alongside an activity meter (active vs. passive actions, last 30 days and all-time).

## Inviting external people with their open tasks

Tasks name people by a plain string (`owner`/`collaborators`/`recipients`), not an account id, so a task can already reference someone — a customer, a vendor contact — who has never had a Task AI account. Two ways to invite them, both feeding the same invitation flow:

- **From a task**: an **✉ Invite {name}** chip appears next to Owner/Coworkers/Recipients for any name with no matching `users` row (`unregisteredNames` in `app/TaskApp.js`, driven by `registeredPeople` — every known name, pending or active — now returned by `GET /api/tasks`). It's a deep link to `/users?invite={name}`, not a separate dialog.
- **From the invite form**: typing a name shows a live "N open tasks reference this name" count (`GET /api/tasks/match-name`, debounced), so admins see up front that tasks will be bundled in.

Either way, the invited role defaults to **Collaborator with no project/meeting/topic scope** — relationship-based access only, so an external invitee sees exactly the tasks that name them and nothing else in the workspace. At send time, `POST /api/users` re-derives the matching tasks from the confirmed name (never trusting stale client data) and bakes up to 6 of them into `renderInvitationEmail`'s task-preview section — the same card styling as the daily digest — so the invitation leads with "here's what's waiting for you," not just a bare "join our team" pitch. Matching is scoped through `canSeeTask` against the *inviting admin's* own visibility, so an area admin can never surprise-reveal (or get a live count for) a task outside their own area. **Resend invitation** goes through this same path, so the task preview always reflects what's current at resend time, not what was true when the invite was first sent.

## Data hygiene

Every name a task ever used (via AI extraction or manual entry) gets remembered permanently in `dimension_values`, purely additive — nothing ever removed a stale or hallucinated one before. A Site Admin can open **Manage names** (bottom of Users & access, collapsed by default, also linked from the sidebar as **Data Hygiene**) and delete individual values via `DELETE /api/dimensions`. This only cleans the *suggestion* list: it doesn't touch any task that still has the value in its own owner/project/topic/meeting field, and if such a task is later saved again (even for an unrelated edit), the normal task-save path re-inserts the same value via its existing `onConflictDoNothing` upsert — so the response (and the toast) reports how many tasks still reference it, letting you know whether the cleanup actually stuck or whether those tasks need fixing too.

## Environment variables

See `.env.example` for local development and `render.yaml` for the current, authoritative production list. Production secrets belong only in Render. `SESSION_SECRET` is generated by Render. Rotate it deliberately: rotation invalidates existing signed session cookies.

## AI extraction

`app/lib/task-extraction.ts` holds the shared OpenAI Responses API call (strict JSON Schema output) that every AI-driven capture path — pasted meeting minutes, voice dictation, and forwarded email (`/api/extract` and `app/api/webhooks/inbound-email/route.ts`) — calls into. Its extraction contract explicitly handles fragments, prose, headings, tables, initials, missing metadata, incomplete notes, and irregular structure, and never invents a plausible-sounding generic task that wasn't actually said. The existing browser-side deterministic parser remains the availability fallback for pasted minutes when the API cannot extract.
