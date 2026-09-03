"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import "../users/users.css";
import "./integrations.css";

type SyncedTask = { taskId: number; subject: string; owner: string; recipients: string[]; created: string };
type SyncResult = { itemsFound: number; qualifying: number; created: number; alreadySynced: number; contactsUpserted: number; createdTasks: SyncedTask[] };
type SyncRun = SyncResult & { id: number; runAt: string; initiatedBy: string; startDate: string; endDate: string };

const today = () => new Date().toISOString().slice(0, 10);
const runTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function summaryLine(result: SyncResult) {
  return (
    <>
      <b>{result.itemsFound}</b> action item{result.itemsFound === 1 ? "" : "s"} found · <b>{result.qualifying}</b> involved a registered Task AI user · <b>{result.created}</b> task{result.created === 1 ? "" : "s"} created · {result.alreadySynced} already synced (skipped) · {result.contactsUpserted} contact{result.contactsUpserted === 1 ? "" : "s"} added to the People registry.
    </>
  );
}

// The manual trigger and the run log below it are two views onto the same
// data: syncSalesAI() (app/lib/sales-ai-sync.ts) logs one salesAiSyncRuns
// row per run — manual or the 6x/day cron alike — so this one log covers
// both without the cron needing any UI of its own.
export default function IntegrationsClient() {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const loadRuns = async () => {
    const response = await fetch("/api/integrations/sales-ai/runs");
    if (!response.ok) return;
    const data = await response.json() as { runs: SyncRun[] };
    setRuns(data.runs);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-time fetch-on-mount to populate the log; loadRuns is also reused after a successful manual sync below, so it can't be inlined as an effect-local IIFE.
  useEffect(() => { void loadRuns(); }, []);

  const sync = async () => {
    if (busy || !startDate || !endDate) return;
    if (startDate > endDate) { setError("The start date must be on or before the end date."); return; }
    setBusy(true); setError(""); setResult(null);
    const response = await fetch("/api/integrations/sales-ai/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate, endDate }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error || "Sync failed"); return; }
    setResult(data);
    void loadRuns();
  };

  const toggleExpanded = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <main className="users-shell">
      <aside className="users-side">
        <Link className="users-logo" href="/">Task <b>AI</b></Link>
        <nav>
          <Link href="/">← Action items</Link>
          <Link href="/users">Users & access</Link>
          <Link href="/data-hygiene">Data Hygiene</Link>
          <Link className="active" href="/integrations">Integrations</Link>
          <Link href="/email-preview">Email notifications</Link>
        </nav>
      </aside>
      <section className="users-work">
        <header>
          <div>
            <span className="eyebrow">COMPANY SETTINGS</span>
            <h1>Integrations</h1>
            <p>Connect Task AI to the other tools your team uses.</p>
          </div>
        </header>
        <section>
          <div className="user-list">
            <article className="integration-row">
              <div className="identity">
                <b>Sales AI</b>
                <small>Syncs automatically 6x a day. Trigger a specific range manually below — for a backfill, or to run outside the schedule.</small>
              </div>
            </article>
            <div className="integration-range">
              <label>
                <span>From</span>
                <input type="date" value={startDate} max={endDate || undefined} onChange={e => setStartDate(e.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} />
              </label>
              <button className="manage" disabled={busy || !startDate || !endDate} onClick={() => void sync()}>{busy ? "Syncing…" : "Sync now"}</button>
            </div>
            {error && <div className="integration-result" style={{ color: "#a84235" }}>{error}</div>}
            {result && <div className="integration-result">{summaryLine(result)}</div>}
          </div>

          <div className="sync-log">
            <h2>Sync log</h2>
            {runs === null && <p className="hint">Loading…</p>}
            {runs?.length === 0 && <p className="hint">No syncs yet — manual or scheduled.</p>}
            {runs && runs.length > 0 && (
              <div className="sync-runs">
                {runs.map(run => (
                  <article className="sync-run" key={run.id}>
                    <div className="sync-run-head">
                      <div>
                        <b>{runTimeFormat.format(new Date(run.runAt))}</b>
                        <small>{run.initiatedBy} · {run.startDate === run.endDate ? run.startDate : `${run.startDate} – ${run.endDate}`}</small>
                      </div>
                      {run.created > 0 && (
                        <button type="button" className="sync-run-toggle" onClick={() => toggleExpanded(run.id)}>
                          {expanded.has(run.id) ? "▾" : "▸"} {run.created} task{run.created === 1 ? "" : "s"} imported
                        </button>
                      )}
                    </div>
                    <p className="sync-run-summary">{summaryLine(run)}</p>
                    {expanded.has(run.id) && run.createdTasks.length > 0 && (
                      <div className="sync-run-tasks">
                        <table>
                          <thead>
                            <tr><th>Subject</th><th>Owner</th><th>Recipients</th><th>Created</th></tr>
                          </thead>
                          <tbody>
                            {run.createdTasks.map(task => (
                              <tr key={task.taskId}>
                                <td>{task.subject}</td>
                                <td>{task.owner}</td>
                                <td>{task.recipients.join(", ") || "—"}</td>
                                <td>{task.created.slice(0, 10)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
