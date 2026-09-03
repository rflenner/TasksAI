import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../../db";
import { contacts, dimensionValues, tasks, users } from "../../../../db/schema";
import { collapseToSingleTask, detectsMultiTaskTrigger } from "../../../lib/dictate-intent";
import { addBusinessDays, bareEmail, extractEmailNameHints, resolveViaEmailHint, stripHtml } from "../../../lib/inbound-email";
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
  const email = await emailRes.json() as { text?: string; html?: string; subject?: string; created_at?: string };
  const bodyText = email.text?.trim() || (email.html ? stripHtml(email.html) : "");
  if (!bodyText) { console.warn(`Inbound email ${emailId} has no readable body — no task created`); return Response.json({ ok: true }); }
  const subject = email.subject || event.data?.subject || "";
  const combined = subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText;

  // The email's own received date — used both as "today" for the model
  // to resolve relative phrases against ("next week", "ASAP", "before
  // Friday's call") and as the anchor for the no-due-date fallback below.
  // Not the forward's original send date (which can be old, stale
  // context) — this is when the task is actually being created.
  const referenceDate = (email.created_at || new Date().toISOString()).slice(0, 10);
  const referenceWeekday = new Date(`${referenceDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  // Default to one task per email, same reasoning as dictation's default
  // in app/api/extract/route.ts: an email listing several sub-points or
  // sections isn't automatically several separate asks, and splitting
  // them uninvited was confirmed live as unwanted behavior. Only split
  // when the email explicitly signals it wants several ("create
  // multiple tasks", "second task", etc.) — same trigger phrases and
  // deterministic collapse-backstop dictation already uses, since the
  // "don't split without being told to" rule is identical either way.
  //
  // Also resolves relative due dates: the model has no other way to
  // know what day it is, so it's given the email's own received date as
  // "today" and told to convert phrases like "ASAP" or "next week" into
  // an absolute date against that reference — matching what a person
  // reading the email at the time would infer. When the email genuinely
  // gives no timing signal at all, due comes back null and gets a
  // deterministic 3-business-day-out default below, rather than an
  // empty due date that used to read as immediately overdue.
  const extraInstruction = `
This is a forwarded or received email, not a structured meeting-notes document. By default, extract exactly ONE task covering everything in the email, even if it lists several sub-points, bullets, or sections — combine those into one description rather than one task each. Only extract more than one task if the email explicitly asks for several separate ones, using a clear phrase like "create multiple tasks", "next task", "second task", "another task", or similar — and even then, split only at the boundaries the email actually marked.
Today's date, for resolving any relative time expression in this email, is ${referenceDate} (a ${referenceWeekday}). Convert every such expression to an absolute YYYY-MM-DD due date using this reference point: "next week" means the Monday of the following calendar week, "ASAP" or "as soon as possible" means the next business day, "tomorrow"/"Friday"/etc. mean that literal calendar day relative to today, and a specific meeting or event the task must be ready for means that event's own date, not today's. If the email genuinely gives no timing signal of any kind, leave due null.`;
  const extraction = await callTaskExtractionAI(combined, { extraInstruction });
  if (!extraction.ok) {
    // ai_unavailable (OPENAI_API_KEY unset) won't fix itself on a retry;
    // ai_failed (a transient OpenAI error) might, so give Resend's own
    // webhook retry a real non-2xx to act on in that case only.
    if (extraction.code === "ai_unavailable") { console.error(extraction.error); return Response.json({ ok: true }); }
    console.error(`Inbound email ${emailId} extraction failed: ${extraction.error}`);
    return new Response(null, { status: 502 });
  }
  if (!extraction.tasks.length) return Response.json({ ok: true });
  // Backstop for singleTaskRule above: the model doesn't always follow
  // instructions perfectly, so an untriggered email that still comes
  // back as several tasks gets folded into one here, deterministically.
  const extractedTasks = extraction.tasks.length > 1 && !detectsMultiTaskTrigger(combined) ? [collapseToSingleTask(extraction.tasks)] : extraction.tasks;

  // Cross-checked against every registered user *and* every known Sales
  // AI contact — a name mentioned in a forwarded email is just as likely
  // to be an existing contact as a Task AI user, and matching either
  // avoids minting a stray near-duplicate person.
  const registeredNames = [...new Set([
    ...(await getDb().select({ name: users.name }).from(users)).map(r => r.name),
    ...(await getDb().select({ name: contacts.name }).from(contacts)).map(r => r.name),
  ])];
  // Header-name -> canonical name, built from every "Name <email>" pair
  // found anywhere in the email text (typically the quoted From/To/Cc
  // lines a forward carries) cross-checked by address against users and
  // contacts — the fix for the Xenofon Kanarios case: the AI's own
  // spelling of a name never has to be trusted when the email itself
  // states the address under a slightly different spelling.
  const nameHints = extractEmailNameHints(combined);
  const hintEmails = [...new Set(nameHints.values())];
  const emailToCanonical = new Map<string, string>();
  if (hintEmails.length) {
    for (const row of await getDb().select({ email: contacts.email, name: contacts.name }).from(contacts).where(inArray(contacts.email, hintEmails))) {
      if (row.email) emailToCanonical.set(row.email.toLowerCase(), row.name);
    }
    // Users take priority over contacts when an address matches both —
    // a real Task AI account is the more authoritative identity.
    for (const row of await getDb().select({ email: users.email, name: users.name }).from(users).where(inArray(users.email, hintEmails))) {
      emailToCanonical.set(row.email.toLowerCase(), row.name);
    }
  }
  const nameToCanonical = new Map<string, string>();
  for (const [headerName, email] of nameHints) {
    const canonical = emailToCanonical.get(email);
    if (canonical) nameToCanonical.set(headerName, canonical);
  }

  const now = new Date().toISOString();
  let createdCount = 0;
  for (const [index, raw] of extractedTasks.entries()) {
    // Email-address cross-check runs first (most reliable — an actual
    // address beats a spelled name), then the existing registered-name
    // fuzzy match as a fallback for anyone not named with an address in
    // the text at all.
    const hinted = {
      ...raw,
      owner: raw.owner ? resolveViaEmailHint(raw.owner, nameToCanonical) ?? raw.owner : raw.owner,
      collaborators: (raw.collaborators || []).map(name => resolveViaEmailHint(name, nameToCanonical) ?? name),
      recipients: (raw.recipients || []).map(name => resolveViaEmailHint(name, nameToCanonical) ?? name),
    };
    // Unlike a pasted-minutes record (written about several people, by
    // someone who may not be any of them), a forwarded email with no
    // owner named at all defaults to whoever forwarded it — same
    // reasoning as dictation's "no owner said" fallback in
    // app/api/extract/route.ts.
    const resolved = resolveTaskNames(hinted, registeredNames, actor.name);
    // A due date the model didn't actually resolve to a real calendar
    // date (null, or anything not matching YYYY-MM-DD) falls back to 3
    // business days after the email arrived — never an empty string,
    // which used to sort as "overdue" the instant the task was created.
    const due = resolved.due && /^\d{4}-\d{2}-\d{2}$/.test(resolved.due) ? resolved.due : addBusinessDays(referenceDate, 3);
    const task = {
      subject: (resolved.subject || "").slice(0, 140) || "Forwarded email", description: resolved.description || "",
      owner: resolved.owner || actor.name, collaborators: resolved.collaborators || [], recipients: resolved.recipients || [],
      due, source: "Forwarded email", topic: resolved.topic || "", project: resolved.project || "", recurringMeeting: resolved.recurringMeeting || "",
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
