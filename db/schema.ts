import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("user_role", ["site_admin", "area_admin", "collaborator", "readonly"]);
export const userStatusEnum = pgEnum("user_status", ["pending", "active", "revoked"]);
export const companies = pgTable("companies", { id: serial("id").primaryKey(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() }, table => [uniqueIndex("companies_normalized_name_unique").on(table.normalizedName)]);
export const users = pgTable("users", {
  id: serial("id").primaryKey(), email: text("email").notNull(), name: text("name").notNull(), firstName: text("first_name"), lastName: text("last_name"), companyId: integer("company_id").references(() => companies.id),
  role: roleEnum("role").notNull(), status: userStatusEnum("status").notNull().default("pending"), emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }), phone: text("phone"), inviteChannel: text("invite_channel").notNull().default("email"),
  canInvite: boolean("can_invite").notNull().default(false), projects: jsonb("projects").$type<string[]>().notNull().default([]), meetings: jsonb("meetings").$type<string[]>().notNull().default([]), topics: jsonb("topics").$type<string[]>().notNull().default([]),
  inviteTokenHash: text("invite_token_hash"), invitedAt: timestamp("invited_at", { withTimezone: true }), inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }), acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  // Resend delivery tracking for the most recent invitation email: lastEmailId
  // correlates an inbound Resend webhook event back to this row; emailStatus
  // is null until Resend reports something noteworthy (delivered/bounced/
  // complained/delayed) — see app/api/webhooks/resend/route.ts. Reset to
  // null on every new send so a stale bounce doesn't outlive a successful resend.
  lastEmailId: text("last_email_id"), emailStatus: text("email_status"), emailStatusDetail: text("email_status_detail"), emailStatusAt: timestamp("email_status_at", { withTimezone: true }),
}, table => [uniqueIndex("users_email_unique").on(table.email)]);
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(), subject: text("subject").notNull(), description: text("description").notNull().default(""), owner: text("owner").notNull(), collaborators: jsonb("collaborators").$type<string[]>().notNull().default([]), recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  due: text("due").notNull(), source: text("source").notNull(), topic: text("topic").notNull(), project: text("project").notNull(), recurringMeeting: text("recurring_meeting").notNull(), status: text("status").notNull().default("Open"), created: text("created").notNull(), createdBy: text("created_by"), updates: jsonb("updates").$type<Array<{ text: string; at: string; by?: string }>>().notNull().default([]),
  // Set automatically by the PATCH handler whenever status transitions to
  // "Closed", cleared if it's reopened. Powers the "Recently closed" section
  // of the pending-tasks digest — only tasks closed after this shipped have
  // a real value here, older closures show no close date.
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // Provenance for a task that came from somewhere other than someone
  // directly typing it in — e.g. externalSource "sales-ai" / externalId the
  // Sales AI action_item_id, once that sync exists. Both null means "created
  // directly in Task AI" (manual entry, pasted minutes, dictation) — that's
  // the normal case and stays untouched. The partial unique index below
  // guarantees, at the database level, that the same external item can
  // never be imported twice, no matter how a future sync's own dedup logic
  // is written — a real constraint, not just an app-level check that a bug
  // could route around.
  externalSource: text("external_source"),
  externalId: text("external_id"),
  // The Sales AI company (account) and deal (opportunity) a task relates
  // to — distinct from Task AI's own `project`, which is an internal
  // workstream, not necessarily one customer. Both pairs follow the same
  // shape: a stable Sales AI id (survives a rename on their side) plus a
  // readable name cached at sync time, refreshed whenever a sync re-
  // resolves the id. opportunityId/opportunityName are frequently null —
  // not every action item ties to a specific deal — accountId/accountName
  // are expected on nearly all of them. All four null is the normal case
  // for anything not created via the Sales AI sync.
  accountId: text("account_id"),
  accountName: text("account_name"),
  opportunityId: text("opportunity_id"),
  opportunityName: text("opportunity_name"),
  // meeting_id only — no meetingName alongside it, unlike account/
  // opportunity, because there's currently no Sales AI endpoint that
  // resolves it to anything readable (confirmed live: no meetings entity,
  // no include/expand param changes the response — see conversation on
  // 2026-09-02). Stored anyway so nothing is lost: if a Meetings scope
  // ever gets added on Sales AI's side, every already-synced task can be
  // backfilled with a real name by re-resolving the ids already saved
  // here, rather than needing to re-pull and re-match everything from
  // scratch.
  meetingId: text("meeting_id"),
  // The actual spoken line a synced action item was generated from, and
  // who said it — Sales AI's own UI shows this behind a small click-to-
  // reveal icon rather than inline in the description, and the task
  // drawer does the same (see TaskApp.js). Kept as its own field instead
  // of folded into `description` specifically so the UI can render it
  // that way — concatenated text can't be un-concatenated later.
  citationUser: text("citation_user"),
  citationQuote: text("citation_quote"),
}, table => [
  index("tasks_owner_idx").on(table.owner),
  index("tasks_scope_idx").on(table.project, table.recurringMeeting, table.topic),
  uniqueIndex("tasks_external_unique").on(table.externalSource, table.externalId).where(sql`${table.externalSource} is not null and ${table.externalId} is not null`),
  index("tasks_account_idx").on(table.accountId),
]);
// One row per distinct pasted-minutes submission (keyed by a hash of the
// raw text, not the resulting tasks) — lets "Paste meeting minutes" warn
// before silently re-creating the same tasks from text that's already been
// pasted once. Deliberately not applied to dictation (app/dictate), which
// shares the same /api/extract endpoint: spoken text naturally varies
// run to run, so an exact-text duplicate there is far more likely to be a
// genuine repeat than an accidental one, and duplicate detection isn't
// worth the false-positive risk there. onConflictDoNothing on insert means
// only the *first* paste of a given text is recorded — a later, deliberate
// re-paste (force:true) doesn't overwrite "first pasted at" with itself.
export const pastedMinutes = pgTable("pasted_minutes", {
  contentHash: text("content_hash").primaryKey(),
  pastedBy: text("pasted_by"),
  taskCount: integer("task_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const dimensionValues = pgTable("dimension_values", { id: serial("id").primaryKey(), type: text("type").notNull(), value: text("value").notNull() }, table => [uniqueIndex("dimension_values_type_value_unique").on(table.type, table.value)]);
// A structured People registry, distinct from dimensionValues' plain
// (type,value) strings — those only ever carry a name, no email or
// external identity. One row per Sales AI contact encountered while
// syncing (an owner or recipient on some action item), so Task AI can
// eventually sync back to Sales AI by contact, not just by name-matching
// a free-text string. salesAiContactId is the match key for that — unique
// when set, so re-syncing the same contact updates this row rather than
// duplicating it. Independent of `users` (actual Task AI logins) and of
// task owner/collaborators/recipients (still plain name strings there,
// unchanged) — this is purely a reference table the sync keeps enriched.
export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  salesAiContactId: text("sales_ai_contact_id"),
  salesAiAccountId: text("sales_ai_account_id"),
  salesAiAccountName: text("sales_ai_account_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
// Plain (non-partial) unique index, not WHERE-filtered like the tasks one
// above — Postgres already lets any number of NULLs coexist under a
// regular unique constraint (NULL is never equal to NULL), so the WHERE
// clause bought nothing here and, worse, broke onConflictDoUpdate's
// target: a partial index can only satisfy ON CONFLICT if the conflict
// clause repeats its exact WHERE condition, which sales-ai-sync.ts's
// plain `target: contacts.salesAiContactId` doesn't — confirmed live via
// "no unique or exclusion constraint matching the ON CONFLICT
// specification" the first time this ran for real.
}, table => [uniqueIndex("contacts_sales_ai_contact_id_unique").on(table.salesAiContactId)]);
export const sessions = pgTable("sessions", { idHash: text("id_hash").primaryKey(), userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow() }, table => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)]);
export const loginTokens = pgTable("login_tokens", { tokenHash: text("token_hash").primaryKey(), userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() }, table => [index("login_tokens_user_idx").on(table.userId)]);
// Auto-generated, readable diff lines ("Sarah changed due date from ... to
// ..."), one row per changed field per save — not a generic JSON diff blob,
// so the Task History UI can render it directly.
export const taskActivity = pgTable("task_activity", {
  id: serial("id").primaryKey(), taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }), actorName: text("actor_name"), detail: text("detail").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("task_activity_task_idx").on(table.taskId)]);
// Last-viewed-per-person, not a full open-log — one row per (task, viewer)
// pair, upserted on each view. See memory/conversation: full logging was
// considered and explicitly rejected as too noisy for people who reopen a
// task repeatedly while working on it.
export const taskViews = pgTable("task_views", {
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }), actorName: text("actor_name").notNull(), viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("task_views_task_actor_unique").on(table.taskId, table.actorName)]);
// One row per registered WebAuthn credential (Face ID, Touch ID, Windows
// Hello, a hardware key) — a user can have several, one per device. counter
// is the authenticator's signature counter, used to detect a cloned
// credential (should only ever increase; a same-or-lower value on a login
// attempt means something's wrong). publicKey/credentialId are stored
// base64url-encoded, matching what @simplewebauthn hands back — no need to
// re-decode for verification, it takes the encoded form directly.
export const passkeys = pgTable("passkeys", {
  id: serial("id").primaryKey(), userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull(), publicKey: text("public_key").notNull(), counter: integer("counter").notNull().default(0),
  transports: jsonb("transports").$type<string[]>().notNull().default([]), deviceLabel: text("device_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, table => [uniqueIndex("passkeys_credential_id_unique").on(table.credentialId), index("passkeys_user_idx").on(table.userId)]);
