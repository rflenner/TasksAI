// A repeatable accuracy + latency check for /api/voice-query, run
// against a real local DB and a real OPENAI_API_KEY — the thing that
// was missing 2026-09-08, when a prompt/schema change shipped a real
// ~10x latency regression and two live misunderstandings that unit
// tests alone couldn't catch (they cover the deterministic logic
// downstream of a classification, never the classification itself).
//
// Every case here is either a sanity check on an existing mode or a
// real phrasing that failed live before being fixed — so a future
// prompt/schema change that reintroduces the SAME regression gets
// caught here, not reported by a frustrated live user again.
//
// Usage: seed a local Postgres with the fixture tasks this script
// expects (see FIXTURE_NOTES below), make sure the app's own temp
// /api/dev-login route exists (see the "is it live?"/local-verification
// ritual — that route is deleted before every commit, so recreate it
// for a local run same as any other manual verification), then:
//   pnpm exec tsx scripts/voice-eval.ts [baseUrl] [userId]
// baseUrl defaults to http://localhost:3000, userId to 1 (matching the
// fixture notes' seed, which assumes actor = Rizan Flenner). Logs
// itself in via /api/dev-login rather than needing a cookie value
// pasted in — that route is HttpOnly + not readable from JS by design,
// so there's nothing to copy out of a browser dev-login anyway.

type Case = {
  name: string;
  transcript: string;
  currentTaskId?: number | null;
  workingList?: number[];
  // Only the fields worth asserting on for this case — never exact-match
  // spokenAnswer (that's the model's own free-text phrasing, expected to
  // vary run to run); check mode + the structured fields that actually
  // drive behavior.
  expect: (body: Record<string, unknown>) => string | null; // returns an error string, or null if it passed
};

const FIXTURE_NOTES = `
Expects a FRESH tasks table (ids 1-4 — e.g. TRUNCATE tasks RESTART IDENTITY CASCADE first) visible to the logged-in actor (Rizan Flenner, userId 1 by default):
  1: subject contains "playbook", owner = the logged-in actor, Closed
  2: subject contains "playbook", owner = the logged-in actor, Closed
  3: subject contains "playbook", owner someone else (Pavneet Saluja), actor is a recipient, due today, Open
  4: subject does NOT contain "playbook", owner = the logged-in actor

INSERT INTO tasks (subject, description, owner, recipients, due, source, topic, project, recurring_meeting, status, priority, created) VALUES
('Send sales progression playbook visuals to Pavneet', 'Follow-up playbook visuals.', 'Rizan Flenner', '[]', '2026-09-10', 'Sales AI', '', '', '', 'Closed', 'Low', '2026-09-01'),
('Review and discuss playbooks with Pavneetkaur Saluja and Sudhanshu Kumawat before implementation.', 'Review playbooks.', 'Rizan Flenner', '[]', '2026-09-12', 'Sales AI', '', '', '', 'Closed', 'Low', '2026-09-02'),
('Add progression tracking to each milestone in the sales playbook UI.', 'UI progress tracking work.', 'Pavneet Saluja', '["Rizan Flenner"]', '<TODAY>', 'Sales AI', '', '', '', 'Open', 'Medium', '2026-09-03'),
('Update security FAQ', 'Refresh the security FAQ doc.', 'Rizan Flenner', '[]', '2026-09-20', 'Manual', '', '', '', 'Open', 'Low', '2026-09-03');
`;

const cases: Case[] = [
  {
    name: "filter: free-text subject search (was: fell into ungrounded 'answer' mode, 2026-09-08)",
    transcript: "identify all tasks that have playbook in their subject line",
    expect: body => {
      if (body.mode !== "filter") return `expected mode "filter", got "${body.mode}"`;
      const f = body.filters as { textContains?: string } | null;
      if (!f?.textContains) return "expected filters.textContains to be set";
      const ids = (body.workingListIds as number[] | undefined) || [];
      if (![1, 2, 3].every(id => ids.includes(id))) return `expected working list to include 1,2,3, got ${JSON.stringify(ids)}`;
      return null;
    },
  },
  {
    name: "act: target a task by id when nothing is open (was: 'unclear', 2026-09-08 — the 'task 175' bug)",
    transcript: "change the due date on task 3 to September 20th",
    currentTaskId: null,
    expect: body => {
      if (body.mode !== "act") return `expected mode "act", got "${body.mode}" (answer: ${body.spokenAnswer})`;
      const task = body.task as { id?: number; due?: string } | undefined;
      if (task?.id !== 3) return `expected task 3 to be updated, got ${JSON.stringify(task)}`;
      if (task?.due !== "2026-09-20") return `expected due date 2026-09-20, got ${task?.due}`;
      return null;
    },
  },
  {
    name: "act: bulk-apply across a remembered working list (was: 'unclear', 2026-09-08)",
    transcript: "add the project Sales AI and the topic Playbook to all of these tasks",
    workingList: [1, 2, 3],
    expect: body => {
      if (body.mode !== "act") return `expected mode "act", got "${body.mode}" (answer: ${body.spokenAnswer})`;
      const tasks = body.tasks as Array<{ project?: string; topic?: string }> | undefined;
      if (!tasks || tasks.length !== 3) return `expected 3 tasks updated, got ${tasks?.length}`;
      if (!tasks.every(t => t.project === "Sales AI" && t.topic === "Playbook")) return `not every task got project/topic set: ${JSON.stringify(tasks)}`;
      return null;
    },
  },
  {
    name: "act: bulk delete is refused, never actually deletes",
    transcript: "delete all of these tasks",
    workingList: [1, 2, 3],
    expect: body => {
      if (body.mode === "deleted" || body.mode === "confirm_delete") return `bulk delete should never reach ${body.mode}`;
      return null;
    },
  },
  {
    name: "briefing: due today / overdue / due-today-as-recipient",
    transcript: "give me my morning briefing",
    expect: body => {
      if (body.mode !== "briefing") return `expected mode "briefing", got "${body.mode}"`;
      const counts = body.counts as { dueToday?: number; dueTodayAsRecipient?: number } | undefined;
      if (!counts) return "expected counts to be present";
      return null;
    },
  },
  {
    name: "answer: a real factual question stays 'answer', not misrouted into 'filter'",
    transcript: "how many tasks does Pavneet Saluja have",
    expect: body => (body.mode === "answer" ? null : `expected mode "answer", got "${body.mode}"`),
  },
  {
    name: "filter: mineOnly vs myRole stay distinct",
    transcript: "what tasks am I the recipient on",
    expect: body => {
      const f = body.filters as { myRole?: string; mineOnly?: boolean } | null;
      if (body.mode !== "filter") return `expected mode "filter", got "${body.mode}"`;
      if (f?.myRole !== "recipient") return `expected filters.myRole "recipient", got ${JSON.stringify(f)}`;
      return null;
    },
  },
];

async function main() {
  const baseUrl = process.argv[2] || "http://localhost:3000";
  const userId = process.argv[3] || "1";

  const loginRes = await fetch(`${baseUrl}/api/dev-login?userId=${userId}`);
  const setCookie = loginRes.headers.get("set-cookie");
  if (!loginRes.ok || !setCookie) {
    console.error(`Could not log in via ${baseUrl}/api/dev-login?userId=${userId} — is the dev server running and does the temp dev-login route still exist? (It's deleted before every commit — recreate it for a local run, same as any other manual verification.)`);
    console.error(FIXTURE_NOTES);
    process.exit(1);
  }
  const cookie = setCookie.split(";")[0]; // "task_ai_session=<value>" — drop the Path/HttpOnly/etc. attributes

  let passed = 0;
  const timings: number[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/voice-query`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: baseUrl },
      body: JSON.stringify({ transcript: c.transcript, currentTaskId: c.currentTaskId ?? null, workingList: c.workingList ?? [] }),
    });
    const ms = Math.round(performance.now() - t0);
    timings.push(ms);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.log(`✖ ${c.name}\n    HTTP ${res.status}: ${JSON.stringify(body)} (${ms}ms)`); continue; }
    const error = c.expect(body);
    if (error) { console.log(`✖ ${c.name}\n    ${error} (${ms}ms)`); continue; }
    passed++;
    console.log(`✔ ${c.name} (${ms}ms)`);
  }

  timings.sort((a, b) => a - b);
  const avg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? timings[timings.length - 1];
  console.log(`\n${passed}/${cases.length} passed. Latency — min ${timings[0]}ms, avg ${avg}ms, p95 ${p95}ms, max ${timings[timings.length - 1]}ms.`);
  if (passed !== cases.length) process.exit(1);
}

void main();
