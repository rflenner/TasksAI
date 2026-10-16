import { currentActor } from "../../../lib/session";
import { formatSessionsAsText, loadVoiceAuditSessions, parseAuditFilters } from "../../../lib/voice-audit";

// Plain-text (or JSON) export of the voice audit trail, for copying into a
// chat/email or saving as a file (requested 2026-10-02: "I think we should
// be able to copy or download it so I can better share with you"). Built
// from the exact same loader + filters as the /voice-audit page, so what's
// exported is what's on screen. Site admins only, same as the page — it
// holds transcripts of what people said. `session=<key>` exports just
// that one session; `download=1` makes the browser save it as a file.
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (actor.role !== "site_admin") return Response.json({ error: "Only site admins can export the voice audit trail" }, { status: 403 });

  const url = new URL(request.url);
  const filters = parseAuditFilters(Object.fromEntries(url.searchParams));
  const sessionId = url.searchParams.get("session") || undefined;
  const { sessions } = await loadVoiceAuditSessions(filters, sessionId);
  const now = new Date();
  const headers: Record<string, string> = { "cache-control": "no-store" };

  if (url.searchParams.get("format") === "json") {
    headers["content-type"] = "application/json; charset=utf-8";
    if (url.searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename="voice-audit-${now.toISOString().slice(0, 10)}.json"`;
    return new Response(JSON.stringify({ exportedAt: now.toISOString(), filters: sessionId ? null : filters, sessions }, null, 2), { headers });
  }

  headers["content-type"] = "text/plain; charset=utf-8";
  if (url.searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename="voice-audit-${now.toISOString().slice(0, 10)}.txt"`;
  return new Response(formatSessionsAsText(sessions, sessionId ? null : filters, now), { headers });
}
