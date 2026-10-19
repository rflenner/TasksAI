import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { closePlanDocuments } from "../../../../../../db/schema";
import { MAX_NOTE_LENGTH, MAX_NOTE_RECIPIENTS, noteCandidates, sendTaskNotes, type NoteChannel } from "../../../../../lib/close-plan-manual-notify";
import { appBase } from "../../../../../lib/close-plan-invitations";
import { canAccessPlan } from "../../../../../lib/close-plan-store";
import { requireSameOrigin } from "../../../../../lib/request";
import { currentActor } from "../../../../../lib/session";
import { lookupSlackUserByEmail } from "../../../../../lib/slack";

export const dynamic = "force-dynamic";

// The bell on a Close Plan task (the same flow as Task AI's bell). GET: who is on the task and how they can be reached. POST: send the
// note to the people picked, by one channel. iSEEit people on the plan only (customers use their personal link).
async function load(id: string) {
  const actor = await currentActor();
  if (!actor) return { error: Response.json({ error: "Sign in required" }, { status: 401 }) };
  const [row] = await getDb().select().from(closePlanDocuments).where(eq(closePlanDocuments.id, id)).limit(1);
  if (!row || row.deletedAt || !canAccessPlan(actor, row)) return { error: Response.json({ error: "Plan not found" }, { status: 404 }) };
  return { actor, row };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await load(id); if (g.error) return g.error;
  const taskId = new URL(request.url).searchParams.get("taskId") || "";
  const token = process.env.SLACK_BOT_TOKEN;
  const people = await noteCandidates(g.row!.data as Record<string, unknown>, taskId, async email => Boolean(token && await lookupSlackUserByEmail(token, email)));
  return Response.json({ people, slackConfigured: Boolean(token) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const { id } = await params;
  const g = await load(id); if (g.error) return g.error;
  const body = await request.json().catch(() => ({})) as { taskId?: string; personIds?: string[]; channel?: NoteChannel; message?: string };
  const message = String(body.message || "").trim().slice(0, MAX_NOTE_LENGTH);
  const personIds = [...new Set((Array.isArray(body.personIds) ? body.personIds : []).filter(x => typeof x === "string"))].slice(0, MAX_NOTE_RECIPIENTS);
  if (!body.taskId || !personIds.length || !message || (body.channel !== "email" && body.channel !== "slack")) return Response.json({ error: "A task, at least one person, a channel and a message are required" }, { status: 400 });
  const row = g.row!;
  const results = await sendTaskNotes({ plan: { id, title: row.title, data: row.data as Record<string, unknown> }, taskId: body.taskId, personIds, channel: body.channel, message, fromName: g.actor!.name || "A colleague", baseUrl: appBase() });
  if (!results.length) return Response.json({ error: "None of the selected people are on this task" }, { status: 400 });
  return Response.json({ results, sentCount: results.filter(r => r.sent).length, totalCount: results.length });
}
