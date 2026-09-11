// The settings surface for the third Slack notification piece (see
// app/lib/notification-prefs.ts) — lets the signed-in user read and
// change their own newAssignment/overdue/weeklyDigest/statusUpdateSlack
// choices. Always scoped to the caller's own row (actor.id) — there's no
// "set someone else's notification preferences" case, unlike most of
// this app's other admin-facing settings.
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { type NotificationPrefs, users } from "../../../../db/schema";
import { DIGEST_CHANNELS, resolvePrefs } from "../../../lib/notification-prefs";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

export async function GET() {
  const actor = await currentActor();
  if (!actor?.id) return Response.json({ error: "Sign in required" }, { status: 401 });
  const [row] = await getDb().select({ notificationPrefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.id)).limit(1);
  return Response.json({ prefs: resolvePrefs(row?.notificationPrefs) });
}

const CHANNEL_KEYS = ["newAssignment", "overdue", "weeklyDigest"] as const;

export async function PATCH(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor?.id) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Partial<NotificationPrefs>;

  const patch: Partial<NotificationPrefs> = {};
  for (const key of CHANNEL_KEYS) {
    const value = body[key];
    if (value === undefined) continue;
    if (!(DIGEST_CHANNELS as string[]).includes(value)) return Response.json({ error: `Invalid value for ${key}` }, { status: 400 });
    patch[key] = value;
  }
  if (body.statusUpdateSlack !== undefined) patch.statusUpdateSlack = Boolean(body.statusUpdateSlack);

  const [row] = await getDb().select({ notificationPrefs: users.notificationPrefs }).from(users).where(eq(users.id, actor.id)).limit(1);
  const next: NotificationPrefs = { ...resolvePrefs(row?.notificationPrefs), ...patch };
  await getDb().update(users).set({ notificationPrefs: next }).where(eq(users.id, actor.id));
  return Response.json({ prefs: next });
}
