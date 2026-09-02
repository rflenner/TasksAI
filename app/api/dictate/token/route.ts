import { getDb } from "../../../../db";
import { dimensionValues } from "../../../../db/schema";
import { buildGlossary } from "../../../lib/glossary";
import { requireSameOrigin } from "../../../lib/request";
import { currentActor } from "../../../lib/session";

// Hands the browser what it needs to open a live transcription WebSocket
// directly to Deepgram — streaming audio through our own server would
// need a custom WebSocket-capable Node process (Next.js route handlers
// don't support the upgrade), so the client has to talk to Deepgram
// itself. Deepgram's own guidance for that is to mint a short-lived,
// scoped key per session rather than exposing the long-lived project
// key — but that needs the key to carry the "keys:write" management
// scope, which this account's key doesn't have. Using the long-lived key
// directly is a real tradeoff (any signed-in user with devtools open
// could see it, for as long as it's valid — not just a 5-minute window)
// that's acceptable for now since this is an internal tool behind sign-
// in, not public. Revisit if the key ever gets keys:write scope (restores
// temporary keys with no other change needed) or if this needs to be
// tighter later (proxy the WebSocket server-side instead, so no Deepgram
// credential ever reaches the browser).
// Also returns the current glossary so the client can build the same
// Keyterm-Prompting boost list the pre-recorded /api/voice-test-deepgram
// route uses, tuned for this app's real people/projects — see
// app/lib/glossary.ts for why the raw dimensionValues list gets trimmed
// before being handed back, not just capped by count.
const KEYTERM_LIMIT = 100;

export async function POST(request: Request) {
  const invalid = requireSameOrigin(request); if (invalid) return invalid;
  if (!await currentActor()) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "Voice capture isn't configured yet", code: "ai_unavailable" }, { status: 503 });

  const glossaryRows = await getDb().select({ value: dimensionValues.value }).from(dimensionValues).limit(KEYTERM_LIMIT);
  const glossary = buildGlossary(glossaryRows.map(row => row.value));

  return Response.json({ token: key, glossary, model: process.env.DEEPGRAM_MODEL || "nova-3" });
}
