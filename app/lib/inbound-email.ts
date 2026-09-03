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
// due date mentioned at all. This gives an email-forwarded task with no
// timing signal a real, sensible deadline instead: `days` business days
// (Mon-Fri, no weekends) after the reference date, which is the email's
// own received date, not "whenever this happens to be processed."
export function addBusinessDays(referenceDateISO: string, days: number): string {
  const date = new Date(`${referenceDateISO.slice(0, 10)}T12:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}
