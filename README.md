# Task AI

Task AI turns meeting minutes into accountable action items while enforcing role-, relationship-, and work-area access. This version runs on standard Next.js/Node.js with PostgreSQL and is configured for Render.

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
```

## Authentication and access

- Invitations contain random single-use tokens; only SHA-256 hashes are stored.
- Accepting an unexpired invitation verifies the invited email address and requires first name, last name, and company.
- Returning users get an email with a one-click sign-in link, plus the same 8-character one-time code (32-character alphabet, ambiguous characters excluded) as a fallback for signing in on a different device. Both expire in 15 minutes and are single-use. The link points at `/login/confirm` — a normal page, not an API route — and only calls `/api/auth/verify` when the person explicitly clicks "Sign in to Task AI" there. That's deliberate: an API route that auto-verifies and redirects on a bare GET is what triggered Chrome's phishing heuristic on this domain previously, and is also the shape that gets silently "clicked" (and the one-time code burned) by email link-scanners like Outlook Safe Links before the recipient ever opens the message.
- Browser sessions use a random opaque identifier signed with HMAC-SHA256. Only its hash is stored in PostgreSQL; the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Mutating APIs reject cross-origin requests.
- All API authorization is derived from the active session and database role. Client-provided email headers and unsigned identity cookies are ignored.

## Deploy to Render

1. In Render, choose **New → Blueprint** and connect this repository. Render reads `render.yaml` and creates the web service and PostgreSQL database.
2. Enter `OPENAI_API_KEY`, `RESEND_API_KEY`, and `SITE_ADMIN_COMPANY` in the Render dashboard. They are marked `sync: false` and are never stored in Git.
3. Keep `TASK_AI_FROM_EMAIL` as `Task AI <notifications@tasks.flenner.at>`. The `tasks.flenner.at` domain must remain verified in Resend for *sending* — that's independent of what `APP_URL` points to (see below), so this stays put even while the custom domain itself isn't in use for links.
4. On the first deployment only, change `BOOTSTRAP_SITE_ADMIN` to `true` and deploy. Startup applies migrations and idempotently creates `Rizan Flenner <rizan@flenner.at>` as Site Admin.
5. Immediately set `BOOTSTRAP_SITE_ADMIN` back to `false` and redeploy. The existing admin remains intact.
6. `APP_URL` (web service and cron job both) controls the origin used for every link inside outgoing emails — invitations, sign-in links, "Open Task AI" buttons — via `appLinkOrigin`/`appLinkUrl` in `app/lib/request.ts`. It currently points at the Render URL, `https://tasks-ai.onrender.com`, not the custom domain: `tasks.flenner.at`'s DNS is blocked by an MX record on the same `tasks` host (needed for inbound mail on a different app) that conflicts with the CNAME the site needs — a name can't have both. Move `APP_URL` back to `https://tasks.flenner.at` once that's resolved, e.g. by moving the app to its own subdomain instead of the bare `tasks` host.
7. Verify `/api/health`, request a sign-in code for the Site Admin, and send a test invitation.
8. The Blueprint also creates a **Cron Job** (`tasks-ai-daily-reminders`) running `scripts/send-reminders.ts` once a day. It needs `RESEND_API_KEY` entered in its own Environment tab too — cron jobs don't share env vars with the web service, even in the same Blueprint.
9. In the Resend dashboard, add a **Webhook** pointed at `<your APP_URL>/api/webhooks/resend` — currently `https://tasks-ai.onrender.com/api/webhooks/resend` — subscribed to `email.delivered`, `email.bounced`, `email.complained`, and `email.delivery_delayed`. Copy its signing secret into `RESEND_WEBHOOK_SECRET` on the web service (`sync: false`, web service only — the cron job doesn't send invitations so it doesn't need this one). Without it the webhook endpoint just logs and no-ops; invitations still send, but bounce/complaint status won't show up in Users & access. **If `APP_URL` changes, update this webhook URL in Resend's dashboard to match** — it isn't automatic.

Database initialization runs before every `next start`; applied migration filenames are recorded in `app_migrations`, so startup is safe and idempotent. A migration failure stops the service instead of starting against an unknown schema.

## Daily reminders

A Render Cron Job (`tasks-ai-daily-reminders` in `render.yaml`) runs `scripts/send-reminders.ts` every morning. For each active user it computes their **personal** task digest (`personalTaskDigest`, same rule for every role including admins) and emails it via `renderPendingTasksEmail`, split into three sections:
- **My tasks** — open tasks where they're the owner or a coworker, i.e. work that's theirs to do.
- **Delegated tasks** — open tasks where they're a recipient only (not also owner/coworker) — work they asked someone else to do and are tracking, not doing themselves.
- **Recently closed** — tasks of theirs (any role) closed in the last 24 hours, so a close doesn't just vanish silently. `closedAt` is set automatically by the tasks API on the Open/In progress → Closed transition and cleared on reopen; tasks closed before this shipped have no `closedAt` and never appear here.

My tasks and delegated tasks are filtered to items due this week or earlier (never a future week); recently closed isn't due-filtered, it's driven by `closedAt` instead. A user is skipped entirely only if both open buckets are empty *and* nothing of theirs closed recently — there's no daily noise for someone with nothing to report either way.

The schedule (`0 5 * * *`, i.e. 05:00 UTC) targets 07:00 in Europe/Vienna during CEST (summer). Render cron schedules are fixed UTC and don't shift for daylight saving, so once CET (winter, UTC+1) resumes this drifts to firing at 06:00 local. Adjust the hour by hand around the DST changeovers, or accept the hour of drift twice a year.

Run it manually with `pnpm reminders` (needs `DATABASE_URL`, `APP_URL`, and optionally `RESEND_API_KEY` set — without a Resend key it logs what would have sent instead of erroring).

## Task History and presence

Each task's detail drawer has a collapsible **Task History** section below Status Updates (collapsed by default; loads on first expand). It shows:
- Every edit as a readable auto-generated line ("Sarah changed due date from Aug 17 to Aug 24", "Sarah added Maya Chen as coworker"), computed by diffing the task before/after each save.
- **Last** viewed-by-person, not a full open log — one line per viewer, refreshing on each open. A full per-open log was considered and rejected: too noisy for a task someone checks repeatedly while working on it.
- When the task was created and by whom, where known — `created_by` is only populated for tasks created after this feature shipped; older/seeded tasks show no attribution.

## Invitation delivery status

Resend accepting an email for sending only means it was handed off — not that it reached an inbox. `app/api/webhooks/resend/route.ts` listens for Resend's async delivery events (Svix-signed, verified against `RESEND_WEBHOOK_SECRET`) and records the outcome for the most recent invitation email against that user: `delivered`, `bounced`, `complained`, or `delayed`, plus Resend's reason text where it provides one. Users & access shows this as a badge next to a pending invitation ("⚠ Bounced", "⚠ Marked as spam", "⏳ Delivery delayed", "✓ Delivered"), so "did they actually get it" no longer requires asking the recipient or digging through Resend's dashboard. Sending a fresh invite (including **Resend invitation**) clears the badge until the new send reports back.

Session `lastSeenAt` now actually updates (throttled to once a minute per session) — it existed in the schema before but nothing refreshed it. "Last active" per person shows on the Users & access page.

## Environment variables

See `.env.example`. Production secrets belong only in Render. `SESSION_SECRET` is generated by Render. Rotate it deliberately: rotation invalidates existing signed session cookies.

## AI extraction

The `/api/extract` route uses the OpenAI Responses API with strict JSON Schema output. Its extraction contract explicitly handles fragments, prose, headings, tables, initials, missing metadata, incomplete notes, and irregular structure. The existing browser-side deterministic parser remains the availability fallback when the API cannot extract.
