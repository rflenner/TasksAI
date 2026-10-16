import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { voiceRequestAsks, voiceRequestStatus } from "../../db/schema";

// Product requests heard by the voice assistants: something a person asked
// for that the assistant can't do yet, or an explicit "I wish you could…".
// Each ask is filed under a short request name (the AI reuses an existing
// name when it's the same thing), so the team sees which requests matter to
// how many people. Ranking is pure (rankRequests) so it's unit-tested.

export const REQUEST_STATUSES = ["new", "planned", "built", "wont_do"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABEL: Record<RequestStatus, string> = { new: "New", planned: "Planned", built: "Built", wont_do: "Won't do" };

export type Ask = { requestName: string; kind: string; userId: number | null; actorName: string; sessionId: string; surface: string; utterance: string; createdAt: Date };
export type RankedRequest = {
  name: string; score: number; people: number; times: number; wishes: number; frustrated: number;
  lastAt: Date; surfaces: string[]; askedBy: string[]; examples: string[]; status: RequestStatus; note: string;
};

export const cleanRequestName = (raw: unknown) => String(raw || "").replace(/\s+/g, " ").replace(/[^\p{L}\p{N} &/'’-]/gu, "").trim().slice(0, 80);

// Importance from behaviour: how many different people asked weighs most,
// then explicit wishes and frustration (asking for the same thing again in
// one session, usually rephrased after a failure), then how often overall.
export function rankRequests(asks: Ask[], statuses: Map<string, { status: string; note: string }> = new Map()): RankedRequest[] {
  const groups = new Map<string, Ask[]>();
  for (const a of asks) { const k = a.requestName; if (!k) continue; groups.set(k, [...(groups.get(k) || []), a]); }
  return [...groups.entries()].map(([name, list]) => {
    const people = new Set(list.map(a => a.userId ?? a.actorName)).size;
    const wishes = list.filter(a => a.kind === "wish").length;
    const perSession = new Map<string, number>();
    list.forEach(a => { if (a.sessionId) perSession.set(a.sessionId, (perSession.get(a.sessionId) || 0) + 1); });
    const frustrated = [...perSession.values()].filter(n => n >= 2).length;
    const st = statuses.get(name);
    const status = (REQUEST_STATUSES as readonly string[]).includes(st?.status || "") ? st!.status as RequestStatus : "new";
    const sorted = [...list].sort((a, b) => +b.createdAt - +a.createdAt);
    return {
      name, people, times: list.length, wishes, frustrated, score: people * 5 + wishes * 3 + frustrated * 2 + list.length,
      lastAt: sorted[0].createdAt, surfaces: [...new Set(list.map(a => a.surface))], askedBy: [...new Set(sorted.map(a => a.actorName).filter(Boolean))].slice(0, 6),
      examples: [...new Set(sorted.map(a => a.utterance.trim()).filter(Boolean))].slice(0, 3), status, note: st?.note || "",
    };
  }).sort((a, b) => b.score - a.score || +b.lastAt - +a.lastAt);
}

// An existing request name is only reused when it really shares words with
// what was said (a live test filed "show me the history of this task" under
// "Send Invitations By Voice"); otherwise the AI's own fresh name is used.
const GENERIC = new Set(["voice", "by", "the", "a", "an", "to", "for", "of", "and", "in", "on", "with", "from", "plan", "close", "task", "tasks", "can", "you"]);
const stems = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !GENERIC.has(w)).map(w => w.slice(0, 5));
export function pickRequestName(ownName: string, sameAs: string | null, known: string[], utterance: string): string {
  const said = new Set(stems(utterance));
  const fits = (name: string) => stems(name).some(w => said.has(w));
  const match = sameAs ? known.find(k => k === sameAs) : null;
  if (match && fits(match)) return match;
  // The AI's own name, unless it just copied an unrelated known name (a live
  // test filed "invite Drew" under "Task History By Voice").
  const fresh = cleanRequestName(ownName);
  if (fresh && (fits(fresh) || !known.some(k => k.toLowerCase() === fresh.toLowerCase()))) return fresh;
  return nameFromWords(utterance);
}

// Last resort: a name made from what was said ("Invite Drew To Task AI").
const FILLER = new Set(["please", "can", "could", "would", "you", "me", "i", "want", "to", "the", "a", "an", "just", "now", "hey", "okay", "ok", "so"]);
export function nameFromWords(utterance: string): string {
  const words = utterance.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w, i) => !(FILLER.has(w.toLowerCase()) && i < 3)).slice(0, 6);
  return cleanRequestName(kept.map(w => w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)).join(" ")) || "Other Request";
}

export async function recordRequestAsk(actor: { id?: number; name: string }, ask: { sessionId: string; surface: string; requestName: string; kind: "unsupported" | "wish"; utterance: string }) {
  const name = cleanRequestName(ask.requestName); if (!name) return;
  await getDb().insert(voiceRequestAsks).values({ userId: actor.id ?? null, actorName: actor.name, sessionId: ask.sessionId, surface: ask.surface, requestName: name, kind: ask.kind, utterance: ask.utterance.slice(0, 1000) });
}

// The names already in use, most asked first, so the AI files a new ask under the same name.
export async function knownRequestNames(limit = 60): Promise<string[]> {
  const rows = await getDb().select({ name: voiceRequestAsks.requestName, n: sql<number>`count(*)` }).from(voiceRequestAsks)
    .groupBy(voiceRequestAsks.requestName).orderBy(desc(sql`count(*)`)).limit(limit);
  return rows.map(r => r.name);
}

export async function loadRankedRequests(): Promise<RankedRequest[]> {
  const db = getDb();
  const [asks, statuses] = await Promise.all([
    db.select().from(voiceRequestAsks).orderBy(desc(voiceRequestAsks.createdAt)).limit(5000),
    db.select().from(voiceRequestStatus),
  ]);
  return rankRequests(asks, new Map(statuses.map(s => [s.requestName, { status: s.status, note: s.note }])));
}

// Folds one request into another (same feature, different name): its asks move over, its status goes.
export async function mergeRequests(from: string, into: string) {
  if (!from || !into || from === into) return;
  await getDb().update(voiceRequestAsks).set({ requestName: into }).where(eq(voiceRequestAsks.requestName, from));
  await getDb().delete(voiceRequestStatus).where(eq(voiceRequestStatus.requestName, from));
}

export async function setRequestStatus(name: string, status: RequestStatus, note: string, userId: number | null) {
  await getDb().insert(voiceRequestStatus).values({ requestName: name, status, note, updatedBy: userId })
    .onConflictDoUpdate({ target: voiceRequestStatus.requestName, set: { status, note, updatedBy: userId, updatedAt: new Date() } });
}
