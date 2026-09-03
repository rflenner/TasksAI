// The actual OpenAI call + schema behind task extraction — pulled out of
// app/api/extract/route.ts (still the only caller for a signed-in user
// pasting/dictating minutes) so app/api/webhooks/inbound-email/route.ts
// can run the identical extraction against a forwarded email's body
// without going through a route that requires a session cookie. Nothing
// about the prompt, schema, or model call changed in the move — only
// extraInstruction (dictate's single-task rule) became a parameter
// instead of being inlined, so this stays generic to any source.
export type ExtractedTask = {
  subject: string; description: string; owner: string | null;
  collaborators: string[]; recipients: string[];
  due: string | null; topic: string | null; project: string | null; recurringMeeting: string | null;
};
type ExtractionResult =
  | { ok: true; tasks: ExtractedTask[] }
  | { ok: false; error: string; code: "ai_unavailable" | "ai_failed"; status: 503 | 502 };

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

export async function callTaskExtractionAI(text: string, opts: { extraInstruction?: string } = {}): Promise<ExtractionResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "AI is not configured", code: "ai_unavailable", status: 503 };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [{ role: "system", content: `Extract every concrete commitment, follow-up, decision requiring work, unanswered request, and implied action from the supplied minutes.
The source may be incomplete, badly formatted, conversational, multilingual, table-like, or use headings/initials without consistent punctuation. Treat fragments under a heading as part of that section. Preserve one task per distinct action and do not merge unrelated commitments.
Extraction completeness matters: before returning, re-scan the entire source for missed actions. Never discard an action because metadata is absent. Use null or [] for unknown fields and never invent people, dates, projects, meetings, or recipients. Follow the JSON schema exactly.
Every task must be grounded in something actually said in the source — restate or closely paraphrase it, never invent a plausible-sounding generic agenda item ("Review previous action items", "Any other business", "Discuss blockers", "Project updates", and the like) that nobody in the source actually said. If the source is short, unclear, or contains no concrete commitments, follow-ups, decisions, or requests at all, return an empty tasks array — never fill it with a typical meeting-agenda checklist just to have something to return.${opts.extraInstruction || ""}` }, { role: "user", content: text }],
      text: { format: { type: "json_schema", name: "meeting_actions", strict: true, schema } },
    }),
  });
  if (!response.ok) return { ok: false, error: "AI extraction failed", code: "ai_failed", status: 502 };
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const outputText = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  let parsed: { tasks?: ExtractedTask[] };
  try { parsed = JSON.parse(outputText); } catch { return { ok: false, error: "AI returned an invalid result", code: "ai_failed", status: 502 }; }
  return { ok: true, tasks: parsed.tasks || [] };
}
