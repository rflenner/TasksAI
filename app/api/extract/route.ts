import { env } from "cloudflare:workers";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject","description","owner","collaborators","recipients","due","topic","project","recurringMeeting"],
        properties: {
          subject: { type: "string" }, description: { type: "string" },
          owner: { type: ["string","null"] }, collaborators: { type: "array", items: { type: "string" } }, recipients: { type: "array", items: { type: "string" } },
          due: { type: ["string","null"], description: "YYYY-MM-DD when known" }, topic: { type: ["string","null"] }, project: { type: ["string","null"] }, recurringMeeting: { type: ["string","null"] },
        },
      },
    },
  },
};

export async function POST(request: Request) {
  const { minutes } = await request.json() as { minutes?: string };
  if (!minutes?.trim()) return Response.json({ error: "Meeting minutes are required" }, { status: 400 });
  const runtime = env as unknown as Record<string, string | undefined>;
  const key = runtime.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured", code: "ai_unavailable" }, { status: 503 });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: runtime.OPENAI_MODEL || "gpt-5-mini",
      input: [{ role: "system", content: "Extract every concrete commitment, follow-up, decision requiring work, and implied action from meeting minutes. Understand headings, topic sections, tables, prose, initials, owner/coworker lists, and unusual layouts. Never discard an action because metadata is missing; return null or an empty array for unknown fields. Do not invent people, dates, projects, meetings, or recipients." }, { role: "user", content: minutes }],
      text: { format: { type: "json_schema", name: "meeting_actions", strict: true, schema } },
    }),
  });
  if (!response.ok) return Response.json({ error: "AI extraction failed", code: "ai_failed" }, { status: 502 });
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  try { return Response.json(JSON.parse(text)); } catch { return Response.json({ error: "AI returned an invalid result", code: "ai_failed" }, { status: 502 }); }
}
