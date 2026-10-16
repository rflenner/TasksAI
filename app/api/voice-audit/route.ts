import { requireSameOrigin } from "../../lib/request";
import { currentActor } from "../../lib/session";
import { cleanSessionId, cleanSource, recordVoiceAudit, sanitizeClientAuditEvent, type VoiceAuditRow } from "../../lib/voice-audit";

// Where the browser reports the parts of a voice session the server never
// sees on its own — what the person actually said and what the assistant
// said back (Live Voice Assistant), how a notify yes/no turned out,
// session start/stop, and transport errors. The authoritative record of
// what Task AI actually DID with a request is written server-side by
// /api/voice-query itself; this only adds the surrounding context, and
// can't write that kind of row ("request") even if asked to. Each event
// is validated and length-capped (sanitizeClientAuditEvent); anything
// unrecognized is silently dropped rather than rejected — audit logging
// is a debugging aid and must never become a reason a voice session
// misbehaves.
export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { sessionId?: unknown; source?: unknown; events?: unknown };
  const sessionId = cleanSessionId(body.sessionId), source = cleanSource(body.source);
  const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
  const rows: VoiceAuditRow[] = [];
  for (const raw of events) {
    const clean = sanitizeClientAuditEvent(raw);
    if (clean) rows.push({ sessionId, source, ...clean });
  }
  try { await recordVoiceAudit({ id: actor.id, name: actor.name }, rows); }
  catch (error) { console.error("Voice audit write failed:", error instanceof Error ? error.message : error); }
  return Response.json({ ok: true, recorded: rows.length });
}
