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
- Returning users request an 8-character one-time code (32-character alphabet, ambiguous characters excluded), sent by email and typed back into the sign-in form. It expires in 15 minutes and is single-use. Unlike a clickable magic link, this never puts a token in a URL — email scanners/prefetchers can't burn it, and it doesn't trigger Chrome's phishing heuristics the way a bare `?token=...` auto-redirect endpoint does.
- Browser sessions use a random opaque identifier signed with HMAC-SHA256. Only its hash is stored in PostgreSQL; the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Mutating APIs reject cross-origin requests.
- All API authorization is derived from the active session and database role. Client-provided email headers and unsigned identity cookies are ignored.

## Deploy to Render

1. In Render, choose **New → Blueprint** and connect this repository. Render reads `render.yaml` and creates the web service and PostgreSQL database.
2. Enter `OPENAI_API_KEY`, `RESEND_API_KEY`, and `SITE_ADMIN_COMPANY` in the Render dashboard. They are marked `sync: false` and are never stored in Git.
3. Keep `TASK_AI_FROM_EMAIL` as `Task AI <notifications@tasks.flenner.at>`. The `tasks.flenner.at` domain must remain verified in Resend.
4. On the first deployment only, change `BOOTSTRAP_SITE_ADMIN` to `true` and deploy. Startup applies migrations and idempotently creates `Rizan Flenner <rizan@flenner.at>` as Site Admin.
5. Immediately set `BOOTSTRAP_SITE_ADMIN` back to `false` and redeploy. The existing admin remains intact.
6. Add the Render service’s public URL as the custom domain/origin and configure DNS for `tasks.flenner.at` as directed by Render.
7. Verify `/api/health`, request a sign-in code for the Site Admin, and send a test invitation.
8. The Blueprint also creates a **Cron Job** (`tasks-ai-daily-reminders`) running `scripts/send-reminders.ts` once a day. It needs `RESEND_API_KEY` entered in its own Environment tab too — cron jobs don't share env vars with the web service, even in the same Blueprint.

Database initialization runs before every `next start`; applied migration filenames are recorded in `app_migrations`, so startup is safe and idempotent. A migration failure stops the service instead of starting against an unknown schema.

## Daily reminders

A Render Cron Job (`tasks-ai-daily-reminders` in `render.yaml`) runs `scripts/send-reminders.ts` every morning. For each active user it computes their **personal** open tasks — where they're the owner, a coworker, or a recipient, same rule for every role including admins — filters to items due this week or earlier (never a future week), and emails them via `renderPendingTasksEmail` if there's at least one. Users with nothing due get nothing sent; there's no daily noise for an empty inbox.

The schedule (`0 5 * * *`, i.e. 05:00 UTC) targets 07:00 in Europe/Vienna during CEST (summer). Render cron schedules are fixed UTC and don't shift for daylight saving, so once CET (winter, UTC+1) resumes this drifts to firing at 06:00 local. Adjust the hour by hand around the DST changeovers, or accept the hour of drift twice a year.

Run it manually with `pnpm reminders` (needs `DATABASE_URL`, `APP_URL`, and optionally `RESEND_API_KEY` set — without a Resend key it logs what would have sent instead of erroring).

## Task History and presence

Each task's detail drawer has a collapsible **Task History** section below Status Updates (collapsed by default; loads on first expand). It shows:
- Every edit as a readable auto-generated line ("Sarah changed due date from Aug 17 to Aug 24", "Sarah added Maya Chen as coworker"), computed by diffing the task before/after each save.
- **Last** viewed-by-person, not a full open log — one line per viewer, refreshing on each open. A full per-open log was considered and rejected: too noisy for a task someone checks repeatedly while working on it.
- When the task was created and by whom, where known — `created_by` is only populated for tasks created after this feature shipped; older/seeded tasks show no attribution.

Session `lastSeenAt` now actually updates (throttled to once a minute per session) — it existed in the schema before but nothing refreshed it. "Last active" per person shows on the Users & access page.

## Environment variables

See `.env.example`. Production secrets belong only in Render. `SESSION_SECRET` is generated by Render. Rotate it deliberately: rotation invalidates existing signed session cookies.

## AI extraction

The `/api/extract` route uses the OpenAI Responses API with strict JSON Schema output. Its extraction contract explicitly handles fragments, prose, headings, tables, initials, missing metadata, incomplete notes, and irregular structure. The existing browser-side deterministic parser remains the availability fallback when the API cannot extract.
