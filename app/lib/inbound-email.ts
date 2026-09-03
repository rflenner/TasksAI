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
