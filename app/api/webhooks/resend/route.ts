import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { isFreshTimestamp, verifyResendSignature } from "../../../lib/resend-webhook";

// Resend only tells us an email was *accepted*; whether it actually reached
// an inbox arrives later as one of these async events. We only care about
// the ones that mean "the admin should know this invite didn't land" (plus
// delivered, as a positive confirmation) — opens/clicks are ignored.
const STATUS_BY_EVENT: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
};

type ResendEvent = { type?: string; data?: { email_id?: string; bounce?: { message?: string; type?: string }; complaint?: { type?: string } } };

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) { console.error("RESEND_WEBHOOK_SECRET is not configured; ignoring inbound webhook"); return Response.json({ ok: true }); }
  const id = request.headers.get("svix-id"), timestamp = request.headers.get("svix-timestamp"), signature = request.headers.get("svix-signature");
  const body = await request.text();
  if (!id || !timestamp || !signature || !isFreshTimestamp(timestamp) || !verifyResendSignature({ secret, id, timestamp, body, signatureHeader: signature })) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let event: ResendEvent;
  try { event = JSON.parse(body) as ResendEvent; } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const emailId = event.data?.email_id;
  const status = event.type ? STATUS_BY_EVENT[event.type] : undefined;
  if (!emailId || !status) return Response.json({ ok: true });
  const detail = event.data?.bounce?.message || event.data?.bounce?.type || event.data?.complaint?.type || null;
  await getDb().update(users).set({ emailStatus: status, emailStatusDetail: detail, emailStatusAt: new Date() }).where(eq(users.lastEmailId, emailId));
  return Response.json({ ok: true });
}
