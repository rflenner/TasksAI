import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { closePlanDocuments } from "../../../../../db/schema";
import { resolvePlanLink, touchPlanLink } from "../../../../lib/close-plan-links";
import { applyCustomerChanges, customerView, markOpened } from "../../../../lib/close-plan-share";
import { requireSameOrigin } from "../../../../lib/request";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);
const gone = () => Response.json({ error: "This link is no longer valid. Ask your iSEEit contact for a new one." }, { status: 410 });

// The plan as this customer contact sees it (see customerView). The first visit
// marks their invitation as opened.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePlanLink(token);
  if (!resolved) return gone();
  const { link } = resolved;
  let { row } = resolved;
  const opened = markOpened(row.data, link.personId, today());
  if (opened) {
    const [saved] = await getDb().update(closePlanDocuments).set({ data: opened, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(closePlanDocuments.id, row.id), eq(closePlanDocuments.version, row.version))).returning();
    if (saved) row = saved;
  }
  await touchPlanLink(link.id);
  return Response.json({ me: link.personId, version: row.version, plan: customerView(row.data, link.personId) }, { headers: { "cache-control": "no-store" } });
}

// A customer contact's changes: { changes: { tasks, activity } }. Checked field by
// field against their rights (applyCustomerChanges) and applied to the latest
// stored plan, retrying if someone saved in between.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const { token } = await params;
  const body = await request.json().catch(() => null) as { changes?: unknown } | null;
  if (!body || !body.changes || typeof body.changes !== "object") return Response.json({ error: "Nothing to save" }, { status: 400 });
  if (JSON.stringify(body).length > 1_000_000) return Response.json({ error: "Too much at once" }, { status: 413 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const resolved = await resolvePlanLink(token);
    if (!resolved) return gone();
    const { link, row } = resolved;
    const { data, applied, ignored } = applyCustomerChanges(row.data, link.personId, body.changes as Record<string, unknown>, today());
    const [saved] = await getDb().update(closePlanDocuments).set({ data, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(closePlanDocuments.id, row.id), eq(closePlanDocuments.version, row.version))).returning();
    if (!saved) continue;
    await touchPlanLink(link.id);
    return Response.json({ version: saved.version, applied, ignored, plan: customerView(saved.data, link.personId) });
  }
  return Response.json({ error: "The plan is busy. Please try again." }, { status: 409 });
}
