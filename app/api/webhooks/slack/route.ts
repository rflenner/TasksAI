// Receives everything from Task AI's Slack app: the /task slash command
// and every interactive action (button clicks, modal submissions) — Slack
// is configured to point BOTH at this one URL (see the manifest in the
// Slack app's settings), so this just branches on which shape arrived.
//
// Deliberately a stub past signature verification for now: opened
// 2026-09-11, before a real Slack app/bot token/signing secret exist to
// test against. The wiring here (verify, parse, route by shape, respond
// within Slack's 3-second budget) is real and won't need to change —
// only the three branches' bodies do, once there's something real to
// verify them against. See SLACK_BOT_TOKEN/SLACK_SIGNING_SECRET in
// render.yaml for where the real credentials will land.
import { isFreshSlackTimestamp, verifySlackSignature } from "../../../lib/slack-webhook";

export async function POST(request: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) { console.error("SLACK_SIGNING_SECRET is not configured; ignoring inbound Slack request"); return Response.json({ ok: true }); }

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signatureHeader = request.headers.get("x-slack-signature");
  // Raw text, not request.formData() — signature verification needs the
  // exact bytes Slack signed, and re-serializing a parsed form can differ
  // byte-for-byte (key order, encoding) even when the values match.
  const body = await request.text();
  if (!timestamp || !signatureHeader || !isFreshSlackTimestamp(timestamp) || !verifySlackSignature({ secret, timestamp, body, signatureHeader })) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const form = new URLSearchParams(body);

  // Interactivity: button clicks and modal ("view") submissions — Slack
  // sends the real payload as one JSON string under the "payload" key,
  // not as plain form fields.
  const payloadRaw = form.get("payload");
  if (payloadRaw) {
    let payload: { type?: string; user?: { id?: string; username?: string } };
    try { payload = JSON.parse(payloadRaw); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
    // TODO once a real bot token/signing secret exist: map payload.user.id
    // -> a Task AI user (users.lookupByEmail, then the same users-by-email
    // lookup app/api/webhooks/inbound-email/route.ts already does), run
    // canWriteTask, apply block_actions (Update/Close/Delegate button
    // clicks) or view_submission (the Update/Delegate modals' results)
    // the same way V()/PATCH /api/tasks already does, then update the
    // original message via response_url so it reflects the change in
    // place.
    console.log("Slack interactivity received", payload.type, "from", payload.user?.username);
    return Response.json({ ok: true });
  }

  // Slash command: POST body is plain form fields, not JSON — command,
  // text, user_id, user_name, response_url, etc.
  const command = form.get("command");
  if (command) {
    // TODO once real: run form.get("text") through the exact same
    // extraction pipeline callTaskExtractionAI/app/api/extract already
    // uses for Dictate Task, self-assigning to the Slack user (mapped by
    // email) when no owner is said, same as dictation's own rule.
    console.log("Slack slash command received", command, "from", form.get("user_name"));
    return Response.json({
      response_type: "ephemeral",
      text: "Task AI's Slack integration is still being set up — check back soon!",
    });
  }

  return Response.json({ ok: true });
}
