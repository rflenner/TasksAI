// Browser side of the voice audit trail (app/lib/voice-audit.ts): shared by
// both voice assistants so they report the same way. Fire-and-forget on
// purpose — a failed report is swallowed, never surfaced or retried,
// because the audit trail is a debugging aid and must never be a reason a
// voice session slows down or errors.
export type ClientAuditEvent = {
  event: "heard" | "said" | "confirmation" | "session" | "error";
  utterance?: string; mode?: string; outcome?: "sent" | "declined" | "not_done" | "failed" | "changed" | "shown";
  taskIds?: number[]; spokenAnswer?: string; detail?: Record<string, unknown>;
};

export function newVoiceSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export function reportVoiceAudit(sessionId: string, source: "live" | "ask", events: ClientAuditEvent[]): void {
  if (!events.length) return;
  try {
    void fetch("/api/voice-audit", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ sessionId, source, events }),
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}
