// Small pure helpers for app/api/webhooks/inbound-email/route.ts, pulled
// out to their own file so they're unit-testable without a live webhook
// request or a database — mirrors how app/lib/resend-webhook.ts already
// separates signature verification from the route that calls it.

// Resend delivers "Name <address>" or a bare address in the from field
// depending on the original message's From header — a forward almost
// always carries the forwarder's own client-formatted header, so this
// has to handle both.
export function bareEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

// Last-resort fallback when Resend's Received Emails API returns `.html`
// but no usable `.text` — good enough to hand a meeting-minutes-grade
// extraction prompt something readable, not meant to preserve formatting.
export function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Finds "Name <email>" pairs anywhere in the raw email text — most
// reliably the quoted From/To/Cc header lines a forwarded email carries
// in its body, since Resend's webhook only tells the route who *sent*
// the forward (bareEmail above), nothing about who else is named inside
// it. Confirmed live 2026-09-03: a forwarded email whose quoted headers
// read "Xenofon Kanarios <xenofon@iseeit.com>" still produced a task
// with a differently-spelled owner name, because the AI extraction had
// only the prose to go on — this hands the route the one thing more
// reliable than a spelled name for cross-checking against users/
// contacts: the actual address attached to it in the source text.
// Deliberately just a regex over plain text, not a real header parser —
// this only needs to catch the common "Name <addr>" shape, not handle
// every RFC 5322 edge case.
export function extractEmailNameHints(text: string): Map<string, string> {
  const hints = new Map<string, string>();
  const pattern = /([^<>\n,]{1,80})<\s*([^<>\s@]+@[^<>\s]+)\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    // The captured group is everything on the line before "<email>",
    // which for a real header line ("From: Xenofon Kanarios <...>")
    // includes the "From: " label itself — strip that off before
    // treating the rest as the name.
    const name = match[1].trim().replace(/^(?:from|to|cc|bcc|reply-to)\s*:\s*/i, "").trim().replace(/^["']|["']$/g, "").trim();
    const email = match[2].trim().toLowerCase();
    if (name && email.includes("@")) hints.set(name.toLowerCase(), email);
  }
  return hints;
}

// Resolves a name the AI extracted (owner/collaborator/recipient) against
// the header-name -> canonical-name map the caller built from
// extractEmailNameHints + a users/contacts email lookup — same
// exact-then-first-name tolerance as name-resolution.ts's
// resolveRegisteredName, kept separate rather than merged into that
// function since this one is keyed off text actually present in the
// email, not off the app's registered-users list.
export function resolveViaEmailHint(spoken: string, hints: Map<string, string>): string | null {
  const lower = spoken.trim().toLowerCase();
  if (!lower) return null;
  const exact = hints.get(lower);
  if (exact) return exact;
  for (const [headerName, canonical] of hints) {
    if (headerName.split(/\s+/)[0] === lower) return canonical;
  }
  return null;
}

// A task with due:"" used to read as overdue immediately — an empty
// string sorts before any real YYYY-MM-DD, so the dashboard's
// `due < TODAY` overdue check was silently true for every task with no
// due date mentioned at all. Superseded 2026-09-15 by the app-wide
// resolveDueDate/defaultDueDate (app/lib/task-defaults.ts) — every
// creation path gets the same 7-calendar-day-out fallback now, not just
// this one with its own narrower 3-business-day rule.

// Cuts the quoted history off a reply, keeping only what the person
// actually just typed — for app/api/webhooks/inbound-email/route.ts's
// reply-to-update-a-task path (2026-09-15), where the *whole* email body
// would otherwise get posted as the task update, history and all, every
// single time someone replies. Not a full MIME/quote parser (Talon-grade
// reply parsing is its own small industry) — just the handful of marker
// lines that cover the clients people actually use: Gmail/Apple Mail's
// "On <date>, <name> wrote:", Outlook's "-----Original Message-----" (or
// its own unmarked "From: / Sent: / To: / Subject:" block), and a run of
// "&gt;"-quoted lines, whichever comes first. No marker found at all
// (a client that sends a clean reply with no quoting, or a top-post with
// the quote stripped by the client already) just returns the text as-is
// — nothing to cut.
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const markers = [
    /^\s*On\s.{1,120}\swrote:\s*$/i,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    /^\s*From:\s*.+$/i,
    /^\s*>/,
  ];
  for (let i = 0; i < lines.length; i++) {
    if (markers.some(marker => marker.test(lines[i]))) return lines.slice(0, i).join("\n").trim();
  }
  return text.trim();
}

const REPLY_STATUS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["status"],
  properties: { status: { type: ["string", "null"], enum: ["Open", "In progress", "Closed", null] } },
};

// Does a reply's own words say anything about the task's status? Requested
// 2026-09-15 after a live test: a reply reading "Yes, I'm working on it"
// posted correctly as an update but left status untouched, since a reply
// was only ever wired to add text, never to infer intent from it — this
// closes that gap using the same phrasing convention voice mode's "act"
// set_status already uses (see app/api/voice-query/route.ts), so a status
// spoken to the assistant and a status typed in a reply read the same way
// across the app. Deliberately narrower than that route's full action
// classifier: a reply can only ever move status, nothing else (no
// rewriting the subject, no adding/removing people) — those stay
// intentional, in-app actions, not something free text in an inbox should
// silently trigger.
// Best-effort like every other optional AI feature here: no key configured,
// a failed call, or an unparseable result all just mean "no status
// change," never an error that blocks the update itself from posting.
export async function classifyReplyStatus(text: string, currentStatus: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text.trim()) return null;
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const isGpt5 = model.startsWith("gpt-5");
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: `A task is currently "${currentStatus}". The user just replied to an email about it. Does their reply itself say or clearly imply a new status for the task? "mark done"/"closing this out"/"finished"/"complete" -> Closed. "reopening this"/"not actually done" -> Open. "starting on it"/"in progress"/"working on it now" -> In progress. If the reply doesn't say anything about the task's status one way or the other (just a comment, a question, a blocker note, a "thanks", an unrelated remark), return null — never guess.` },
          { role: "user", content: text },
        ],
        ...(isGpt5 ? { reasoning: { effort: "minimal" } } : {}),
        text: { ...(isGpt5 ? { verbosity: "low" } : {}), format: { type: "json_schema", name: "reply_status", strict: true, schema: REPLY_STATUS_SCHEMA } },
      }),
    });
    if (!response.ok) return null;
    const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const outputText = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
    const parsed = JSON.parse(outputText) as { status?: string | null };
    return parsed.status && parsed.status !== currentStatus ? parsed.status : null;
  } catch {
    return null;
  }
}

// Picks the reply-token address out of an inbound email's "to" list, if
// any of them is one — for app/api/webhooks/inbound-email/route.ts's
// early branch between "this is a reply to a manual-notify email, apply
// it as a task update" and "this is a fresh forward, extract a new task."
// A manual-notify email's reply-to is exactly one address
// (reply+{token}@..., see app/lib/task-notify.ts's sendManualNotify), but
// a reply can carry other recipients too (anyone CC'd, or the original
// sender's own address if their client added it back) — so this checks
// every "to" entry rather than assuming the first or only one matters,
// and returns the first match. Pulled out to its own testable function
// rather than left inline in the route, same reasoning as stripQuotedReply
// just above.
export function findReplyToken(toAddresses: string[]): string | null {
  for (const address of toAddresses) {
    const match = bareEmail(address).match(/^reply\+([0-9a-f]+)@/i);
    if (match) return match[1];
  }
  return null;
}
