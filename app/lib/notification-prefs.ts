// Per-user notification preferences — third of the three Slack pieces
// agreed 2026-09-11 (after the real-time DM and the digest-to-Slack
// crons): lets someone choose, per notification, which channel(s) it
// goes to, rather than everyone getting everything on both channels
// unconditionally, which is what shipped first. Pure and DB-free, same
// split as app/lib/voice-query.ts and app/lib/task-flags.ts.
import type { DigestChannel, NotificationPrefs } from "../../db/schema";

export type { DigestChannel, NotificationPrefs };

// Matches the behavior that existed before this feature — both channels,
// always on — so shipping this changes nothing for anyone until they
// actually open Account settings and change something. Kept in sync
// with the column default in db/schema.ts (a fresh row gets that one;
// this one is for a row read before the migration ran, or a stored
// value missing a field added later — see resolvePrefs below).
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newAssignment: "both", overdue: "both", weeklyDigest: "both", statusUpdateSlack: true,
};

export function wantsEmail(channel: DigestChannel): boolean {
  return channel === "email" || channel === "both";
}

export function wantsSlack(channel: DigestChannel): boolean {
  return channel === "slack" || channel === "both";
}

// A stored prefs value may predate a field added later, or in principle
// be malformed — always merge over the defaults rather than trusting
// the stored shape completely.
export function resolvePrefs(stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(stored || {}) };
}

export const DIGEST_CHANNELS: DigestChannel[] = ["email", "slack", "both", "off"];
