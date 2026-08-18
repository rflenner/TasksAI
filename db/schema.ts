import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }), subject: text("subject").notNull(), description: text("description").notNull().default(""), owner: text("owner").notNull(),
  collaborators: text("collaborators").notNull().default("[]"), recipients: text("recipients").notNull().default("[]"), due: text("due").notNull(), source: text("source").notNull(),
  topic: text("topic").notNull(), project: text("project").notNull(), recurringMeeting: text("recurring_meeting").notNull(), status: text("status").notNull().default("Open"),
  created: text("created").notNull(), updates: text("updates").notNull().default("[]"),
});
export const dimensionValues = sqliteTable("dimension_values", {
  id: integer("id").primaryKey({ autoIncrement: true }), type: text("type").notNull(), value: text("value").notNull(),
}, table => ({ typeValueUnique: uniqueIndex("dimension_values_type_value_unique").on(table.type, table.value) }));
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), createdAt: text("created_at").notNull(),
}, table => ({ normalizedNameUnique: uniqueIndex("companies_normalized_name_unique").on(table.normalizedName) }));
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }), email: text("email").notNull(), name: text("name").notNull(), role: text("role").notNull(), status: text("status").notNull().default("pending"),
  firstName: text("first_name"), lastName: text("last_name"), companyId: integer("company_id").references(() => companies.id), emailVerifiedAt: text("email_verified_at"), phone: text("phone"), inviteChannel: text("invite_channel").notNull().default("email"),
  canInvite: integer("can_invite", { mode: "boolean" }).notNull().default(false), projects: text("projects").notNull().default("[]"), meetings: text("meetings").notNull().default("[]"), topics: text("topics").notNull().default("[]"), inviteTokenHash: text("invite_token_hash"), invitedAt: text("invited_at"), inviteExpiresAt: text("invite_expires_at"), acceptedAt: text("accepted_at"),
}, table => ({ emailUnique: uniqueIndex("users_email_unique").on(table.email) }));
