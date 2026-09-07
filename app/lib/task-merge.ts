import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { taskActivity, tasks } from "../../db/schema";

export type StoredTask = typeof tasks.$inferSelect;
export type DuplicateRelationship = "duplicate" | "possible-update";
export type DuplicateCandidate = { olderId: number; newerId: number; score: number; reasons: string[]; relationship: DuplicateRelationship };

const STOPWORDS = new Set(["the", "a", "an", "to", "and", "or", "of", "for", "with", "on", "in", "at", "by", "is", "are", "be", "this", "that", "will"]);

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !STOPWORDS.has(word)));
}

// Plain Jaccard similarity (shared / union) over word tokens — deliberately
// this simple, not a full fuzzy-matching engine: requested 2026-09-08 as
// one signal among several (same meeting/account/opportunity, overlapping
// people), not the sole decider, so it only needs to be good enough to
// catch real cases like "Send sales progression playbook to Pavneet" vs
// "...playbook visuals to Pavneet" — which it does (5 of 6 tokens shared).
export function textSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a), tokensB = tokenize(b);
  if (!tokensA.size && !tokensB.size) return 0;
  const union = new Set([...tokensA, ...tokensB]);
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return union.size ? shared / union.size : 0;
}

function peopleOf(task: Pick<StoredTask, "owner" | "collaborators" | "recipients">): Set<string> {
  return new Set([task.owner, ...task.collaborators, ...task.recipients].filter(Boolean));
}
function sharedPeopleCount(a: StoredTask, b: StoredTask): number {
  const peopleA = peopleOf(a);
  let count = 0;
  for (const person of peopleOf(b)) if (peopleA.has(person)) count++;
  return count;
}

// Scores exactly one pair — exported on its own (not just via
// findDuplicateCandidates) so both can be unit-tested directly against
// hand-built task pairs, not only through the bucketing pass below.
// Weights are a judgment call, not a formula from the request: same
// meeting is the strongest signal (confirmed live as the top priority),
// account/opportunity match is secondary, wording and shared people are
// supporting signals that nudge borderline pairs over the threshold
// rather than qualifying one on their own.
export function compareForDuplicate(a: StoredTask, b: StoredTask): DuplicateCandidate | null {
  if (a.id === b.id) return null;
  const reasons: string[] = [];
  let score = 0;

  const sameMeeting = Boolean(a.meetingId) && a.meetingId === b.meetingId;
  if (sameMeeting) { score += 0.5; reasons.push("same Sales AI meeting"); }

  const sameAccount = Boolean(a.accountId) && a.accountId === b.accountId;
  if (sameAccount) { score += 0.15; reasons.push(`same account${a.accountName ? ` (${a.accountName})` : ""}`); }
  const sameOpportunity = Boolean(a.opportunityId) && a.opportunityId === b.opportunityId;
  if (sameOpportunity) { score += 0.15; reasons.push(`same opportunity${a.opportunityName ? ` (${a.opportunityName})` : ""}`); }

  const similarity = Math.max(textSimilarity(a.subject, b.subject), textSimilarity(`${a.subject} ${a.description}`, `${b.subject} ${b.description}`));
  if (similarity > 0) score += similarity * 0.3;
  if (similarity >= 0.4) reasons.push(`similar wording (${Math.round(similarity * 100)}% word overlap)`);

  const shared = sharedPeopleCount(a, b);
  if (shared > 0) { score += Math.min(shared, 2) * 0.05; reasons.push(`${shared} shared ${shared === 1 ? "person" : "people"}`); }

  if (score < 0.35) return null; // below this, more likely coincidence than a real duplicate worth a reviewer's time

  const [older, newer] = a.created <= b.created ? [a, b] : [b, a];
  // Different meeting (when both are known) or a different creation day
  // means the later one might genuinely be a fresh update on the same
  // commitment rather than an accidental duplicate — confirmed live
  // 2026-09-08: "the later task could serve as update to the earlier
  // one." The merge action folds the newer one's content in as a status
  // update either way; this label just tells a reviewer which case
  // they're likely looking at.
  const meetingDiffers = Boolean(older.meetingId) && Boolean(newer.meetingId) && older.meetingId !== newer.meetingId;
  const createdDiffers = older.created.slice(0, 10) !== newer.created.slice(0, 10);
  const relationship: DuplicateRelationship = meetingDiffers || createdDiffers ? "possible-update" : "duplicate";

  return { olderId: older.id, newerId: newer.id, score: Math.min(score, 1), reasons, relationship };
}

// Only ever compares tasks that share at least one strong Sales-AI-
// derived key (same meeting/account/opportunity) — a full O(n^2) scan
// comparing every task's wording against every other's would be both
// slow and mostly noise for tasks that have nothing in common at all.
// Deliberate scope decision: duplicates among purely manual tasks (no
// Sales AI fields at all) aren't what this was requested for.
export function findDuplicateCandidates(allTasks: StoredTask[]): DuplicateCandidate[] {
  const byKey = new Map<string, StoredTask[]>();
  const addToBucket = (key: string | null, task: StoredTask) => {
    if (!key) return;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(task); else byKey.set(key, [task]);
  };
  for (const task of allTasks) {
    if (task.mergedIntoTaskId) continue; // already resolved — don't resurface it as a candidate again
    addToBucket(task.meetingId ? `meeting:${task.meetingId}` : null, task);
    addToBucket(task.accountId ? `account:${task.accountId}` : null, task);
    addToBucket(task.opportunityId ? `opportunity:${task.opportunityId}` : null, task);
  }
  const candidates: DuplicateCandidate[] = [];
  const seenPairs = new Set<string>();
  for (const bucket of byKey.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const pairKey = [bucket[i].id, bucket[j].id].sort((x, y) => x - y).join("-");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const candidate = compareForDuplicate(bucket[i], bucket[j]);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

// Folds `secondaryId` into `primaryId`. Never deletes the secondary row —
// requested 2026-09-08: both tasks' internal id and externalId (Sales AI
// action_item_id) need to survive so a later Sales AI-side cleanup pass
// can use them. The secondary's own content isn't discarded either: its
// subject/description get appended as a status update on the primary
// (the same "later task serves as an update" framing applies whether the
// pair is a true accidental duplicate or a genuine follow-up), and its
// own Task History gets one line recording where it went, in case anyone
// ever looks at it directly.
export async function mergeTasks(primaryId: number, secondaryId: number, actorName: string): Promise<StoredTask> {
  if (primaryId === secondaryId) throw new Error("Cannot merge a task into itself");
  return getDb().transaction(async tx => {
    const [primary] = await tx.select().from(tasks).where(eq(tasks.id, primaryId)).limit(1);
    const [secondary] = await tx.select().from(tasks).where(eq(tasks.id, secondaryId)).limit(1);
    if (!primary || !secondary) throw new Error("Task not found");
    if (primary.mergedIntoTaskId) throw new Error("That task has itself already been merged into another one — merge into the survivor instead");
    if (secondary.mergedIntoTaskId) throw new Error("That task has already been merged");

    const mergeNote = `Merged from task #${secondary.id}${secondary.externalId ? ` (Sales AI ${secondary.externalId})` : ""}: ${secondary.subject}${secondary.description.trim() ? ` — ${secondary.description.trim()}` : ""}`;
    const [updatedPrimary] = await tx.update(tasks)
      .set({ updates: [...primary.updates, { text: mergeNote, at: new Date().toISOString(), by: actorName }] })
      .where(eq(tasks.id, primary.id)).returning();

    // Fully hidden from the normal task list from here on (GET /api/tasks
    // filters mergedIntoTaskId is not null) — Closed both because it's
    // genuinely resolved and so nothing else in the app that branches on
    // status has to learn a new state just for this.
    const secondaryClosedAt = secondary.status === "Closed" ? secondary.closedAt : new Date();
    await tx.update(tasks).set({ mergedIntoTaskId: primary.id, mergedAt: new Date(), status: "Closed", closedAt: secondaryClosedAt }).where(eq(tasks.id, secondary.id));

    await tx.insert(taskActivity).values({ taskId: primary.id, actorName, detail: `merged task #${secondary.id} into this one` });
    await tx.insert(taskActivity).values({ taskId: secondary.id, actorName, detail: `merged into task #${primary.id}` });

    return updatedPrimary;
  });
}

// Just the fields a reviewer needs to judge a candidate pair or read a
// past merge — never the full row, so a Data Hygiene page listing many
// of these doesn't ship every task field twice per pair.
export type TaskSummary = { id: number; subject: string; description: string; owner: string; due: string; created: string; status: string; accountName: string | null; opportunityName: string | null; externalId: string | null };
function toSummary(t: StoredTask): TaskSummary {
  return { id: t.id, subject: t.subject, description: t.description, owner: t.owner, due: t.due, created: t.created, status: t.status, accountName: t.accountName, opportunityName: t.opportunityName, externalId: t.externalId };
}
export type DuplicateCandidateView = DuplicateCandidate & { older: TaskSummary; newer: TaskSummary };
export type MergeHistoryEntry = { secondary: TaskSummary; primary: TaskSummary; mergedAt: string | null };

// Full summary for the Data Hygiene page's duplicate-tasks section:
// current candidates worth reviewing, plus a record of every merge
// already done — the latter is the actual deliverable for "so we can
// run a quick cleaning exercise on Sales AI" (each entry keeps both
// tasks' internal id and externalId, exactly what that exercise needs).
export async function duplicateHygieneSummary(): Promise<{ candidates: DuplicateCandidateView[]; mergeHistory: MergeHistoryEntry[] }> {
  const allTasks = await getDb().select().from(tasks);
  const byId = new Map(allTasks.map(t => [t.id, t]));
  const candidates = findDuplicateCandidates(allTasks)
    .map(c => ({ ...c, older: toSummary(byId.get(c.olderId)!), newer: toSummary(byId.get(c.newerId)!) }));
  const mergeHistory: MergeHistoryEntry[] = [];
  for (const secondary of allTasks) {
    if (!secondary.mergedIntoTaskId) continue;
    const primary = byId.get(secondary.mergedIntoTaskId);
    if (!primary) continue; // shouldn't happen (FK-enforced), but never crash the page over a data anomaly
    mergeHistory.push({ secondary: toSummary(secondary), primary: toSummary(primary), mergedAt: secondary.mergedAt ? secondary.mergedAt.toISOString() : null });
  }
  mergeHistory.sort((a, b) => (b.mergedAt || "").localeCompare(a.mergedAt || ""));
  return { candidates, mergeHistory };
}
