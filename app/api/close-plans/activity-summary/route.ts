import { sanitizeActivity, SUMMARY_INSTRUCTIONS, summaryInput } from "../../../lib/close-plan-summary";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

// Short AI summary of a close plan's last 7 days of activity, shown on top of
// the plan's "Recent activity" panel. Signed-in users only; the demo page
// falls back to its own rule-based summary when this returns an error.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured" }, { status: 503 });
  const body = await request.json().catch(() => null) as { plan?: unknown; items?: unknown } | null;
  const items = sanitizeActivity(body?.items);
  if (!items.length) return Response.json({ summary: "" });
  const plan = typeof body?.plan === "string" ? body.plan : "Close plan";
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const isGpt5 = model.startsWith("gpt-5");
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ role: "system", content: SUMMARY_INSTRUCTIONS }, { role: "user", content: summaryInput(plan, items) }],
        // A summary of a few dozen lines needs no deliberation; keep it fast.
        ...(isGpt5 ? { reasoning: { effort: "minimal" }, text: { verbosity: "low" } } : {}),
      }),
    });
    if (!response.ok) return Response.json({ error: "AI summary failed" }, { status: 502 });
    const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const summary = (result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "").trim();
    return Response.json({ summary: summary.slice(0, 800) });
  } catch (error) {
    console.error("Close Plan activity summary failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "AI summary failed" }, { status: 502 });
  }
}
