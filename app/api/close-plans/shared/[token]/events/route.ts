import { CLIENT_EVENTS, logAccess, taskTitleOf, type AccessEvent } from "../../../../../lib/close-plan-access-log";
import { resolvePlanLink } from "../../../../../lib/close-plan-links";
import { customerPerson, customerView } from "../../../../../lib/close-plan-share";
import { requireSameOrigin } from "../../../../../lib/request";

export const dynamic = "force-dynamic";

// A customer's page tells us which task they opened: { event: "task_opened", taskId }. Only tasks shared with them count. (Opening the plan itself is logged when the page loads.)
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const resolved = await resolvePlanLink((await params).token);
  if (!resolved) return new Response(null, { status: 410 });
  const body = await request.json().catch(() => null) as { event?: string; taskId?: string } | null;
  const event = body?.event as AccessEvent, data = resolved.row.data as Record<string, unknown>, person = customerPerson(data, resolved.link.personId);
  if (!person || event !== "task_opened" || !CLIENT_EVENTS.includes(event)) return new Response(null, { status: 400 });
  const taskId = String(body?.taskId || ""), view = customerView(data, resolved.link.personId), shared = Array.isArray(view?.tasks) && (view!.tasks as Array<{ id: string }>).some(t => t.id === taskId);
  if (!shared) return new Response(null, { status: 404 });
  await logAccess({ event, side: "buyer", via: "link", personId: resolved.link.personId, personName: String(person.name || "Customer"), plan: { id: resolved.row.id, title: resolved.row.title }, task: { id: taskId, title: taskTitleOf(data, taskId) }, dedupeMinutes: 10 });
  return new Response(null, { status: 204 });
}
