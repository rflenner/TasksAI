import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { renderAppUrlChangedEmail, sendWithResend } from "../../../lib/email";
import { appLinkOrigin, requireSameOrigin } from "../../../lib/request";
import { sha256 } from "../../../lib/security";
import { currentActor } from "../../../lib/session";

// Broadcasts "the app's web address changed" to every active user. The
// idempotency key is tied to the current appUrl (not just user+day), so
// clicking the button twice in a row for the same URL is a harmless no-op
// via Resend's idempotency window, but a genuinely new URL later (e.g.
// moving onto a custom domain) naturally sends a fresh notice.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (actor?.role !== "site_admin") return Response.json({ error: "Site Admin access required" }, { status: 403 });
  const appUrl = appLinkOrigin(request);
  const urlTag = sha256(appUrl).slice(0, 16);
  const active = await getDb().select().from(users).where(eq(users.status, "active"));
  let sent = 0, skipped = 0, failed = 0;
  for (const user of active) {
    try {
      const message = renderAppUrlChangedEmail({ name: user.name, appUrl });
      const delivery = await sendWithResend({ ...message, to: user.email, idempotencyKey: `app-url-notice-${user.id}-${urlTag}` });
      if (delivery.sent) sent++; else skipped++;
    } catch (error) {
      failed++;
      console.error(`App-URL-change notice failed for user ${user.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return Response.json({ appUrl, total: active.length, sent, skipped, failed });
}
