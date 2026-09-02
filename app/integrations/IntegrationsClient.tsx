"use client";
import Link from "next/link";
import { useState } from "react";
import "../users/users.css";
import "./integrations.css";

type SyncResult = { itemsFound: number; qualifying: number; created: number; alreadySynced: number; contactsUpserted: number };

const today = () => new Date().toISOString().slice(0, 10);

// A scheduled cron now runs this 6x/day (see render.yaml), always for
// today's date — this manual trigger is for anything outside that: a
// specific past range to backfill, or an immediate run without waiting
// for the next scheduled slot. Both dates default to today, matching
// what the cron itself does, but either can be changed.
export default function IntegrationsClient() {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");

  const sync = async () => {
    if (busy || !startDate || !endDate) return;
    if (startDate > endDate) { setError("The start date must be on or before the end date."); return; }
    setBusy(true); setError(""); setResult(null);
    const response = await fetch("/api/integrations/sales-ai/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate, endDate }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error || "Sync failed"); return; }
    setResult(data);
  };

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
            {result && (
              <div className="integration-result">
                <b>{result.itemsFound}</b> action item{result.itemsFound === 1 ? "" : "s"} found · <b>{result.qualifying}</b> involved a registered Task AI user · <b>{result.created}</b> task{result.created === 1 ? "" : "s"} created · {result.alreadySynced} already synced (skipped) · {result.contactsUpserted} contact{result.contactsUpserted === 1 ? "" : "s"} added to the People registry.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
