import { and, eq, like } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dimensionValues, tasks, users } from "../../../../db/schema";
import { bareEmail, stripHtml } from "../../../lib/inbound-email";
import { canCreateTask, type Actor } from "../../../lib/permissions";
import { resolveTaskNames } from "../../../lib/name-resolution";
import { isFreshTimestamp, verifyResendSignature } from "../../../lib/resend-webhook";
import { callTaskExtractionAI } from "../../../lib/task-extraction";

type DimensionType = "project" | "meeting" | "topic" | "person";
type InboundEvent = { type?: string; data?: { email_id?: string; from?: string; subject?: string } };

// Forwarding an email to tasks@tasks.iseeit.ai (or any address at the
// receiving subdomain — see the DNS setup) creates tasks the same way
// pasting meeting minutes does: this just gets the text in front of the
// same extraction the rest of the app already uses (app/lib/task-
// extraction.ts), then inserts directly rather than going through
// POST /api/tasks, since there's no browser session here to satisfy that
// route's requireSameOrigin/currentActor gates — Svix signature
// verification is this route's equivalent of "is this really Resend."
export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) { console.error("RESEND_INBOUND_WEBHOOK_SECRET is not configured; ignoring inbound webhook"); return Response.json({ ok: true }); }
  const id = request.headers.get("svix-id"), timestamp = request.headers.get("svix-timestamp"), signature = request.headers.get("svix-signature");
  const body = await request.text();
  if (!id || !timestamp || !signature || !isFreshTimestamp(timestamp) || !verifyResendSignature({ secret, id, timestamp, body, signatureHeader: signature })) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let event: InboundEvent;
  try { event = JSON.parse(body) as InboundEvent; } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  if (event.type !== "email.received") return Response.json({ ok: true });
  const emailId = event.data?.email_id, fromHeader = event.data?.from;
  if (!emailId || !fromHeader) return Response.json({ ok: true });

  // Idempotency: every task minted from this email carries an externalId
  // of `${emailId}:${index}` (tasks_external_unique in db/schema.ts
  // enforces this at the DB level too) — if any already exist, Resend is
  // retrying a delivery we already handled, so skip straight to done
  // rather than re-running (and re-billing) the AI extraction.
  const already = await getDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.externalSource, "email"), like(tasks.externalId, `${emailId}:%`))).limit(1);
  if (already.length) return Response.json({ ok: true });

  // Only a registered, active user's own forward can create a task — an
  // email from an address nobody's account owns is silently dropped
  // (logged, not bounced) rather than minting a task with a made-up
  // owner, the inbound equivalent of never letting an unauthenticated
  // request write to /api/tasks.
  const senderEmail = bareEmail(fromHeader);
  const [row] = await getDb().select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status, canInvite: users.canInvite, projects: users.projects, meetings: users.meetings, topics: users.topics }).from(users).where(and(eq(users.email, senderEmail), eq(users.status, "active"))).limit(1);
  if (!row) { console.warn(`Inbound email from unregistered address ${senderEmail} (email ${emailId}) — no task created`); return Response.json({ ok: true }); }
  const actor: Actor = row;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.error("RESEND_API_KEY is not configured; cannot fetch inbound email content"); return Response.json({ ok: true }); }
  const emailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!emailRes.ok) { console.error(`Could not fetch inbound email ${emailId} from Resend: ${emailRes.status}`); return new Response(null, { status: 502 }); } // 502, not 200 — worth a webhook retry, this is Resend's own API being unreachable, not a content problem
  const email = await emailRes.json() as { text?: string; html?: string; subject?: string };
  const bodyText = email.text?.trim() || (email.html ? stripHtml(email.html) : "");
  if (!bodyText) { console.warn(`Inbound email ${emailId} has no readable body — no task created`); return Response.json({ ok: true }); }
  const subject = email.subject || event.data?.subject || "";
  const combined = subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText;

  const extraction = await callTaskExtractionAI(combined);
  if (!extraction.ok) {
    // ai_unavailable (OPENAI_API_KEY unset) won't fix itself on a retry;
    // ai_failed (a transient OpenAI error) might, so give Resend's own
    // webhook retry a real non-2xx to act on in that case only.
    if (extraction.code === "ai_unavailable") { console.error(extraction.error); return Response.json({ ok: true }); }
    console.error(`Inbound email ${emailId} extraction failed: ${extraction.error}`);
    return new Response(null, { status: 502 });
  }
  if (!extraction.tasks.length) return Response.json({ ok: true });

  const registeredNames = (await getDb().select({ name: users.name }).from(users)).map(r => r.name);
  const now = new Date().toISOString();
  let createdCount = 0;
  for (const [index, raw] of extraction.tasks.entries()) {
    // Unlike a pasted-minutes record (written about several people, by
    // someone who may not be any of them), a forwarded email with no
    // owner named at all defaults to whoever forwarded it — same
    // reasoning as dictation's "no owner said" fallback in
    // app/api/extract/route.ts.
    const resolved = resolveTaskNames(raw, registeredNames, actor.name);
    const task = {
      subject: (resolved.subject || "").slice(0, 140) || "Forwarded email", description: resolved.description || "",
      owner: resolved.owner || actor.name, collaborators: resolved.collaborators || [], recipients: resolved.recipients || [],
      due: resolved.due || "", source: "Forwarded email", topic: resolved.topic || "", project: resolved.project || "", recurringMeeting: resolved.recurringMeeting || "",
      status: "Open", priority: "Low", created: now, createdBy: actor.name, updates: [] as Array<{ text: string; at: string; by?: string }>,
      externalSource: "email", externalId: `${emailId}:${index}`,
    };
    // Same scope enforcement POST /api/tasks applies to a signed-in
    // actor — an area-admin's or scoped collaborator's forward can't
    // mint a task outside what they could create through the UI either.
    if (!canCreateTask(task, actor)) { console.warn(`${senderEmail} cannot create a task in scope ${task.project}/${task.topic}/${task.recurringMeeting} (email ${emailId}) — skipped`); continue; }
    let inserted;
    try { [inserted] = await getDb().insert(tasks).values(task).returning(); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") continue; // already imported — concurrent retry
      throw error;
    }
    createdCount++;
    const entries: Array<[DimensionType, string]> = [["project", inserted.project], ["meeting", inserted.recurringMeeting], ["topic", inserted.topic], ["person", inserted.owner], ...inserted.collaborators.map((x): [DimensionType, string] => ["person", x]), ...inserted.recipients.map((x): [DimensionType, string] => ["person", x])];
    for (const [type, value] of entries) if (value) await getDb().insert(dimensionValues).values({ type, value }).onConflictDoNothing();
  }
  console.log(`Inbound email ${emailId} from ${senderEmail}: created ${createdCount} task(s)`);
  return Response.json({ ok: true, created: createdCount });
}
