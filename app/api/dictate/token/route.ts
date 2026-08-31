import { getDb } from "../../../../db";
import { dimensionValues } from "../../../../db/schema";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

// Mints a short-lived, scoped Deepgram key so the browser can open a live
// transcription WebSocket directly to Deepgram. Streaming audio through
// our own server would need a custom WebSocket-capable Node server —
// Next.js route handlers don't support the upgrade — so instead we follow
// Deepgram's own guidance for browser clients: never ship the long-lived
// project key to the page, mint a narrow, single-session one instead.
// Also returns the current glossary so the client can build the same
// Keyterm-Prompting boost list the pre-recorded /api/voice-test-deepgram
// route uses, tuned for this app's real people/projects.
const KEYTERM_LIMIT = 100;
const TOKEN_TTL_SECONDS = 300;

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "Voice capture isn't configured yet", code: "ai_unavailable" }, { status: 503 });

  const glossaryRows = await getDb().select({ value: dimensionValues.value }).from(dimensionValues).limit(KEYTERM_LIMIT);
  const glossary = glossaryRows.map(row => row.value);

  const projectsRes = await fetch("https://api.deepgram.com/v1/projects", { headers: { authorization: `Token ${key}` } });
  if (!projectsRes.ok) return Response.json({ error: "Could not reach Deepgram", code: "ai_failed" }, { status: 502 });
  const projectsData = await projectsRes.json() as { projects?: Array<{ project_id: string }> };
  const projectId = projectsData.projects?.[0]?.project_id;
  if (!projectId) return Response.json({ error: "No Deepgram project found for this key", code: "ai_failed" }, { status: 502 });

  const keyRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ comment: "task-ai dictate session", scopes: ["usage:write"], time_to_live_in_seconds: TOKEN_TTL_SECONDS }),
  });
  if (!keyRes.ok) {
    const detail = await keyRes.text().catch(() => "");
    return Response.json({ error: `Could not create a temporary Deepgram key${detail ? `: ${detail.slice(0, 200)}` : ""}`, code: "ai_failed" }, { status: 502 });
  }
  const keyData = await keyRes.json() as { key?: string };
  if (!keyData.key) return Response.json({ error: "Deepgram did not return a key", code: "ai_failed" }, { status: 502 });

  return Response.json({ token: keyData.key, glossary, model: process.env.DEEPGRAM_MODEL || "nova-3" });
}
