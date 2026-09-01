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
}, table => [index("tasks_owner_idx").on(table.owner), index("tasks_scope_idx").on(table.project, table.recurringMeeting, table.topic)]);
export const dimensionValues = pgTable("dimension_values", { id: serial("id").primaryKey(), type: text("type").notNull(), value: text("value").notNull() }, table => [uniqueIndex("dimension_values_type_value_unique").on(table.type, table.value)]);
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
